from __future__ import annotations

import json
import threading
import time
from typing import Any

from fastapi.testclient import TestClient


def _recv_until(ws, event_type: str, *, timeout: float = 3.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        payload = ws.receive_json()
        if payload.get("type") == event_type:
            return payload
    raise AssertionError(f"Timed out waiting for event type={event_type!r}")


def _recv_until_one_of(ws, event_types: set[str], *, timeout: float = 3.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        payload = ws.receive_json()
        if payload.get("type") in event_types:
            return payload
    raise AssertionError(f"Timed out waiting for event types={sorted(event_types)!r}")


class _StreamingAgent:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.stream_delta_callback = None
        self.tool_start_callback = None
        self.tool_complete_callback = None

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
        persist_user_message: bool = True,
    ) -> dict[str, Any]:
        del system_message, conversation_history, task_id, stream_callback, persist_user_message
        if callable(self.stream_delta_callback):
            self.stream_delta_callback("hello ")
            self.stream_delta_callback("world")
        return {"final_response": f"hello world: {user_message}", "completed": True}


class _SwitchableAgent(_StreamingAgent):
    def __init__(self, session_id: str):
        super().__init__(session_id)
        self.provider = "openai"
        self.model = "gpt-4.1-mini"
        self.base_url = "https://api.openai.com/v1"
        self.api_key = "test-key"
        self.api_mode = "responses"
        self.switch_calls: list[dict[str, str]] = []

    def switch_model(
        self,
        new_model: str,
        new_provider: str,
        api_key: str = "",
        base_url: str = "",
        api_mode: str = "",
    ) -> None:
        self.switch_calls.append(
            {
                "new_model": new_model,
                "new_provider": new_provider,
                "api_key": api_key,
                "base_url": base_url,
                "api_mode": api_mode,
            }
        )
        self.model = new_model
        self.provider = new_provider
        self.api_key = api_key
        self.base_url = base_url
        self.api_mode = api_mode


class _SlowSwitchableAgent(_SwitchableAgent):
    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
        persist_user_message: bool = True,
    ) -> dict[str, Any]:
        del system_message, conversation_history, task_id, stream_callback, persist_user_message
        if callable(self.stream_delta_callback):
            self.stream_delta_callback("hello ")
        time.sleep(0.2)
        if callable(self.stream_delta_callback):
            self.stream_delta_callback("world")
        return {"final_response": f"hello world: {user_message}", "completed": True}


class _HeaderAwareSwitchableAgent(_StreamingAgent):
    def __init__(self, session_id: str):
        super().__init__(session_id)
        self.provider = "qwen"
        self.model = "qwen3-coder-plus"
        self.base_url = "https://portal.qwen.ai/v1"
        self.api_key = "test-key"
        self.api_mode = "chat_completions"
        self._client_kwargs = {
            "api_key": self.api_key,
            "base_url": self.base_url,
        }
        self.client = {"kwargs": dict(self._client_kwargs)}
        self.switch_calls: list[dict[str, Any]] = []
        self.rebuilt_clients: list[dict[str, Any]] = []
        self.header_refresh_calls: list[str] = []
        self._primary_runtime = {
            "model": self.model,
            "provider": self.provider,
            "base_url": self.base_url,
            "api_mode": self.api_mode,
            "api_key": self.api_key,
            "client_kwargs": dict(self._client_kwargs),
        }

    def switch_model(
        self,
        new_model: str,
        new_provider: str,
        api_key: str = "",
        base_url: str = "",
        api_mode: str = "",
    ) -> None:
        self.switch_calls.append(
            {
                "new_model": new_model,
                "new_provider": new_provider,
                "api_key": api_key,
                "base_url": base_url,
                "api_mode": api_mode,
            }
        )
        self.model = new_model
        self.provider = new_provider
        self.api_key = api_key
        self.base_url = base_url
        self.api_mode = api_mode
        self._client_kwargs = {
            "api_key": api_key,
            "base_url": base_url,
        }
        self.client = {"kwargs": dict(self._client_kwargs)}
        self._primary_runtime = {
            "model": self.model,
            "provider": self.provider,
            "base_url": self.base_url,
            "api_mode": self.api_mode,
            "api_key": self.api_key,
            "client_kwargs": dict(self._client_kwargs),
        }

    def _apply_client_headers_for_base_url(self, base_url: str) -> None:
        self.header_refresh_calls.append(base_url)
        if base_url == "https://portal.qwen.ai/v1":
            self._client_kwargs["default_headers"] = {
                "X-DashScope-AuthType": "qwen-oauth",
            }

    def _create_openai_client(self, client_kwargs: dict[str, Any], *, reason: str, shared: bool):
        rebuilt = {
            "kwargs": dict(client_kwargs),
            "reason": reason,
            "shared": shared,
        }
        self.rebuilt_clients.append(rebuilt)
        return rebuilt


class _DelegateAgent:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.stream_delta_callback = None
        self.tool_start_callback = None
        self.tool_complete_callback = None

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
        persist_user_message: bool = True,
    ) -> dict[str, Any]:
        del system_message, conversation_history, task_id, stream_callback, persist_user_message
        if callable(self.tool_start_callback):
            self.tool_start_callback("call-delegate", "a2a_delegate", {"a2a_name": "threat-intel"})
        output = getattr(self, "_delegate_ext_output_adapter")
        input_factory = getattr(self, "_delegate_ext_input_factory")
        input_adapter = input_factory()
        assert input_adapter.enter_foreground() is True
        output.emit("delegate", "status", "entered foreground loop", session_id="delegate-sess")
        output.emit("delegate", "ai_delta", "delegate-start: ", session_id="delegate-sess")
        output.emit("delegate", "ai_delta", user_message, session_id="delegate-sess")
        output.emit("delegate", "ai", f"delegate-start: {user_message}", session_id="delegate-sess")
        next_message = input_adapter.read_line()
        output.emit("delegate", "ai_delta", "delegate-followup: ", session_id="delegate-sess")
        output.emit("delegate", "ai_delta", next_message, session_id="delegate-sess")
        output.emit("delegate", "ai", f"delegate-followup: {next_message}", session_id="delegate-sess")
        output.emit("delegate", "status", "return to main", session_id="delegate-sess")
        input_adapter.exit_foreground()
        return {"final_response": "", "completed": True}


class _RemoteCancelHandle:
    def __init__(self) -> None:
        self.cancel_calls = 0
        self.cancelled = threading.Event()

    def cancel(self) -> bool:
        self.cancel_calls += 1
        self.cancelled.set()
        return True


class _DelayedRemoteCancelHandle:
    def __init__(self, delay_seconds: float = 0.2) -> None:
        self.cancel_calls = 0
        self.cancelled = threading.Event()
        self.delay_seconds = delay_seconds

    def has_live_task(self) -> bool:
        return True

    def cancel(self) -> str:
        self.cancel_calls += 1

        def _finish_cancel() -> None:
            time.sleep(self.delay_seconds)
            self.cancelled.set()

        threading.Thread(target=_finish_cancel, daemon=True).start()
        return "sent"


class _FailingRemoteCancelHandle:
    def has_live_task(self) -> bool:
        return True

    def cancel(self) -> str:
        raise RuntimeError("cancel dispatch failed")


class _RemoteCancelableDelegateAgent:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.stream_delta_callback = None
        self.tool_start_callback = None
        self.tool_complete_callback = None
        self.remote_handle = _RemoteCancelHandle()

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
        persist_user_message: bool = True,
    ) -> dict[str, Any]:
        del system_message, conversation_history, task_id, stream_callback, persist_user_message, user_message
        self.remote_handle = _RemoteCancelHandle()
        if callable(self.tool_start_callback):
            self.tool_start_callback("call-delegate", "a2a_delegate", {"a2a_name": "threat-intel"})
        setattr(self, "_active_a2a_delegate_session", self.remote_handle)
        output = getattr(self, "_delegate_ext_output_adapter")
        input_factory = getattr(self, "_delegate_ext_input_factory")
        input_adapter = input_factory()
        assert input_adapter.enter_foreground() is True
        output.emit("delegate", "status", "entered foreground loop", session_id="remote-delegate-sess")
        if self.remote_handle.cancelled.wait(timeout=0.4):
            output.emit("delegate", "status", "interrupted", session_id="remote-delegate-sess")
        else:
            output.emit("delegate", "status", "return to main", session_id="remote-delegate-sess")
        input_adapter.exit_foreground()
        return {"final_response": "", "completed": False, "interrupted": self.remote_handle.cancelled.is_set()}


class _DelayedRemoteCancelableDelegateAgent(_RemoteCancelableDelegateAgent):
    def __init__(self, session_id: str):
        super().__init__(session_id)
        self.remote_handle = _DelayedRemoteCancelHandle()

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
        persist_user_message: bool = True,
    ) -> dict[str, Any]:
        del system_message, conversation_history, task_id, stream_callback, persist_user_message, user_message
        self.remote_handle = _DelayedRemoteCancelHandle()
        if callable(self.tool_start_callback):
            self.tool_start_callback("call-delegate", "a2a_delegate", {"a2a_name": "threat-intel"})
        setattr(self, "_active_a2a_delegate_session", self.remote_handle)
        output = getattr(self, "_delegate_ext_output_adapter")
        input_factory = getattr(self, "_delegate_ext_input_factory")
        input_adapter = input_factory()
        assert input_adapter.enter_foreground() is True
        output.emit("delegate", "status", "entered foreground loop", session_id="remote-delegate-sess")
        if self.remote_handle.cancelled.wait(timeout=0.6):
            output.emit("delegate", "status", "interrupted", session_id="remote-delegate-sess")
        else:
            output.emit("delegate", "status", "return to main", session_id="remote-delegate-sess")
        input_adapter.exit_foreground()
        return {"final_response": "", "completed": False, "interrupted": self.remote_handle.cancelled.is_set()}


class _FailingRemoteCancelableDelegateAgent(_RemoteCancelableDelegateAgent):
    def __init__(self, session_id: str):
        super().__init__(session_id)
        self.remote_handle = _FailingRemoteCancelHandle()

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
        persist_user_message: bool = True,
    ) -> dict[str, Any]:
        del system_message, conversation_history, task_id, stream_callback, persist_user_message, user_message
        if callable(self.tool_start_callback):
            self.tool_start_callback("call-delegate", "a2a_delegate", {"a2a_name": "threat-intel"})
        setattr(self, "_active_a2a_delegate_session", self.remote_handle)
        output = getattr(self, "_delegate_ext_output_adapter")
        input_factory = getattr(self, "_delegate_ext_input_factory")
        input_adapter = input_factory()
        assert input_adapter.enter_foreground() is True
        output.emit("delegate", "status", "entered foreground loop", session_id="remote-delegate-sess")
        if self.remote_handle.cancelled.wait(timeout=0.2):
            output.emit("delegate", "status", "interrupted", session_id="remote-delegate-sess")
        input_adapter.exit_foreground()
        return {"final_response": "", "completed": False}


class _InterruptAwareAgent:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.stream_delta_callback = None
        self.tool_start_callback = None
        self.tool_complete_callback = None
        self.interrupt_messages: list[str | None] = []

    def interrupt(self, message: str | None = None) -> None:
        self.interrupt_messages.append(message)

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
        persist_user_message: bool = True,
    ) -> dict[str, Any]:
        del system_message, conversation_history, task_id, stream_callback, persist_user_message, user_message
        time.sleep(0.2)
        return {"final_response": "finished", "completed": True}


class _ApprovalAgent:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.stream_delta_callback = None
        self.tool_start_callback = None
        self.tool_complete_callback = None

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
        persist_user_message: bool = True,
    ) -> dict[str, Any]:
        del system_message, conversation_history, task_id, stream_callback, persist_user_message
        from tools.approval import check_all_command_guards

        decision = check_all_command_guards("rm -rf /tmp/aegis-approval-test", "local")
        approved = bool(decision.get("approved"))
        return {
            "final_response": f"approval: {'approved' if approved else 'denied'}",
            "completed": approved,
            "failed": not approved,
            "error": None if approved else decision.get("message"),
        }


class _ClarifyChoicesAgent:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.stream_delta_callback = None
        self.tool_start_callback = None
        self.tool_complete_callback = None
        self.clarify_callback = None

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
        persist_user_message: bool = True,
    ) -> dict[str, Any]:
        del system_message, conversation_history, task_id, stream_callback, persist_user_message
        answer = ""
        if callable(self.clarify_callback):
            answer = str(
                self.clarify_callback(
                    "Which route should I take?",
                    ["alpha", "beta"],
                )
            )
        return {"final_response": f"clarify choice: {answer or '<missing>'}", "completed": True}


class _ClarifyOpenEndedAgent:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.stream_delta_callback = None
        self.tool_start_callback = None
        self.tool_complete_callback = None
        self.clarify_callback = None

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
        persist_user_message: bool = True,
    ) -> dict[str, Any]:
        del system_message, conversation_history, task_id, stream_callback, persist_user_message
        answer = ""
        if callable(self.clarify_callback):
            answer = str(self.clarify_callback("Describe the target scope.", None))
        return {"final_response": f"clarify freeform: {answer or '<missing>'}", "completed": True}


def test_chat_session_manager_uses_aegis_platform_name(load_backend) -> None:
    service = load_backend("aegis.backend.chat.service")
    from tools import a2a_delegate_tool

    a2a_delegate_tool.A2A_CONTEXT = ""
    captured: dict[str, str] = {}

    def _fake_default_agent_factory(
        session_id: str,
        *,
        platform: str,
        ephemeral_system_prompt: str | None = None,
    ):
        captured["session_id"] = session_id
        captured["platform"] = platform
        captured["ephemeral_system_prompt"] = ephemeral_system_prompt or ""
        return _StreamingAgent(session_id)

    service.default_agent_factory = _fake_default_agent_factory
    manager = service.ChatSessionManager()
    actor = manager.bind(
        websocket=object(),
        loop=object(),
        session_id=None,
        title="Platform Check",
    )

    assert actor.session_id.startswith("aegis-")
    assert captured["session_id"] == actor.session_id
    assert captured["platform"] == "aegis"
    assert captured["ephemeral_system_prompt"] == (
        "<aegis_context>\n"
        "  <active_agents>\n"
        "  </active_agents>\n"
        "  <global_routing>\n"
        "  </global_routing>\n"
        "</aegis_context>"
    )


def test_build_aegis_ephemeral_system_prompt_uses_cached_a2a_context(
    load_backend,
    monkeypatch,
) -> None:
    service = load_backend("aegis.backend.chat.service")
    from tools import a2a_delegate_tool

    monkeypatch.setattr(
        a2a_delegate_tool,
        "A2A_CONTEXT",
        "<aegis_context><active_agents /></aegis_context>",
    )

    def _unexpected_refresh() -> str:
        raise AssertionError("a2a_list should not run when A2A_CONTEXT is already populated")

    monkeypatch.setattr(a2a_delegate_tool, "a2a_list", _unexpected_refresh)

    assert (
        service.build_aegis_ephemeral_system_prompt()
        == "<aegis_context><active_agents /></aegis_context>"
    )


def test_build_aegis_ephemeral_system_prompt_refreshes_empty_a2a_context(
    load_backend,
    monkeypatch,
) -> None:
    service = load_backend("aegis.backend.chat.service")
    from tools import a2a_delegate_tool

    monkeypatch.setattr(a2a_delegate_tool, "A2A_CONTEXT", "")
    refresh_calls = {"count": 0}

    def _refresh() -> str:
        refresh_calls["count"] += 1
        a2a_delegate_tool.A2A_CONTEXT = "<aegis_context><global_routing /></aegis_context>"
        return json.dumps(a2a_delegate_tool.A2A_CONTEXT, ensure_ascii=False)

    monkeypatch.setattr(a2a_delegate_tool, "a2a_list", _refresh)

    assert (
        service.build_aegis_ephemeral_system_prompt()
        == "<aegis_context><global_routing /></aegis_context>"
    )
    assert refresh_calls["count"] == 1


def test_chat_session_manager_injects_active_aegis_context_as_xml(
    load_backend,
    hermes_home,
) -> None:
    service = load_backend("aegis.backend.chat.service")
    from tools import a2a_delegate_tool

    a2a_delegate_tool.A2A_CONTEXT = ""
    (hermes_home / "a2a.json").write_text(
        json.dumps(
            {
                "a2a": {
                    "alpha": {
                        "url": "http://127.0.0.1:9001/a2a",
                        "description": "Primary threat triage agent",
                        "headers": {"Authorization": "Bearer redacted"},
                        "status": "active",
                        "extcapabilities": ["triage alerts", "summarize incidents"],
                    },
                    "bravo": {
                        "url": "http://127.0.0.1:9002/a2a",
                        "description": "Dormant agent",
                        "headers": {},
                        "status": "idle",
                        "extcapabilities": ["should not appear"],
                    },
                },
                "global": [
                    {
                        "id": "rule1234",
                        "name": "SOC escalation",
                        "policy": "route P1 alerts to alpha",
                        "status": "active",
                    },
                    {
                        "id": "rule5678",
                        "name": "Disabled rule",
                        "policy": "should not appear",
                        "status": "inactive",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    captured: dict[str, str] = {}

    def _fake_default_agent_factory(
        session_id: str,
        *,
        platform: str,
        ephemeral_system_prompt: str | None = None,
    ):
        captured["session_id"] = session_id
        captured["platform"] = platform
        captured["ephemeral_system_prompt"] = ephemeral_system_prompt or ""
        return _StreamingAgent(session_id)

    service.default_agent_factory = _fake_default_agent_factory
    manager = service.ChatSessionManager()
    actor = manager.bind(
        websocket=object(),
        loop=object(),
        session_id=None,
        title="Prompt Check",
    )

    assert actor.session_id.startswith("aegis-")
    assert captured["session_id"] == actor.session_id
    assert captured["platform"] == "aegis"
    prompt = captured["ephemeral_system_prompt"]
    assert "<aegis_context>" in prompt
    assert '<agent id="alpha" url="http://127.0.0.1:9001/a2a" status="active">' in prompt
    assert "<capability>triage alerts</capability>" in prompt
    assert "<capability>summarize incidents</capability>" in prompt
    assert '<rule id="rule1234" status="active">' in prompt
    assert "<name>SOC escalation</name>" in prompt
    assert "<policy>route P1 alerts to alpha</policy>" in prompt
    assert "bravo" not in prompt
    assert "should not appear" not in prompt
    assert "Authorization" not in prompt


def test_chat_ws_binds_and_streams_main_agent_events(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _StreamingAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Streaming Test"})
            bound = _recv_until(ws, "session.bound")
            session_id = bound["session_id"]
            assert bound["title"] == "Streaming Test"
            assert bound["resumed"] is False

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "hello aegis",
                    "client_msg_id": "msg-1",
                }
            )
            accepted = _recv_until(ws, "message.accepted")
            assert accepted["session_id"] == session_id
            assert accepted["client_msg_id"] == "msg-1"

            delta = _recv_until(ws, "message.delta")
            assert delta["source"] == "main"
            assert delta["delta"] == "hello "

            completed = _recv_until(ws, "message.completed")
            assert completed["source"] == "main"
            assert completed["content"] == "hello world: hello aegis"


def test_chat_ws_keeps_parallel_sessions_isolated(
    load_backend,
    monkeypatch,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _StreamingAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws_one:
            with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws_two:
                ws_one.send_json({"type": "session.bind", "title": "Parallel One"})
                ws_two.send_json({"type": "session.bind", "title": "Parallel Two"})

                session_one = _recv_until(ws_one, "session.bound")["session_id"]
                session_two = _recv_until(ws_two, "session.bound")["session_id"]
                assert session_one != session_two

                ws_one.send_json(
                    {
                        "type": "message.send",
                        "session_id": session_one,
                        "text": "first parallel task",
                        "client_msg_id": "parallel-1",
                    }
                )
                ws_two.send_json(
                    {
                        "type": "message.send",
                        "session_id": session_two,
                        "text": "second parallel task",
                        "client_msg_id": "parallel-2",
                    }
                )

                completed_one = _recv_until(ws_one, "message.completed")
                completed_two = _recv_until(ws_two, "message.completed")

                assert completed_one["session_id"] == session_one
                assert completed_one["content"] == "hello world: first parallel task"
                assert completed_two["session_id"] == session_two
                assert completed_two["content"] == "hello world: second parallel task"


def test_chat_ws_a2a_slash_returns_cached_context_without_running_agent(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    from tools import a2a_delegate_tool

    a2a_delegate_tool.A2A_CONTEXT = "<aegis_context><active_agents /></aegis_context>"
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _StreamingAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "A2A Cached"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/a2a",
                    "client_msg_id": "msg-a2a",
                }
            )
            accepted = _recv_until(ws, "message.accepted")
            completed = _recv_until(ws, "message.completed")
            assert completed["turn_id"] == accepted["turn_id"]
            assert completed["content"] == "<aegis_context><active_agents /></aegis_context>"


def test_chat_ws_a2a_slash_refreshes_empty_context(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    from tools import a2a_delegate_tool

    a2a_delegate_tool.A2A_CONTEXT = ""
    refresh_calls = {"count": 0}

    def _refresh() -> str:
        refresh_calls["count"] += 1
        a2a_delegate_tool.A2A_CONTEXT = "<aegis_context><global_routing /></aegis_context>"
        return json.dumps(a2a_delegate_tool.A2A_CONTEXT, ensure_ascii=False)

    monkeypatch.setattr(a2a_delegate_tool, "a2a_list", _refresh)
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _StreamingAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "A2A Refresh"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/a2a",
                    "client_msg_id": "msg-a2a-refresh",
                }
            )
            _recv_until(ws, "message.accepted")
            completed = _recv_until(ws, "message.completed")
            assert completed["content"] == "<aegis_context><global_routing /></aegis_context>"
            assert refresh_calls["count"] == 1


def test_chat_ws_a2a_slash_reports_refresh_failure(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    from tools import a2a_delegate_tool

    a2a_delegate_tool.A2A_CONTEXT = ""

    def _broken_refresh() -> str:
        raise RuntimeError("refresh failed")

    monkeypatch.setattr(a2a_delegate_tool, "a2a_list", _broken_refresh)
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _StreamingAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "A2A Error"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/a2a",
                    "client_msg_id": "msg-a2a-error",
                }
            )
            _recv_until(ws, "message.accepted")
            completed = _recv_until(ws, "message.completed")
            assert completed["content"] == "A2A context refresh failed: refresh failed"


def test_chat_ws_help_slash_lists_supported_aegis_commands(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _StreamingAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Help Slash"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/help",
                    "client_msg_id": "msg-help",
                }
            )
            _recv_until(ws, "message.accepted")
            completed = _recv_until(ws, "message.completed")
            assert completed["content"] == (
                "Aegis slash commands:\n"
                "/help - show available Aegis-native slash commands\n"
                "/model <model_name> - switch the current live session model\n"
                "/a2a - show the current A2A context XML\n"
                "/stop - cancel the active remote A2A delegate task"
            )


def test_chat_ws_model_slash_without_args_returns_usage(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    agent = _SwitchableAgent("switchable")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: agent)

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Model Usage"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/model",
                    "client_msg_id": "msg-model-usage",
                }
            )
            _recv_until(ws, "message.accepted")
            completed = _recv_until(ws, "message.completed")
            assert completed["content"] == "Usage: /model <model_name>"
            assert agent.switch_calls == []


def test_chat_ws_model_slash_switches_live_agent(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    agent = _SwitchableAgent("switchable")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: agent)

    from hermes_cli import model_switch as model_switch_module

    def _fake_switch_model(**kwargs):
        assert kwargs["raw_input"] == "gpt-4.1"
        assert kwargs["current_provider"] == "openai"
        assert kwargs["current_model"] == "gpt-4.1-mini"
        assert kwargs["is_global"] is False
        return model_switch_module.ModelSwitchResult(
            success=True,
            new_model="gpt-4.1",
            target_provider="openai",
            api_key="resolved-key",
            base_url="https://api.openai.com/v1",
            api_mode="responses",
            warning_message="",
        )

    monkeypatch.setattr(model_switch_module, "switch_model", _fake_switch_model)

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Model Switch"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/model gpt-4.1",
                    "client_msg_id": "msg-model-switch",
                }
            )
            _recv_until(ws, "message.accepted")
            completed = _recv_until(ws, "message.completed")
            assert completed["content"] == "model -> gpt-4.1"
            assert agent.switch_calls == [
                {
                    "new_model": "gpt-4.1",
                    "new_provider": "openai",
                    "api_key": "resolved-key",
                    "base_url": "https://api.openai.com/v1",
                    "api_mode": "responses",
                }
            ]


def test_chat_ws_model_slash_preserves_live_credentials_when_same_provider_result_is_empty(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    agent = _SwitchableAgent("switchable")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: agent)

    from hermes_cli import model_switch as model_switch_module

    def _fake_switch_model(**kwargs):
        assert kwargs["raw_input"] == "gpt-4.1"
        return model_switch_module.ModelSwitchResult(
            success=True,
            new_model="gpt-4.1",
            target_provider="openai",
            api_key="",
            base_url="",
            api_mode="",
            warning_message="",
        )

    monkeypatch.setattr(model_switch_module, "switch_model", _fake_switch_model)

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Model Switch Preserve Creds"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/model gpt-4.1",
                    "client_msg_id": "msg-model-preserve-creds",
                }
            )
            _recv_until(ws, "message.accepted")
            completed = _recv_until(ws, "message.completed")
            assert completed["content"] == "model -> gpt-4.1"
            assert agent.switch_calls == [
                {
                    "new_model": "gpt-4.1",
                    "new_provider": "openai",
                    "api_key": "test-key",
                    "base_url": "https://api.openai.com/v1",
                    "api_mode": "responses",
                }
            ]


def test_chat_ws_model_slash_rebuilds_live_client_headers_for_provider_specific_runtime(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    agent = _HeaderAwareSwitchableAgent("switchable")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: agent)

    from hermes_cli import model_switch as model_switch_module

    def _fake_switch_model(**kwargs):
        assert kwargs["raw_input"] == "qwen3-coder-plus"
        return model_switch_module.ModelSwitchResult(
            success=True,
            new_model="qwen3-coder-plus",
            target_provider="qwen",
            api_key="test-key",
            base_url="https://portal.qwen.ai/v1",
            api_mode="chat_completions",
            warning_message="",
        )

    monkeypatch.setattr(model_switch_module, "switch_model", _fake_switch_model)

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Model Switch Rebuild Headers"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/model qwen3-coder-plus",
                    "client_msg_id": "msg-model-rebuild-headers",
                }
            )
            _recv_until(ws, "message.accepted")
            completed = _recv_until(ws, "message.completed")
            assert completed["content"] == "model -> qwen3-coder-plus"
            assert agent.header_refresh_calls == ["https://portal.qwen.ai/v1"]
            assert agent.rebuilt_clients[-1]["kwargs"]["default_headers"] == {
                "X-DashScope-AuthType": "qwen-oauth",
            }
            assert agent.client == agent.rebuilt_clients[-1]
            assert agent._primary_runtime["client_kwargs"]["default_headers"] == {
                "X-DashScope-AuthType": "qwen-oauth",
            }


def test_chat_ws_model_slash_reports_busy_session(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _SlowSwitchableAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Busy Model Switch"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "hello aegis",
                    "client_msg_id": "msg-running",
                }
            )
            _recv_until(ws, "message.accepted")
            _recv_until(ws, "message.delta")

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/model gpt-4.1",
                    "client_msg_id": "msg-model-busy",
                }
            )
            accepted = _recv_until(ws, "message.accepted")
            error = _recv_until(ws, "message.completed")
            assert error["turn_id"] == accepted["turn_id"]
            assert error["content"] == "session busy — interrupt the current turn before switching models"


def test_chat_ws_model_slash_reports_switch_failure(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    agent = _SwitchableAgent("switchable")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: agent)

    from hermes_cli import model_switch as model_switch_module

    def _broken_switch_model(**kwargs):
        raise ValueError("unknown model")

    monkeypatch.setattr(model_switch_module, "switch_model", _broken_switch_model)

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Model Failure"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/model bad-model",
                    "client_msg_id": "msg-model-fail",
                }
            )
            _recv_until(ws, "message.accepted")
            completed = _recv_until(ws, "message.completed")
            assert completed["content"] == "Model switch failed: unknown model"
            assert agent.switch_calls == []


def test_chat_ws_routes_follow_up_into_delegate_foreground_with_srcagent(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _DelegateAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Delegate Test"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "delegate please",
                    "client_msg_id": "msg-1",
                }
            )
            first_accepted = _recv_until(ws, "message.accepted")
            entered = _recv_until(ws, "delegate.entered")
            assert entered["session_id"] == session_id
            assert entered["srcagent"] == "threat-intel"

            first_delegate_delta = _recv_until(ws, "message.delta")
            assert first_delegate_delta["source"] == "delegate"
            assert first_delegate_delta["srcagent"] == "threat-intel"
            assert first_delegate_delta["delta"] == "delegate-start: "
            assert first_delegate_delta["turn_id"] == first_accepted["turn_id"]

            first_delegate_reply = _recv_until(ws, "message.completed")
            assert first_delegate_reply["source"] == "delegate"
            assert first_delegate_reply["srcagent"] == "threat-intel"
            assert first_delegate_reply["content"] == "delegate-start: delegate please"
            assert first_delegate_reply["message_id"] == first_delegate_delta["message_id"]
            assert first_delegate_reply["turn_id"] == first_accepted["turn_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "follow-up routed to delegate",
                    "client_msg_id": "msg-2",
                }
            )
            second_accepted = _recv_until(ws, "message.accepted")
            assert second_accepted["turn_id"] != first_accepted["turn_id"]
            second_delegate_delta = _recv_until(ws, "message.delta")
            assert second_delegate_delta["source"] == "delegate"
            assert second_delegate_delta["srcagent"] == "threat-intel"
            assert second_delegate_delta["delta"] == "delegate-followup: "
            assert second_delegate_delta["turn_id"] == second_accepted["turn_id"]
            second_delegate_reply = _recv_until(ws, "message.completed")
            assert second_delegate_reply["source"] == "delegate"
            assert second_delegate_reply["srcagent"] == "threat-intel"
            assert second_delegate_reply["content"] == "delegate-followup: follow-up routed to delegate"
            assert second_delegate_reply["message_id"] == second_delegate_delta["message_id"]
            assert second_delegate_reply["turn_id"] == second_accepted["turn_id"]

            exited = _recv_until(ws, "delegate.exited")
            assert exited["srcagent"] == "threat-intel"
            assert exited["reason"] == "return_to_main"
            assert exited["turn_id"] == second_accepted["turn_id"]


def test_chat_ws_stop_slash_cancels_active_remote_a2a_delegate(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    agent = _RemoteCancelableDelegateAgent("remote-cancel")
    app.state.chat_manager.set_agent_factory(lambda session_id: agent)

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Remote Stop Slash"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "start remote delegate",
                    "client_msg_id": "msg-1",
                }
            )
            _recv_until(ws, "message.accepted")
            entered = _recv_until(ws, "delegate.entered")
            assert entered["srcagent"] == "threat-intel"

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/stop",
                    "client_msg_id": "msg-stop",
                }
            )
            _recv_until(ws, "message.accepted")
            exited = _recv_until_one_of(ws, {"delegate.exited", "error"})
            assert exited["type"] == "delegate.exited"
            assert exited["source"] == "delegate"
            assert exited["srcagent"] == "threat-intel"
            assert exited["reason"] == "interrupted"
            assert agent.remote_handle.cancel_calls == 1

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "start remote delegate again",
                    "client_msg_id": "msg-2",
                }
            )
            _recv_until(ws, "message.accepted")
            reentered = _recv_until(ws, "delegate.entered")
            assert reentered["srcagent"] == "threat-intel"

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/stop",
                    "client_msg_id": "msg-stop-2",
                }
            )
            _recv_until(ws, "message.accepted")
            second_exit = _recv_until_one_of(ws, {"delegate.exited", "error"})
            assert second_exit["type"] == "delegate.exited"
            assert second_exit["reason"] == "interrupted"


def test_chat_ws_session_interrupt_cancels_active_remote_a2a_delegate(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    agent = _RemoteCancelableDelegateAgent("remote-cancel")
    app.state.chat_manager.set_agent_factory(lambda session_id: agent)

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Remote Interrupt"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "start remote delegate",
                    "client_msg_id": "msg-1",
                }
            )
            _recv_until(ws, "message.accepted")
            entered = _recv_until(ws, "delegate.entered")
            assert entered["srcagent"] == "threat-intel"

            ws.send_json({"type": "session.interrupt", "session_id": session_id})

            exited = _recv_until_one_of(ws, {"delegate.exited", "error"})
            assert exited["type"] == "delegate.exited"
            assert exited["source"] == "delegate"
            assert exited["srcagent"] == "threat-intel"
            assert exited["reason"] == "interrupted"
            assert agent.remote_handle.cancel_calls == 1


def test_chat_ws_stop_slash_treats_delayed_cancel_dispatch_as_success(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    agent = _DelayedRemoteCancelableDelegateAgent("remote-delayed-cancel")
    app.state.chat_manager.set_agent_factory(lambda session_id: agent)

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Remote Delayed Stop"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "start remote delegate",
                    "client_msg_id": "msg-1",
                }
            )
            _recv_until(ws, "message.accepted")
            _recv_until(ws, "delegate.entered")

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/stop",
                    "client_msg_id": "msg-stop",
                }
            )
            _recv_until(ws, "message.accepted")
            run_state = _recv_until_one_of(ws, {"run.state", "error"})
            assert run_state["type"] == "run.state"
            assert run_state["state"] == "interrupted"
            exited = _recv_until_one_of(ws, {"delegate.exited", "error"})
            assert exited["type"] == "delegate.exited"
            assert exited["reason"] == "interrupted"
            assert agent.remote_handle.cancel_calls == 1


def test_chat_ws_stop_slash_reports_real_cancel_failures(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    agent = _FailingRemoteCancelableDelegateAgent("remote-failing-cancel")
    app.state.chat_manager.set_agent_factory(lambda session_id: agent)

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Remote Failing Stop"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "start remote delegate",
                    "client_msg_id": "msg-1",
                }
            )
            _recv_until(ws, "message.accepted")
            _recv_until(ws, "delegate.entered")

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/stop",
                    "client_msg_id": "msg-stop",
                }
            )
            _recv_until(ws, "message.accepted")
            error = _recv_until(ws, "error")
            assert error["code"] == "delegate_cancel_failed"
            assert "cancel dispatch failed" in error["message"]


def test_chat_ws_stop_slash_without_active_delegate_returns_info_message(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    agent = _InterruptAwareAgent("no-remote-delegate")
    app.state.chat_manager.set_agent_factory(lambda session_id: agent)

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "No Remote Stop"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "/stop",
                    "client_msg_id": "msg-stop",
                }
            )
            _recv_until(ws, "message.accepted")
            reply = _recv_until_one_of(ws, {"message.completed", "error"})
            assert reply["type"] == "message.completed"
            assert reply["content"] == "No active remote A2A delegate task."
            assert agent.interrupt_messages == []


def test_chat_ws_session_interrupt_keeps_existing_main_agent_interrupt_behavior(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    agent = _InterruptAwareAgent("interrupt-aware")
    app.state.chat_manager.set_agent_factory(lambda session_id: agent)

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Main Interrupt"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "run main task",
                    "client_msg_id": "msg-1",
                }
            )
            _recv_until(ws, "message.accepted")

            ws.send_json({"type": "session.interrupt", "session_id": session_id})

            while True:
                run_state = _recv_until(ws, "run.state")
                if run_state["state"] == "interrupted":
                    break
            assert run_state["state"] == "interrupted"
            assert run_state["source"] == "main"
            assert agent.interrupt_messages == ["Interrupted by websocket client."]


def test_chat_ws_emits_approval_request_and_resolves_over_same_socket(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _ApprovalAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Approval Test"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "run approval path",
                    "client_msg_id": "msg-1",
                }
            )
            _recv_until(ws, "message.accepted")
            approval = _recv_until(ws, "approval.request")
            assert approval["session_id"] == session_id
            assert approval["choices"] == ["once", "session", "always", "deny"]

            ws.send_json(
                {
                    "type": "approval.respond",
                    "session_id": session_id,
                    "choice": "once",
                }
            )
            resolved = _recv_until(ws, "approval.resolved")
            assert resolved["session_id"] == session_id
            assert resolved["choice"] == "once"

            completed = _recv_until(ws, "message.completed")
            assert completed["content"] == "approval: approved"


def test_chat_ws_emits_clarify_request_and_accepts_choice_response(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _ClarifyChoicesAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Clarify Choice Test"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "start clarify choice",
                    "client_msg_id": "msg-1",
                }
            )
            accepted = _recv_until(ws, "message.accepted")
            clarify = _recv_until(ws, "clarify.request")
            assert clarify["session_id"] == session_id
            assert clarify["question"] == "Which route should I take?"
            assert clarify["choices"] == ["alpha", "beta"]
            assert clarify["turn_id"] == accepted["turn_id"]

            ws.send_json(
                {
                    "type": "clarify.respond",
                    "session_id": session_id,
                    "answer": "beta",
                }
            )
            resolved = _recv_until(ws, "clarify.resolved")
            assert resolved["session_id"] == session_id
            assert resolved["answer"] == "beta"

            completed = _recv_until(ws, "message.completed")
            assert completed["content"] == "clarify choice: beta"


def test_chat_ws_resumes_open_ended_clarify_and_accepts_text_response(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _ClarifyOpenEndedAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Clarify Resume Test"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "start freeform clarify",
                    "client_msg_id": "msg-1",
                }
            )
            accepted = _recv_until(ws, "message.accepted")
            clarify = _recv_until(ws, "clarify.request")
            assert clarify["question"] == "Describe the target scope."
            assert clarify.get("choices") is None
            assert clarify["turn_id"] == accepted["turn_id"]

            ws.send_json(
                {
                    "type": "session.resume",
                    "session_id": session_id,
                }
            )
            resumed_state = _recv_until(ws, "run.state")
            resumed_clarify = _recv_until(ws, "clarify.request")
            assert resumed_state["state"] == "waiting_for_clarify"
            assert resumed_clarify["question"] == "Describe the target scope."

            ws.send_json(
                {
                    "type": "clarify.respond",
                    "session_id": session_id,
                    "answer": "Investigate all Linux endpoints.",
                }
            )
            resolved = _recv_until(ws, "clarify.resolved")
            assert resolved["answer"] == "Investigate all Linux endpoints."

            completed = _recv_until(ws, "message.completed")
            assert completed["content"] == "clarify freeform: Investigate all Linux endpoints."


def test_chat_ws_skips_message_delta_when_disabled(
    load_backend,
    monkeypatch,
    hermes_home,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    monkeypatch.setenv("MESSAGE_DELTA", "False")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    app.state.chat_manager.set_agent_factory(lambda session_id: _StreamingAgent(session_id))

    with TestClient(app) as client:
        with client.websocket_connect("/api/chat/ws?token=test-session-token") as ws:
            ws.send_json({"type": "session.bind", "title": "Delta Disabled"})
            session_id = _recv_until(ws, "session.bound")["session_id"]

            ws.send_json(
                {
                    "type": "message.send",
                    "session_id": session_id,
                    "text": "hello without delta",
                    "client_msg_id": "msg-1",
                }
            )
            _recv_until(ws, "message.accepted")
            next_payload = _recv_until_one_of(ws, {"message.delta", "message.completed"})
            assert next_payload["type"] == "message.completed"
            assert next_payload["content"] == "hello world: hello without delta"
