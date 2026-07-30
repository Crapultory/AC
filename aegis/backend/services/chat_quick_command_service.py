"""Cached chat-composer shortcuts and server-side token expansion."""

from __future__ import annotations

import os
import re
import threading

from aegis.backend.models import ChatQuickCommandResponse
from aegis.backend.services.agent_service import AgentService
from aegis.backend.services.prompt_template_service import PromptTemplateService
from aegis.backend.services.system_instruct_service import SystemInstructService


_SHORTCUT_TOKEN_PATTERN = re.compile(r"@\[(agent|prompt|instruct)_[^\]]+\]")
_AGENT_VARIABLE_PATTERN = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


class QuickCommandResolutionError(ValueError):
    """A known shortcut could not be rendered safely for this turn."""


class ChatQuickCommandService:
    """Build, cache, invalidate, and render composer shortcuts per user."""

    def __init__(
        self,
        agent_service: AgentService,
        prompt_template_service: PromptTemplateService,
        system_instruct_service: SystemInstructService,
    ) -> None:
        self._agent_service = agent_service
        self._prompt_template_service = prompt_template_service
        self._system_instruct_service = system_instruct_service
        self._lock = threading.Lock()
        self._commands_by_user: dict[str, list[ChatQuickCommandResponse]] = {}

    def list_commands(self, user_id: str) -> list[ChatQuickCommandResponse]:
        owner_id = str(user_id or "").strip()
        with self._lock:
            cached = self._commands_by_user.get(owner_id)
            if cached is not None:
                return list(cached)
            # Keep construction and invalidation serial so a completed write can
            # never be followed by a stale in-flight cache population.
            commands = self._build_commands(owner_id)
            self._commands_by_user[owner_id] = commands
            return list(commands)

    def invalidate_user(self, user_id: str) -> None:
        with self._lock:
            self._commands_by_user.pop(str(user_id or "").strip(), None)

    def invalidate_all(self) -> None:
        with self._lock:
            self._commands_by_user.clear()

    def resolve_text(self, user_id: str, text: str) -> str:
        commands = self.list_commands(user_id)
        commands_by_token = {
            self._token_for(command): command
            for command in commands
        }

        def _replace(match: re.Match[str]) -> str:
            token = match.group(0)
            command = commands_by_token.get(token)
            if command is None:
                return token
            if command.type == "prompt":
                return command.content
            if command.type == "instruct":
                return f"{command.content}\n"
            return self._render_agent_command(command)

        # ``re.sub`` visits only original input matches, so replacement content
        # is deliberately never scanned again for nested shortcut tokens.
        return _SHORTCUT_TOKEN_PATTERN.sub(_replace, str(text or ""))

    def _build_commands(self, user_id: str) -> list[ChatQuickCommandResponse]:
        agent_template = os.environ.get("USE_ACTIVE_AGENT_PROMPT") or "Use remote agent {name}"
        commands = [
            ChatQuickCommandResponse(
                type="agent",
                name=agent.agent_id,
                desc=agent.description,
                content=agent_template,
            )
            for agent in self._agent_service.list_agents()
            if agent.status == "active"
        ]
        commands.extend(
            ChatQuickCommandResponse(
                type="prompt",
                name=template.tag,
                desc=template.desc,
                content=template.prompt,
            )
            for template in self._prompt_template_service.list_templates(user_id)
        )
        commands.extend(
            ChatQuickCommandResponse(
                type="instruct",
                name=instruction.name,
                desc=instruction.describe,
                content=instruction.instruct,
            )
            for instruction in self._system_instruct_service.list_instructions()
            if instruction.status == "enabled"
        )
        commands.sort(key=lambda command: (command.type, command.name.casefold()))
        return commands

    @staticmethod
    def _token_for(command: ChatQuickCommandResponse) -> str:
        return f"@[{command.type}_{command.name}]"

    @staticmethod
    def _render_agent_command(command: ChatQuickCommandResponse) -> str:
        unsupported_variables = {
            match.group(0)
            for match in _AGENT_VARIABLE_PATTERN.finditer(command.content)
            if match.group(1) not in {"name", "agent_name"}
        }
        if unsupported_variables:
            plural = "s" if len(unsupported_variables) > 1 else ""
            variables = ", ".join(sorted(unsupported_variables))
            raise QuickCommandResolutionError(
                f"Agent command \u201c{command.name}\u201d contains unsupported variable{plural}: {variables}."
            )
        return _AGENT_VARIABLE_PATTERN.sub(
            lambda match: command.name if match.group(1) in {"name", "agent_name"} else match.group(0),
            command.content,
        )
