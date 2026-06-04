from __future__ import annotations

import asyncio
from dataclasses import dataclass
import logging
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import httpx
import pytest
from a2a.client import Client, ClientConfig, ClientFactory
from a2a.types import CancelTaskRequest, GetTaskRequest, Message, Part, Role, SendMessageConfiguration, SendMessageRequest, Task, TaskState

from aisoc.backend.a2a_server import create_a2a_app
import aisoc.backend.a2a.executor as a2a_executor
from aisoc.backend.config import load_aisoc_settings


VALID_TASK_STATES = frozenset(
    {
        TaskState.TASK_STATE_SUBMITTED,
        TaskState.TASK_STATE_WORKING,
        TaskState.TASK_STATE_COMPLETED,
        TaskState.TASK_STATE_FAILED,
        TaskState.TASK_STATE_CANCELED,
        TaskState.TASK_STATE_INPUT_REQUIRED,
        TaskState.TASK_STATE_REJECTED,
        TaskState.TASK_STATE_AUTH_REQUIRED,
    }
)


@dataclass
class _A2AClientBundle:
    http_client: httpx.AsyncClient
    client: Client

    async def close(self) -> None:
        await self.client.close()
        await self.http_client.aclose()


class _BlockingAgent:
    def __init__(self, release_event: asyncio.Event):
        self._release_event = release_event
        self._interrupt_requested = False

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
    ) -> dict[str, object]:
        del system_message, conversation_history, task_id
        while not self._release_event.is_set():
            if self._interrupt_requested:
                raise RuntimeError("Canceled by user.")
            import time

            time.sleep(0.01)
        return {"final_response": f"done:{user_message}"}


class _FailingAgent:
    def __init__(self):
        self._interrupt_requested = False

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
    ) -> dict[str, object]:
        del user_message, system_message, conversation_history, task_id
        raise RuntimeError("boom")


class _InputRequiredAgent:
    def __init__(self):
        self._interrupt_requested = False

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
    ) -> dict[str, object]:
        del user_message, system_message, conversation_history, task_id
        return {"final_response": "Need more information.", "input_required": True}


class _ConversationAgent:
    def __init__(self):
        self._interrupt_requested = False
        self.calls: list[dict[str, object]] = []

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
    ) -> dict[str, object]:
        del system_message
        history = list(conversation_history or [])
        self.calls.append(
            {
                "user_message": user_message,
                "history": history,
                "task_id": task_id,
            }
        )
        return {"final_response": f"history={len(history)}::{user_message}"}


class _StreamingAgent:
    def __init__(self):
        self._interrupt_requested = False

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
    ) -> dict[str, object]:
        del system_message, conversation_history, task_id, user_message
        if stream_callback is not None:
            stream_callback("Hel")
            stream_callback("lo")
            stream_callback(None)
        return {"final_response": "Hello"}


class _ToolCallbackAgent:
    def __init__(self):
        self._interrupt_requested = False

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
    ) -> dict[str, object]:
        del system_message, conversation_history, task_id, user_message
        tool_start = getattr(self, "tool_start_callback", None)
        tool_complete = getattr(self, "tool_complete_callback", None)
        if tool_start is not None:
            tool_start("call_1", "web_search", {"q": "cats"})
        if tool_complete is not None:
            tool_complete("call_1", "web_search", {"q": "cats"}, '{"results":["cats"]}')
        if stream_callback is not None:
            stream_callback("Done")
            stream_callback(None)
        return {"final_response": "Done"}


async def _send_text(
    client: Client,
    text: str,
    *,
    context_id: str | None = None,
    task_id: str | None = None,
) -> Task:
    request = SendMessageRequest(
        message=Message(
            message_id=str(uuid4()),
            role=Role.ROLE_USER,
            context_id=context_id or "",
            task_id=task_id or "",
            parts=[Part(text=text)],
        ),
        configuration=SendMessageConfiguration(return_immediately=True),
    )
    responses = [event async for event in client.send_message(request)]
    if not responses:
        raise RuntimeError("A2A SDK returned no response events.")
    first = responses[0]
    if first.HasField("task"):
        return first.task
    if first.HasField("message"):
        return Task(
            id=first.message.task_id,
            context_id=first.message.context_id,
            status={"state": TaskState.TASK_STATE_COMPLETED},
            history=[first.message],
        )
    raise RuntimeError("Unexpected A2A response without task or message.")


async def _wait_for_state(
    client: Client,
    task_id: str,
    expected_states: set[int],
    *,
    timeout: float = 5.0,
    poll_interval: float = 0.02,
) -> Task:
    invalid = expected_states - VALID_TASK_STATES
    if invalid:
        raise ValueError(f"Unsupported task states: {sorted(invalid)}")

    deadline = asyncio.get_running_loop().time() + timeout
    last_task: Task | None = None
    while asyncio.get_running_loop().time() < deadline:
        task = await client.get_task(GetTaskRequest(id=task_id))
        state = task.status.state
        if state not in VALID_TASK_STATES:
            raise AssertionError(f"Server returned invalid task state: {state!r}")
        last_task = task
        if state in expected_states:
            return task
        await asyncio.sleep(poll_interval)
    raise TimeoutError(f"Timed out waiting for states {sorted(expected_states)}; last={last_task}")


async def _task_bundle(agent_factory, *, streaming: bool = False) -> _A2AClientBundle:
    settings = load_aisoc_settings(host="127.0.0.1", port=9086, open_browser=False)
    app = create_a2a_app(settings, agent_factory=agent_factory, streaming=streaming)
    transport = httpx.ASGITransport(app=app)
    http_client = httpx.AsyncClient(transport=transport, base_url="http://testserver")
    factory = ClientFactory(
        ClientConfig(
            httpx_client=http_client,
            streaming=streaming,
            polling=True,
        )
    )
    client = await factory.create_from_url("http://testserver")
    return _A2AClientBundle(http_client=http_client, client=client)


@pytest.mark.asyncio
async def test_a2a_message_send_task_lifecycle() -> None:
    release_event = asyncio.Event()
    bundle = await _task_bundle(lambda session_id: _BlockingAgent(release_event))
    try:
        card = await bundle.http_client.get("http://testserver/.well-known/agent-card.json")
        assert card.status_code == 200
        assert card.json()["supportedInterfaces"][0]["url"] == "http://127.0.0.1:9086"

        task = await _send_text(bundle.client, "hello world")
        assert task.status.state == TaskState.TASK_STATE_SUBMITTED

        working = await _wait_for_state(bundle.client, task.id, {TaskState.TASK_STATE_WORKING})
        assert working.status.state == TaskState.TASK_STATE_WORKING

        release_event.set()
        completed = await _wait_for_state(bundle.client, task.id, {TaskState.TASK_STATE_COMPLETED})
        assert completed.status.state == TaskState.TASK_STATE_COMPLETED
        assert completed.status.message.parts[0].text == "done:hello world"
    finally:
        await bundle.close()


def test_a2a_default_agent_factory_injects_current_profile_config(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    fake_cfg = {
        "model": {
            "default": "deepseek-v4-flash",
            "provider": "custom:chatai",
        }
    }
    injected_runtime = {
        "provider": "custom",
        "model": "gpt-5.4",
        "base_url": "https://chatai-api.amberainsider.com",
        "api_key": "super-secret-key",
        "api_mode": "chat_completions",
        "source": "custom_provider:chatai",
        "request_overrides": {"extra_body": {"foo": "bar"}},
    }

    def _fake_cfg_get(cfg, *keys, default=None):
        current = cfg
        for key in keys:
            if not isinstance(current, dict) or key not in current:
                return default
            current = current[key]
        return current

    resolved_args: dict[str, object] = {}
    created_kwargs: dict[str, object] = {}
    created_session_dbs: list[object] = []

    class _FakeAgent:
        def __init__(self, **kwargs):
            created_kwargs.update(kwargs)

    class _FakeSessionDB:
        def __init__(self):
            created_session_dbs.append(self)

    def _fake_resolve_runtime_provider(**kwargs):
        resolved_args.update(kwargs)
        return injected_runtime

    monkeypatch.setattr(a2a_executor.hermes_config, "load_config_readonly", lambda: fake_cfg)
    monkeypatch.setattr(a2a_executor.hermes_config, "cfg_get", _fake_cfg_get)
    monkeypatch.setattr(a2a_executor.runtime_provider, "resolve_runtime_provider", _fake_resolve_runtime_provider)
    monkeypatch.setattr("run_agent.AIAgent", _FakeAgent)
    monkeypatch.setattr(a2a_executor, "SessionDB", _FakeSessionDB, raising=False)

    caplog.set_level(logging.INFO, logger="aisoc.backend.a2a.executor")

    agent = a2a_executor._default_agent_factory("context-123")

    assert isinstance(agent, _FakeAgent)
    assert resolved_args == {
        "requested": "custom:chatai",
        "target_model": "deepseek-v4-flash",
    }
    assert created_kwargs["provider"] == "custom"
    assert created_kwargs["model"] == "gpt-5.4"
    assert created_kwargs["base_url"] == "https://chatai-api.amberainsider.com"
    assert created_kwargs["api_key"] == "super-secret-key"
    assert created_kwargs["api_mode"] == "chat_completions"
    assert created_kwargs["request_overrides"] == {"extra_body": {"foo": "bar"}}
    assert created_kwargs["session_id"] == "context-123"
    assert created_kwargs["platform"] == "aisoc-a2a"
    assert created_kwargs["quiet_mode"] is True
    assert created_kwargs["session_db"] is created_session_dbs[0]
    assert "_a2a_runtime_source" not in created_kwargs
    assert "A2A profile injection" in caplog.text


@pytest.mark.asyncio
async def test_a2a_cancel_transitions_task_to_canceled() -> None:
    release_event = asyncio.Event()
    bundle = await _task_bundle(lambda session_id: _BlockingAgent(release_event))
    try:
        task = await _send_text(bundle.client, "__cancel__")
        await _wait_for_state(bundle.client, task.id, {TaskState.TASK_STATE_WORKING})

        await bundle.client.cancel_task(CancelTaskRequest(id=task.id))
        canceled = await _wait_for_state(bundle.client, task.id, {TaskState.TASK_STATE_CANCELED})
        assert canceled.status.state == TaskState.TASK_STATE_CANCELED
        assert canceled.status.message.parts[0].text == "Canceled by user."
    finally:
        await bundle.close()


@pytest.mark.asyncio
async def test_a2a_marks_failed_task() -> None:
    bundle = await _task_bundle(lambda session_id: _FailingAgent())
    try:
        task = await _send_text(bundle.client, "fail please")
        failed = await _wait_for_state(bundle.client, task.id, {TaskState.TASK_STATE_FAILED})
        assert failed.status.state == TaskState.TASK_STATE_FAILED
        assert "boom" in failed.status.message.parts[0].text
    finally:
        await bundle.close()


@pytest.mark.asyncio
async def test_a2a_marks_input_required_task() -> None:
    bundle = await _task_bundle(lambda session_id: _InputRequiredAgent())
    try:
        task = await _send_text(bundle.client, "need more")
        required = await _wait_for_state(bundle.client, task.id, {TaskState.TASK_STATE_INPUT_REQUIRED})
        assert required.status.state == TaskState.TASK_STATE_INPUT_REQUIRED
        assert required.status.message.parts[0].text == "Need more information."
    finally:
        await bundle.close()


@pytest.mark.asyncio
async def test_a2a_continues_conversation_with_context_history() -> None:
    agent = _ConversationAgent()
    bundle = await _task_bundle(lambda session_id: agent)
    try:
        first_task = await _send_text(bundle.client, "first turn")
        first_done = await _wait_for_state(bundle.client, first_task.id, {TaskState.TASK_STATE_COMPLETED})
        assert first_done.status.message.parts[0].text == "history=0::first turn"

        second_task = await _send_text(
            bundle.client,
            "second turn",
            context_id=first_done.context_id,
        )
        second_done = await _wait_for_state(bundle.client, second_task.id, {TaskState.TASK_STATE_COMPLETED})
        assert second_done.status.message.parts[0].text == "history=2::second turn"
        assert len(agent.calls) == 2
        assert agent.calls[1]["history"] == [
            {"role": "user", "content": "first turn"},
            {"role": "assistant", "content": "history=0::first turn"},
        ]
    finally:
        await bundle.close()


@pytest.mark.asyncio
async def test_a2a_agent_card_advertises_streaming_when_enabled() -> None:
    bundle = await _task_bundle(lambda session_id: _StreamingAgent(), streaming=True)
    try:
        card = await bundle.http_client.get("http://testserver/.well-known/agent-card.json")
        assert card.status_code == 200
        assert card.json()["capabilities"]["streaming"] is True
    finally:
        await bundle.close()


@pytest.mark.asyncio
async def test_a2a_streaming_send_message_yields_incremental_status_updates() -> None:
    bundle = await _task_bundle(lambda session_id: _StreamingAgent(), streaming=True)
    try:
        request = SendMessageRequest(
            message=Message(
                message_id=str(uuid4()),
                role=Role.ROLE_USER,
                context_id="",
                task_id="",
                parts=[Part(text="hello")],
            ),
            configuration=SendMessageConfiguration(return_immediately=True),
        )

        events = [event async for event in bundle.client.send_message(request)]

        partials = [
            event.status_update.status.message.parts[0].text
            for event in events
            if event.HasField("status_update")
            and event.status_update.status.state == TaskState.TASK_STATE_WORKING
            and event.status_update.status.message.parts
        ]
        terminal = [
            event.status_update.status.message.parts[0].text
            for event in events
            if event.HasField("status_update")
            and event.status_update.status.state == TaskState.TASK_STATE_COMPLETED
            and event.status_update.status.message.parts
        ]

        assert partials == ["Hel", "Hello"]
        assert terminal == ["Hello"]
    finally:
        await bundle.close()


@pytest.mark.asyncio
async def test_a2a_streaming_send_message_yields_tool_metadata_updates() -> None:
    bundle = await _task_bundle(lambda session_id: _ToolCallbackAgent(), streaming=True)
    try:
        request = SendMessageRequest(
            message=Message(
                message_id=str(uuid4()),
                role=Role.ROLE_USER,
                context_id="",
                task_id="",
                parts=[Part(text="hello")],
            ),
            configuration=SendMessageConfiguration(return_immediately=True),
        )

        events = [event async for event in bundle.client.send_message(request)]

        hermes_payloads = []
        for event in events:
            if not event.HasField("status_update"):
                continue
            metadata = event.status_update.status.message.metadata
            if "hermes" not in metadata:
                continue
            hermes_payloads.append(metadata["hermes"])

        assert [payload["kind"] for payload in hermes_payloads] == [
            "tool_call",
            "tool_result",
        ]
        assert hermes_payloads[0]["name"] == "web_search"
        assert hermes_payloads[0]["arguments"]["q"] == "cats"
        assert hermes_payloads[1]["name"] == "web_search"
        assert hermes_payloads[1]["result"] == '{"results":["cats"]}'
    finally:
        await bundle.close()


@pytest.mark.asyncio
async def test_a2a_default_factory_persists_history_to_session_db(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    import run_agent
    from hermes_state import SessionDB as RealSessionDB

    db_path = tmp_path / "a2a-state.db"
    fake_cfg = {
        "model": {
            "default": "test-model",
            "provider": "test-provider",
        }
    }
    injected_runtime = {
        "provider": "openai",
        "model": "test-model",
        "base_url": "https://example.invalid/v1",
        "api_key": "test-key",
        "api_mode": "chat_completions",
        "source": "test",
    }

    def _fake_cfg_get(cfg, *keys, default=None):
        current = cfg
        for key in keys:
            if not isinstance(current, dict) or key not in current:
                return default
            current = current[key]
        return current

    def _fake_resolve_runtime_provider(**kwargs):
        return injected_runtime

    def _fake_run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
        persist_user_message: str | None = None,
    ) -> dict[str, object]:
        del system_message, task_id, persist_user_message
        history = list(conversation_history or [])
        assistant_text = f"persisted:{user_message}"
        if stream_callback is not None:
            stream_callback(assistant_text)
            stream_callback(None)
        messages = history + [
            {"role": "user", "content": user_message},
            {"role": "assistant", "content": assistant_text},
        ]
        self._persist_session(messages, history)
        return {
            "final_response": assistant_text,
            "messages": messages,
        }

    monkeypatch.setattr(a2a_executor.hermes_config, "load_config_readonly", lambda: fake_cfg)
    monkeypatch.setattr(a2a_executor.hermes_config, "cfg_get", _fake_cfg_get)
    monkeypatch.setattr(a2a_executor.runtime_provider, "resolve_runtime_provider", _fake_resolve_runtime_provider)
    monkeypatch.setattr(a2a_executor, "SessionDB", lambda: RealSessionDB(db_path=db_path), raising=False)
    monkeypatch.setattr(run_agent, "get_tool_definitions", lambda *args, **kwargs: [])
    monkeypatch.setattr(run_agent, "check_toolset_requirements", lambda *args, **kwargs: {})
    monkeypatch.setattr(run_agent, "OpenAI", MagicMock(return_value=SimpleNamespace()))
    monkeypatch.setattr(run_agent.AIAgent, "run_conversation", _fake_run_conversation)

    bundle = await _task_bundle(None)
    try:
        task = await _send_text(bundle.client, "hello persisted")
        completed = await _wait_for_state(bundle.client, task.id, {TaskState.TASK_STATE_COMPLETED})
        assert completed.status.message.parts[0].text == "persisted:hello persisted"

        db = RealSessionDB(db_path=db_path)
        session = db.get_session(completed.context_id)
        messages = db.get_messages(completed.context_id)
        assert session is not None
        assert [msg["role"] for msg in messages[-2:]] == ["user", "assistant"]
        assert messages[-2]["content"] == "hello persisted"
        assert messages[-1]["content"] == "persisted:hello persisted"
    finally:
        await bundle.close()
