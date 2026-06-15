from __future__ import annotations

import json
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
        output.emit("delegate", "ai", f"delegate-start: {user_message}", session_id="delegate-sess")
        next_message = input_adapter.read_line()
        output.emit("delegate", "ai", f"delegate-followup: {next_message}", session_id="delegate-sess")
        output.emit("delegate", "status", "return to main", session_id="delegate-sess")
        input_adapter.exit_foreground()
        return {"final_response": "", "completed": True}


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
    assert captured["ephemeral_system_prompt"] == ""


def test_chat_session_manager_injects_active_aegis_context_as_xml(
    load_backend,
    hermes_home,
) -> None:
    service = load_backend("aegis.backend.chat.service")
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
    assert '<agent id="alpha" status="active">' in prompt
    assert "<url>http://127.0.0.1:9001/a2a</url>" in prompt
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

            first_delegate_reply = _recv_until(ws, "message.completed")
            assert first_delegate_reply["source"] == "delegate"
            assert first_delegate_reply["srcagent"] == "threat-intel"
            assert first_delegate_reply["content"] == "delegate-start: delegate please"
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
            second_delegate_reply = _recv_until(ws, "message.completed")
            assert second_delegate_reply["source"] == "delegate"
            assert second_delegate_reply["srcagent"] == "threat-intel"
            assert second_delegate_reply["content"] == "delegate-followup: follow-up routed to delegate"
            assert second_delegate_reply["turn_id"] == second_accepted["turn_id"]

            exited = _recv_until(ws, "delegate.exited")
            assert exited["srcagent"] == "threat-intel"
            assert exited["reason"] == "return_to_main"
            assert exited["turn_id"] == second_accepted["turn_id"]


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
