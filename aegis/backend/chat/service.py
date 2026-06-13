"""Session manager + actor for Aegis chat WebSocket flows."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import json
import os
import threading
import time
from typing import Any
from uuid import uuid4

from fastapi import WebSocket

from aegis.backend.chat.models import ApprovalRequestState, ChatEventEnvelope, DelegateForegroundState
from aegis.backend.chat.runtime import AegisChatInputAdapter, AegisChatOutputAdapter
from aisoc.backend.agent_runtime import default_agent_factory
from aisoc.backend.agent_runtime import load_conversation_history
from gateway.session_context import clear_session_vars, set_session_vars
from tools.approval import (
    register_gateway_notify,
    reset_current_session_key,
    resolve_gateway_approval,
    set_current_session_key,
    unregister_gateway_notify,
)


def _now_timestamp() -> float:
    return time.time()


def _conversation_title(seed: str | None, fallback: str = "New Investigation") -> str:
    text = str(seed or "").strip()
    if not text:
        return fallback
    return text[:30] + ("..." if len(text) > 30 else "")


def _message_delta_enabled() -> bool:
    value = str(os.getenv("MESSAGE_DELTA", "true")).strip().lower()
    return value not in {"0", "false", "no", "off"}


class ChatSessionActor:
    def __init__(
        self,
        *,
        session_id: str,
        title: str,
        agent_factory: Callable[[str], object],
    ) -> None:
        self.session_id = session_id
        self.title = title
        self._agent_factory = agent_factory
        self._agent = agent_factory(session_id)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._websocket: WebSocket | None = None
        self._lock = threading.RLock()
        self._event_counter = 0
        self._turn_id: str | None = None
        self._foreground_source = "main"
        self._foreground_agent = ""
        self._foreground_state = DelegateForegroundState()
        self._delegate_input: AegisChatInputAdapter | None = None
        self._pending_delegate_agent_name = ""
        self._pending_approval: ApprovalRequestState | None = None
        self._last_run_state = "idle"
        self._last_state_source = "main"
        self._latest_delegate_message_id: str | None = None
        self._main_message_id: str | None = None
        self._running_thread: threading.Thread | None = None
        self._disconnect_requested = False
        self._output_adapter = AegisChatOutputAdapter(self)

    def replace_connection(self, websocket: WebSocket, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            self._websocket = websocket
            self._loop = loop
            self._disconnect_requested = False

    def detach_connection(self, websocket: WebSocket) -> None:
        with self._lock:
            if self._websocket is websocket:
                self._websocket = None
                self._loop = None
                self._disconnect_requested = True

    def build_bound_event(self, *, resumed: bool) -> dict[str, Any]:
        return self._make_event(
            "session.bound",
            payload={
                "title": self.title,
                "resumed": resumed,
            },
            source=self._foreground_source,
            turn_id=self._turn_id,
        )

    def resume_state_events(self) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = [
            self._make_event(
                "run.state",
                payload={
                    "state": self._last_run_state,
                    "srcagent": self._foreground_agent or None,
                },
                source=self._last_state_source,
                turn_id=self._turn_id,
            )
        ]
        with self._lock:
            if self._foreground_source == "delegate" and self._foreground_agent:
                events.append(
                    self._make_event(
                        "delegate.entered",
                        payload={
                            "child_session_id": self._foreground_state.child_session_id,
                            "srcagent": self._foreground_agent,
                        },
                        source="delegate",
                        turn_id=self._turn_id,
                    )
                )
            if self._pending_approval is not None:
                events.append(
                    self._make_event(
                        "approval.request",
                        payload={
                            "approval_id": self._pending_approval.approval_id,
                            "command": self._pending_approval.command,
                            "description": self._pending_approval.description,
                            "choices": list(self._pending_approval.choices),
                        },
                        source=self._foreground_source,
                        turn_id=self._turn_id,
                    )
                )
        return events

    def set_title(self, title: str | None) -> None:
        if title:
            self.title = _conversation_title(title, fallback=self.title)

    def handle_message(self, text: str, *, client_msg_id: str | None = None) -> None:
        stripped = str(text or "")
        with self._lock:
            if self._pending_approval is not None:
                self._send_event(
                    "error",
                    {
                        "code": "waiting_for_approval",
                        "message": "Session is waiting for approval.",
                    },
                    source=self._foreground_source,
                )
                return

            turn_id = f"turn_{uuid4().hex[:10]}"
            self._send_event(
                "message.accepted",
                {
                    "client_msg_id": client_msg_id,
                    "message_id": f"user_{uuid4().hex[:10]}",
                },
                source=self._foreground_source,
                turn_id=turn_id,
            )
            if self._foreground_source == "delegate" and self._delegate_input is not None:
                self._turn_id = turn_id
                self._set_run_state("running", source="delegate")
                self._delegate_input.push_line(stripped)
                return

            if self._running_thread is not None and self._running_thread.is_alive():
                self._send_event(
                    "error",
                    {
                        "code": "session_busy",
                        "message": "Session is currently busy.",
                    },
                    source=self._foreground_source,
                    turn_id=turn_id,
                )
                return

            self._turn_id = turn_id
            self._main_message_id = f"assistant_{uuid4().hex[:10]}"
            self._foreground_source = "main"
            self._foreground_agent = ""
            self._set_run_state("running", source="main")
            worker = threading.Thread(
                target=self._run_turn,
                args=(stripped, turn_id),
                name=f"aegis-{self.session_id[:8]}",
                daemon=True,
            )
            self._running_thread = worker
            worker.start()

    def handle_approval_response(self, choice: str) -> None:
        normalized = str(choice or "").strip().lower()
        if normalized not in {"once", "session", "always", "deny"}:
            self._send_event(
                "error",
                {"code": "invalid_approval_choice", "message": "Invalid approval choice."},
                source=self._foreground_source,
                turn_id=self._turn_id,
            )
            return
        resolved = resolve_gateway_approval(self.session_id, normalized)
        if resolved <= 0:
            self._send_event(
                "error",
                {"code": "approval_not_pending", "message": "No pending approval for this session."},
                source=self._foreground_source,
                turn_id=self._turn_id,
            )
            return
        with self._lock:
            pending = self._pending_approval
            self._pending_approval = None
        self._send_event(
            "approval.resolved",
            {
                "approval_id": pending.approval_id if pending else None,
                "choice": normalized,
            },
            source=self._foreground_source,
            turn_id=self._turn_id,
        )
        self._set_run_state("running", source=self._foreground_source)

    def interrupt(self) -> None:
        agent = self._agent
        interrupt = getattr(agent, "interrupt", None)
        if callable(interrupt):
            try:
                interrupt("Interrupted by websocket client.")
            except Exception:
                pass
        self._set_run_state("interrupted", source=self._foreground_source)

    def activate_delegate_input(self, input_adapter: AegisChatInputAdapter) -> bool:
        with self._lock:
            if self._delegate_input not in {None, input_adapter}:
                return False
            self._delegate_input = input_adapter
            self._foreground_source = "delegate"
            self._foreground_agent = self._pending_delegate_agent_name or self._foreground_agent or "delegate"
            self._foreground_state = DelegateForegroundState(
                child_session_id=None,
                srcagent=self._foreground_agent,
                reason=None,
            )
        self._set_run_state("waiting_for_delegate_input", source="delegate")
        self._send_event(
            "delegate.entered",
            {
                "child_session_id": self._foreground_state.child_session_id,
                "srcagent": self._foreground_agent,
            },
            source="delegate",
            turn_id=self._turn_id,
        )
        return True

    def release_delegate_input(self, input_adapter: AegisChatInputAdapter | None = None) -> None:
        with self._lock:
            if input_adapter is not None and self._delegate_input not in {None, input_adapter}:
                return
            srcagent = self._foreground_agent
            reason = self._foreground_state.reason or "completed"
            child_session_id = self._foreground_state.child_session_id
            self._delegate_input = None
            self._foreground_source = "main"
            self._foreground_agent = ""
            self._foreground_state = DelegateForegroundState()
        self._send_event(
            "delegate.exited",
            {
                "child_session_id": child_session_id,
                "srcagent": srcagent or None,
                "reason": reason,
            },
            source="delegate",
            turn_id=self._turn_id,
        )
        self._set_run_state("running", source="main")

    def handle_delegate_output(
        self,
        *,
        source: str,
        event_type: str,
        content: str,
        delegate_session_id: str | None = None,
    ) -> None:
        if source != "delegate":
            return

        if delegate_session_id:
            with self._lock:
                self._foreground_state.child_session_id = str(delegate_session_id)

        if event_type == "status":
            normalized = str(content or "").strip().lower()
            if "return to main" in normalized:
                with self._lock:
                    self._foreground_state.reason = "return_to_main"
            elif "entered foreground loop" in normalized:
                self._set_run_state("waiting_for_delegate_input", source="delegate")
            return

        if event_type == "tool_call":
            tool_name = str(content or "").strip().split(" ", 1)[0]
            self._send_event(
                "tool.started",
                {
                    "tool_name": tool_name,
                    "tool_call_id": f"delegate-tool-{uuid4().hex[:10]}",
                    "args_preview": content,
                    "srcagent": self._foreground_agent or None,
                },
                source="delegate",
                turn_id=self._turn_id,
            )
            return

        if event_type == "error":
            self._send_event(
                "error",
                {
                    "code": "delegate_error",
                    "message": content,
                    "srcagent": self._foreground_agent or None,
                },
                source="delegate",
                turn_id=self._turn_id,
            )
            self._set_run_state("error", source="delegate")
            return

        if event_type == "ai":
            message_id = f"delegate_msg_{uuid4().hex[:10]}"
            self._latest_delegate_message_id = message_id
            self._send_event(
                "message.completed",
                {
                    "message_id": message_id,
                    "content": content,
                    "completed": True,
                    "srcagent": self._foreground_agent or None,
                },
                source="delegate",
                turn_id=self._turn_id,
            )

    def record_pending_delegate_name(self, function_args: dict[str, Any] | None) -> None:
        if not function_args:
            return
        delegate_name = (
            str(function_args.get("a2a_name") or "").strip()
            or str(function_args.get("agent") or "").strip()
            or "delegate"
        )
        with self._lock:
            self._pending_delegate_agent_name = delegate_name

    def _approval_notify_sync(self, approval_data: dict[str, Any]) -> None:
        approval_id = f"approval_{uuid4().hex[:10]}"
        with self._lock:
            self._pending_approval = ApprovalRequestState(
                approval_id=approval_id,
                command=str(approval_data.get("command") or ""),
                description=str(approval_data.get("description") or ""),
            )
        self._set_run_state("waiting_for_approval", source=self._foreground_source)
        self._send_event(
            "approval.request",
            {
                "approval_id": approval_id,
                "command": self._pending_approval.command,
                "description": self._pending_approval.description,
                "choices": list(self._pending_approval.choices),
            },
            source=self._foreground_source,
            turn_id=self._turn_id,
        )

    def _run_turn(self, user_message: str, turn_id: str) -> None:
        agent = self._agent
        old_stream = getattr(agent, "stream_delta_callback", None)
        old_tool_start = getattr(agent, "tool_start_callback", None)
        old_tool_complete = getattr(agent, "tool_complete_callback", None)
        old_delegate_output = getattr(agent, "_delegate_ext_output_adapter", None)
        old_delegate_input_factory = getattr(agent, "_delegate_ext_input_factory", None)
        approval_token = None
        session_tokens = []
        try:
            approval_token = set_current_session_key(self.session_id)
            session_tokens = set_session_vars(platform="aegis", session_key=self.session_id)
            register_gateway_notify(self.session_id, self._approval_notify_sync)

            def _on_delta(delta: str) -> None:
                if delta is None or not _message_delta_enabled():
                    return
                self._send_event(
                    "message.delta",
                    {
                        "message_id": self._main_message_id,
                        "delta": delta,
                    },
                    source="main",
                    turn_id=turn_id,
                )

            def _on_tool_start(tool_call_id: str, function_name: str, function_args: dict | None) -> None:
                if function_name == "a2a_delegate":
                    self.record_pending_delegate_name(function_args)
                self._send_event(
                    "tool.started",
                    {
                        "tool_name": function_name,
                        "tool_call_id": tool_call_id,
                        "args_preview": json.dumps(function_args or {}, ensure_ascii=False),
                    },
                    source=self._foreground_source,
                    turn_id=turn_id,
                )

            def _on_tool_complete(
                tool_call_id: str,
                function_name: str,
                function_args: dict | None,
                function_result: object,
            ) -> None:
                del function_args
                preview = str(function_result)
                if len(preview) > 200:
                    preview = preview[:200] + "..."
                self._send_event(
                    "tool.completed",
                    {
                        "tool_name": function_name,
                        "tool_call_id": tool_call_id,
                        "result_preview": preview,
                    },
                    source=self._foreground_source,
                    turn_id=turn_id,
                )

            setattr(agent, "stream_delta_callback", _on_delta)
            setattr(agent, "tool_start_callback", _on_tool_start)
            setattr(agent, "tool_complete_callback", _on_tool_complete)
            setattr(agent, "_delegate_ext_output_adapter", self._output_adapter)
            setattr(
                agent,
                "_delegate_ext_input_factory",
                lambda: AegisChatInputAdapter(
                    on_enter_foreground=self.activate_delegate_input,
                    on_exit_foreground=self.release_delegate_input,
                ),
            )

            history = load_conversation_history(agent, self.session_id)
            result = agent.run_conversation(
                user_message=user_message,
                conversation_history=history,
                task_id=turn_id,
            )
            final_response = str(result.get("final_response") or "")
            if final_response:
                self._send_event(
                    "message.completed",
                    {
                        "message_id": self._main_message_id,
                        "content": final_response,
                        "completed": bool(result.get("completed", True)),
                    },
                    source="main",
                    turn_id=turn_id,
                )
            if result.get("failed"):
                self._set_run_state("error", source=self._foreground_source)
                if result.get("error"):
                    self._send_event(
                        "error",
                        {
                            "code": "run_failed",
                            "message": str(result.get("error")),
                        },
                        source=self._foreground_source,
                        turn_id=turn_id,
                    )
            else:
                self._set_run_state("idle", source="main")
        except Exception as exc:
            self._set_run_state("error", source=self._foreground_source)
            self._send_event(
                "error",
                {
                    "code": "run_exception",
                    "message": str(exc),
                },
                source=self._foreground_source,
                turn_id=turn_id,
            )
        finally:
            unregister_gateway_notify(self.session_id)
            if approval_token is not None:
                try:
                    reset_current_session_key(approval_token)
                except Exception:
                    pass
            if session_tokens:
                try:
                    clear_session_vars(session_tokens)
                except Exception:
                    pass
            if old_stream is not None:
                setattr(agent, "stream_delta_callback", old_stream)
            if old_tool_start is not None:
                setattr(agent, "tool_start_callback", old_tool_start)
            if old_tool_complete is not None:
                setattr(agent, "tool_complete_callback", old_tool_complete)
            if old_delegate_output is not None:
                setattr(agent, "_delegate_ext_output_adapter", old_delegate_output)
            else:
                try:
                    delattr(agent, "_delegate_ext_output_adapter")
                except Exception:
                    pass
            if old_delegate_input_factory is not None:
                setattr(agent, "_delegate_ext_input_factory", old_delegate_input_factory)
            else:
                try:
                    delattr(agent, "_delegate_ext_input_factory")
                except Exception:
                    pass
            with self._lock:
                self._running_thread = None

    def _set_run_state(self, state: str, *, source: str) -> None:
        with self._lock:
            self._last_run_state = state
            self._last_state_source = source
        self._send_event(
            "run.state",
            {
                "state": state,
                "srcagent": self._foreground_agent or None,
            },
            source=source,
            turn_id=self._turn_id,
        )

    def _make_event(
        self,
        event_type: str,
        *,
        payload: dict[str, Any],
        source: str,
        turn_id: str | None,
    ) -> dict[str, Any]:
        with self._lock:
            self._event_counter += 1
            envelope = ChatEventEnvelope(
                type=event_type,
                session_id=self.session_id,
                server_event_id=f"{self.session_id}:{self._event_counter}",
                ts=_now_timestamp(),
                turn_id=turn_id,
                source=source,
                payload={key: value for key, value in payload.items() if value is not None},
            )
        return envelope.to_dict()

    def _send_event(
        self,
        event_type: str,
        payload: dict[str, Any],
        *,
        source: str,
        turn_id: str | None = None,
    ) -> None:
        event = self._make_event(
            event_type,
            payload=payload,
            source=source,
            turn_id=turn_id,
        )
        loop = None
        websocket = None
        with self._lock:
            loop = self._loop
            websocket = self._websocket
        if loop is None or websocket is None:
            return

        async def _do_send() -> None:
            try:
                await websocket.send_json(event)
            except Exception:
                return

        try:
            asyncio.run_coroutine_threadsafe(_do_send(), loop)
        except Exception:
            return


class ChatSessionManager:
    def __init__(self, agent_factory: Callable[[str], object] | None = None) -> None:
        self._agent_factory = agent_factory or (
            lambda session_id: default_agent_factory(session_id, platform="aegis")
        )
        self._lock = threading.Lock()
        self._sessions: dict[str, ChatSessionActor] = {}

    def set_agent_factory(self, agent_factory: Callable[[str], object]) -> None:
        with self._lock:
            self._agent_factory = agent_factory
            self._sessions.clear()

    def bind(
        self,
        websocket: WebSocket,
        loop: asyncio.AbstractEventLoop,
        *,
        session_id: str | None,
        title: str | None,
    ) -> ChatSessionActor:
        resolved_session_id = str(session_id or "").strip() or f"aegis-{uuid4().hex}"
        with self._lock:
            actor = self._sessions.get(resolved_session_id)
            if actor is None:
                actor = ChatSessionActor(
                    session_id=resolved_session_id,
                    title=_conversation_title(title),
                    agent_factory=self._agent_factory,
                )
                self._sessions[resolved_session_id] = actor
            else:
                actor.set_title(title)
        actor.replace_connection(websocket, loop)
        return actor

    def get(self, session_id: str) -> ChatSessionActor | None:
        with self._lock:
            return self._sessions.get(session_id)
