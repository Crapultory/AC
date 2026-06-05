"""Extended delegation tool for single-agent task execution."""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

from toolsets import validate_toolset
from tools.delegate_tool import (
    _build_child_system_prompt,
    _resolve_child_credential_pool,
    _resolve_workspace_hint,
    check_delegate_requirements,
)
from tools.registry import registry, tool_error


logger = logging.getLogger(__name__)

DEFAULT_AGENT_MODE = "local"
DEFAULT_TOOLSETS = ["hermes-cli"]
DEFAULT_MAX_ITERATIONS = 90
A2A_REGISTRY: Dict[str, Dict[str, Any]] = {}


A2A_LIST_SCHEMA = {
    "name": "a2a_list",
    "description": "List profile-configured A2A agents and summarize their capabilities.",
    "parameters": {
        "type": "object",
        "properties": {},
    },
}


def _child_session_id(child) -> str | None:
    session_id = getattr(child, "session_id", None)
    return str(session_id) if isinstance(session_id, str) and session_id else None


def _emit_delegate_event(
    output,
    source: str,
    event_type: str,
    content: str,
    *,
    session_id: str | None = None,
) -> None:
    if output is None:
        return
    emit = getattr(output, "emit", None)
    if not callable(emit):
        return
    try:
        emit(source, event_type, content, session_id=session_id)
    except TypeError:
        emit(source, event_type, content)


def _read_delegate_input(input_adapter) -> str | None:
    if input_adapter is None:
        return None
    read_line = getattr(input_adapter, "read_line", None)
    if callable(read_line):
        return read_line()
    return None


def _strip_recursive_delegate_tool(child) -> None:
    valid_tool_names = getattr(child, "valid_tool_names", None)
    if valid_tool_names:
        valid_tool_names.discard("delegate_ext")
    tool_definitions = getattr(child, "tool_definitions", None)
    if tool_definitions:
        child.tool_definitions = [
            tool
            for tool in tool_definitions
            if tool.get("function", {}).get("name") != "delegate_ext"
        ]


def _enter_delegate_foreground(input_adapter) -> bool:
    enter = getattr(input_adapter, "enter_foreground", None)
    if callable(enter):
        return bool(enter())
    return True


def _exit_delegate_foreground(input_adapter) -> None:
    exit_foreground = getattr(input_adapter, "exit_foreground", None)
    if callable(exit_foreground):
        exit_foreground()


def _normalize_toolsets(toolsets: Optional[List[str]]) -> tuple[Optional[List[str]], Optional[str]]:
    if toolsets is None:
        return list(DEFAULT_TOOLSETS), None
    if not isinstance(toolsets, list) or not all(isinstance(t, str) for t in toolsets):
        return None, "toolsets must be an array of toolset names."
    cleaned = [t.strip() for t in toolsets if isinstance(t, str) and t.strip()]
    if not cleaned:
        return list(DEFAULT_TOOLSETS), None
    invalid = [name for name in cleaned if not validate_toolset(name)]
    if invalid:
        return None, f"Unknown toolset(s): {', '.join(invalid)}."
    return cleaned, None


def _normalize_max_iterations(value: Optional[int], parent_agent) -> tuple[int, Optional[str]]:
    if value is None:
        inherited = getattr(parent_agent, "max_iterations", None)
        if isinstance(inherited, int) and inherited > 0:
            return inherited, None
        return DEFAULT_MAX_ITERATIONS, None
    try:
        max_iterations = int(value)
    except Exception:
        return 0, "max_iterations must be a positive integer."
    if max_iterations <= 0:
        return 0, "max_iterations must be a positive integer."
    return max_iterations, None


def a2a_list() -> str:
    """Return the currently loaded A2A registry entries."""
    return json.dumps(
        {
            "success": True,
            "count": len(A2A_REGISTRY),
            "agents": list(A2A_REGISTRY.values()),
        }
    )


def _register_active_child(parent_agent, child) -> None:
    if not hasattr(parent_agent, "_active_children"):
        return
    lock = getattr(parent_agent, "_active_children_lock", None)
    if lock:
        with lock:
            parent_agent._active_children.append(child)
    else:
        parent_agent._active_children.append(child)


def _unregister_active_child(parent_agent, child) -> None:
    if not hasattr(parent_agent, "_active_children"):
        return
    lock = getattr(parent_agent, "_active_children_lock", None)
    try:
        if lock:
            with lock:
                parent_agent._active_children.remove(child)
        else:
            parent_agent._active_children.remove(child)
    except (ValueError, AttributeError):
        pass


def _build_local_child_agent(
    *,
    goal: str,
    context: Optional[str],
    toolsets: List[str],
    max_iterations: int,
    parent_agent,
):
    from run_agent import AIAgent

    workspace_hint = _resolve_workspace_hint(parent_agent)
    child_prompt = _build_child_system_prompt(
        goal,
        context,
        workspace_path=workspace_hint,
        role="leaf",
        max_spawn_depth=1,
        child_depth=1,
    )
    child = AIAgent(
        base_url=getattr(parent_agent, "base_url", None),
        api_key=getattr(parent_agent, "api_key", None),
        model=getattr(parent_agent, "model", None),
        provider=getattr(parent_agent, "provider", None),
        api_mode=getattr(parent_agent, "api_mode", None),
        max_iterations=max_iterations,
        max_tokens=getattr(parent_agent, "max_tokens", None),
        reasoning_config=getattr(parent_agent, "reasoning_config", None),
        prefill_messages=getattr(parent_agent, "prefill_messages", None),
        fallback_model=getattr(parent_agent, "_fallback_chain", None) or None,
        enabled_toolsets=toolsets,
        quiet_mode=True,
        ephemeral_system_prompt=child_prompt,
        log_prefix="[delegate-ext]",
        platform=getattr(parent_agent, "platform", None),
        skip_context_files=True,
        skip_memory=True,
        clarify_callback=None,
        session_db=getattr(parent_agent, "_session_db", None),
        parent_session_id=getattr(parent_agent, "session_id", None),
        providers_allowed=getattr(parent_agent, "providers_allowed", None),
        providers_ignored=getattr(parent_agent, "providers_ignored", None),
        providers_order=getattr(parent_agent, "providers_order", None),
        provider_sort=getattr(parent_agent, "provider_sort", None),
        openrouter_min_coding_score=getattr(parent_agent, "openrouter_min_coding_score", None),
        credential_pool=_resolve_child_credential_pool(
            getattr(parent_agent, "provider", None),
            parent_agent,
        ),
        pass_session_id=getattr(parent_agent, "pass_session_id", False),
    )
    child._print_fn = getattr(parent_agent, "_print_fn", None)
    child._delegate_depth = getattr(parent_agent, "_delegate_depth", 0) + 1
    child._delegate_role = "leaf"
    child._subagent_id = f"delegate-ext-{uuid.uuid4().hex[:8]}"
    child._parent_subagent_id = getattr(parent_agent, "_subagent_id", None)
    child._subagent_goal = goal
    _strip_recursive_delegate_tool(child)
    return child


def _run_local_delegate(
    *,
    goal: str,
    context: Optional[str],
    toolsets: List[str],
    max_iterations: int,
    is_delegate_output: bool,
    output,
    is_loop: bool,
    input,
    parent_agent,
) -> str:
    child = _build_local_child_agent(
        goal=goal,
        context=context,
        toolsets=toolsets,
        max_iterations=max_iterations,
        parent_agent=parent_agent,
    )
    _register_active_child(parent_agent, child)
    start = time.monotonic()

    def _run_single_turn(user_message: str) -> dict[str, Any]:
        task_id = (
            f"delegate-ext-{uuid.uuid4().hex[:8]}"
            if getattr(parent_agent, "_current_task_id", None)
            else None
        )
        result = child.run_conversation(
            user_message=user_message,
            task_id=task_id,
        )
        final_response = str(result.get("final_response") or "")
        if is_delegate_output and final_response:
            _emit_delegate_event(
                output,
                "delegate",
                "ai",
                final_response,
                session_id=_child_session_id(child),
            )
        return result

    def _finish_loop(
        *,
        last_result: dict[str, Any],
        loop_exit_reason: str,
        success: bool = True,
        error_message: str | None = None,
        api_calls: int = 0,
    ) -> str:
        duration = round(time.monotonic() - start, 3)
        payload = {
            "success": success,
            "agent": "local",
            "goal": goal,
            "session_id": _child_session_id(child),
            "toolsets": list(toolsets),
            "max_iterations": max_iterations,
            "completed": bool(last_result.get("completed", success)),
            "loop_exit_reason": loop_exit_reason,
            "api_calls": api_calls,
            "duration_seconds": duration,
            "final_response": str(last_result.get("final_response") or ""),
        }
        if error_message:
            payload["error"] = error_message
        return json.dumps(payload, ensure_ascii=False)

    try:
        if not is_loop:
            result = _run_single_turn(goal)
            return _finish_loop(
                last_result=result,
                loop_exit_reason="completed",
                api_calls=int(result.get("api_calls", 0) or 0),
            )

        if not _enter_delegate_foreground(input):
            return _finish_loop(
                last_result={"final_response": "", "completed": False},
                loop_exit_reason="error",
                success=False,
                error_message="delegate_ext could not enter foreground mode.",
                api_calls=0,
            )
        _emit_delegate_event(
            output,
            "delegate",
            "status",
            "entered foreground loop",
            session_id=_child_session_id(child),
        )
        last_result = _run_single_turn(goal)
        total_api_calls = int(last_result.get("api_calls", 0) or 0)

        while True:
            next_message = _read_delegate_input(input)
            if next_message is None:
                return _finish_loop(
                    last_result=last_result,
                    loop_exit_reason="input_closed",
                    api_calls=total_api_calls,
                )
            stripped = next_message.strip()
            if stripped in {"/main", "/exit"}:
                _emit_delegate_event(
                    output,
                    "delegate",
                    "status",
                    "return to main",
                    session_id=_child_session_id(child),
                )
                return _finish_loop(
                    last_result=last_result,
                    loop_exit_reason="main_command",
                    api_calls=total_api_calls,
                )
            _emit_delegate_event(
                output,
                "delegate",
                "user",
                stripped,
                session_id=_child_session_id(child),
            )
            last_result = _run_single_turn(stripped)
            total_api_calls += int(last_result.get("api_calls", 0) or 0)
    except Exception as exc:
        if is_delegate_output:
            _emit_delegate_event(
                output,
                "delegate",
                "error",
                str(exc),
                session_id=_child_session_id(child),
            )
        return _finish_loop(
            last_result={"final_response": "", "completed": False},
            loop_exit_reason="error",
            success=False,
            error_message=str(exc),
            api_calls=0,
        )
    finally:
        if is_loop:
            _exit_delegate_foreground(input)
        _unregister_active_child(parent_agent, child)
        try:
            if hasattr(child, "close"):
                child.close()
        except Exception:
            logger.debug("Failed to close delegate_ext child agent", exc_info=True)


def delegate_ext(
    goal: Optional[str] = None,
    context: Optional[str] = None,
    agent: str = DEFAULT_AGENT_MODE,
    a2a_name: Optional[str] = None,
    toolsets: Optional[List[str]] = None,
    max_iterations: Optional[int] = None,
    is_delegate_output: bool = True,
    output=None,
    is_loop: Optional[bool] = None,
    input=None,
    parent_agent=None,
) -> str:
    """Delegate a single task to another agent."""
    if parent_agent is None:
        return tool_error("delegate_ext requires a parent agent context.")
    if not isinstance(goal, str) or not goal.strip():
        return tool_error("delegate_ext requires a non-empty goal.")
    effective_is_loop = is_loop if is_loop is not None else (input is not None)
    if effective_is_loop and input is None:
        return tool_error("delegate_ext loop mode requires an input adapter.")

    mode = str(agent or DEFAULT_AGENT_MODE).strip().lower() or DEFAULT_AGENT_MODE
    if mode not in {"local", "a2a"}:
        return tool_error("agent must be one of: local, a2a.")

    if mode == "a2a":
        return tool_error(
            "delegate_ext a2a mode is not implemented yet.",
            agent="a2a",
            a2a_name=a2a_name,
            success=False,
        )

    normalized_toolsets, toolsets_error = _normalize_toolsets(toolsets)
    if toolsets_error:
        return tool_error(toolsets_error)
    normalized_max_iterations, max_iter_error = _normalize_max_iterations(
        max_iterations,
        parent_agent,
    )
    if max_iter_error:
        return tool_error(max_iter_error)

    return _run_local_delegate(
        goal=goal.strip(),
        context=context,
        toolsets=normalized_toolsets or list(DEFAULT_TOOLSETS),
        max_iterations=normalized_max_iterations,
        is_delegate_output=is_delegate_output,
        output=output,
        is_loop=effective_is_loop,
        input=input,
        parent_agent=parent_agent,
    )


DELEGATE_EXT_SCHEMA = {
    "name": "delegate_ext",
    "description": (
        "Delegate a single task to another agent. "
        "Use local mode to spawn a focused Hermes subagent with its own toolset and loop budget. "
        "A2A mode is reserved for remote agents and is not implemented yet."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "goal": {
                "type": "string",
                "description": "Task goal for the delegated agent. Required.",
            },
            "context": {
                "type": "string",
                "description": "Additional context or constraints for the delegated task.",
            },
            "agent": {
                "type": "string",
                "enum": ["local", "a2a"],
                "description": "Delegation target mode. Default: local. a2a is reserved for remote agents and currently unimplemented.",
            },
            "a2a_name": {
                "type": "string",
                "description": "Configured remote A2A agent name. Only used when agent='a2a'.",
            },
            "toolsets": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Toolsets to enable for local delegated execution. Default: ['hermes-cli'].",
            },
            "max_iterations": {
                "type": "integer",
                "minimum": 1,
                "description": "Maximum agent loop iterations for local delegated execution. Defaults to the parent agent's limit.",
            },
            "is_delegate_output": {
                "type": "boolean",
                "description": "Whether delegated output should be handled as delegate output by the runtime.",
            },
            "is_loop": {
                "type": "boolean",
                "description": "Whether to run in interactive loop mode when a runtime input adapter is available.",
            },
        },
        "required": ["goal"],
    },
}


registry.register(
    name="a2a_list",
    toolset="delegation_ext",
    schema=A2A_LIST_SCHEMA,
    handler=lambda args, **kw: a2a_list(),
    check_fn=check_delegate_requirements,
    emoji="🗂️",
    description="List configured remote A2A agents",
)


registry.register(
    name="delegate_ext",
    toolset="delegation_ext",
    schema=DELEGATE_EXT_SCHEMA,
    handler=lambda args, **kw: delegate_ext(
        goal=args.get("goal"),
        context=args.get("context"),
        agent=args.get("agent", DEFAULT_AGENT_MODE),
        a2a_name=args.get("a2a_name"),
        toolsets=args.get("toolsets"),
        max_iterations=args.get("max_iterations"),
        is_delegate_output=args.get("is_delegate_output", True),
        is_loop=args.get("is_loop"),
        parent_agent=kw.get("parent_agent"),
    ),
    check_fn=check_delegate_requirements,
    emoji="🛰️",
    description="Delegate a single task to a local or remote agent",
)
