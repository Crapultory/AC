from __future__ import annotations

import importlib.util
import io
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest


def _load_script_module():
    script_path = (
        Path(__file__).resolve().parents[2] / "scripts" / "a2a_chat_cli.py"
    )
    spec = importlib.util.spec_from_file_location("a2a_chat_cli", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _make_task(*, task_id: str, context_id: str, state: str, text: str):
    return SimpleNamespace(
        id=task_id,
        context_id=context_id,
        status=SimpleNamespace(
            state=state,
            message=SimpleNamespace(parts=[SimpleNamespace(text=text)]),
        ),
    )


class _FakeEvent:
    def __init__(self, task=None, message=None, status_update=None):
        self.task = task
        self.message = message
        self.status_update = status_update

    def HasField(self, name: str) -> bool:
        return getattr(self, name) is not None


class _FakeClient:
    def __init__(self, turn_plans):
        self.turn_plans = list(turn_plans)
        self.sent_requests = []
        self.turn_index = 0

    async def send_message(self, request):
        self.sent_requests.append(request)
        plan = self.turn_plans[self.turn_index]
        self.turn_index += 1
        yield _FakeEvent(task=plan["initial_task"])

    async def get_task(self, request):
        for plan in self.turn_plans:
            if plan["initial_task"].id == request.id:
                return plan["polls"].pop(0)
        raise AssertionError(f"Unknown task id: {request.id}")


def _make_status_update(*, task_id: str, context_id: str, state, text: str = ""):
    parts = [SimpleNamespace(text=text)] if text else []
    return SimpleNamespace(
        task_id=task_id,
        context_id=context_id,
        status=SimpleNamespace(
            state=state,
            message=SimpleNamespace(parts=parts),
        ),
    )


def _make_message(*, text: str, role, context_id: str = "ctx-1", task_id: str = ""):
    return SimpleNamespace(
        context_id=context_id,
        task_id=task_id,
        role=role,
        parts=[SimpleNamespace(text=text)],
    )


def _make_history_message(
    *,
    role,
    text: str = "",
    context_id: str = "ctx-1",
    task_id: str = "",
    tool_calls=None,
    tool_call_id: str = "",
    tool_name: str = "",
    metadata=None,
):
    return SimpleNamespace(
        context_id=context_id,
        task_id=task_id,
        role=role,
        parts=[SimpleNamespace(text=text)] if text else [],
        tool_calls=tool_calls,
        tool_call_id=tool_call_id,
        tool_name=tool_name,
        metadata=metadata or {},
    )


@pytest.mark.asyncio
async def test_chat_session_streams_text_and_reuses_context() -> None:
    mod = _load_script_module()
    first_task_id = str(uuid4())
    second_task_id = str(uuid4())
    fake_client = _FakeClient(
        [
            {
                "initial_task": _make_task(
                    task_id=first_task_id,
                    context_id="ctx-1",
                    state=mod.TaskState.TASK_STATE_SUBMITTED,
                    text="",
                ),
                "polls": [
                    _make_task(
                        task_id=first_task_id,
                        context_id="ctx-1",
                        state=mod.TaskState.TASK_STATE_WORKING,
                        text="Hel",
                    ),
                    _make_task(
                        task_id=first_task_id,
                        context_id="ctx-1",
                        state=mod.TaskState.TASK_STATE_COMPLETED,
                        text="Hello",
                    ),
                ],
            },
            {
                "initial_task": _make_task(
                    task_id=second_task_id,
                    context_id="ctx-1",
                    state=mod.TaskState.TASK_STATE_SUBMITTED,
                    text="",
                ),
                "polls": [
                    _make_task(
                        task_id=second_task_id,
                        context_id="ctx-1",
                        state=mod.TaskState.TASK_STATE_COMPLETED,
                        text="Second reply",
                    ),
                ],
            },
        ]
    )
    output = io.StringIO()
    session = mod.A2AChatSession(
        fake_client,
        output=output,
        poll_interval=0,
        timeout=1,
    )

    first_reply = await session.send_and_stream("hello")
    second_reply = await session.send_and_stream("follow up")

    assert first_reply == "Hello"
    assert second_reply == "Second reply"
    assert output.getvalue() == "Hello\nSecond reply\n"
    assert fake_client.sent_requests[0].message.context_id == ""
    assert fake_client.sent_requests[0].message.task_id == ""
    assert fake_client.sent_requests[1].message.context_id == "ctx-1"
    assert fake_client.sent_requests[1].message.task_id == ""


@pytest.mark.asyncio
async def test_chat_session_ignores_user_history_when_polling() -> None:
    mod = _load_script_module()
    task_id = str(uuid4())
    fake_client = _FakeClient(
        [
            {
                "initial_task": SimpleNamespace(
                    id=task_id,
                    context_id="ctx-1",
                    status=SimpleNamespace(state=mod.TaskState.TASK_STATE_SUBMITTED),
                    history=[
                        _make_message(
                            text="hello",
                            role=mod.Role.ROLE_USER,
                            task_id=task_id,
                        )
                    ],
                ),
                "polls": [
                    _make_task(
                        task_id=task_id,
                        context_id="ctx-1",
                        state=mod.TaskState.TASK_STATE_COMPLETED,
                        text="echo(turn=1): hello",
                    ),
                ],
            }
        ]
    )
    output = io.StringIO()
    session = mod.A2AChatSession(fake_client, output=output, poll_interval=0, timeout=1)

    reply = await session.send_and_stream("hello")

    assert reply == "echo(turn=1): hello"
    assert output.getvalue() == "echo(turn=1): hello\n"


@pytest.mark.asyncio
async def test_chat_session_consumes_stream_events_when_available() -> None:
    mod = _load_script_module()
    task_id = str(uuid4())

    class _StreamingClient:
        def __init__(self):
            self.sent_requests = []

        async def send_message(self, request):
            self.sent_requests.append(request)
            yield _FakeEvent(
                task=SimpleNamespace(
                    id=task_id,
                    context_id="ctx-1",
                    status=SimpleNamespace(
                        state=mod.TaskState.TASK_STATE_WORKING,
                        message=_make_message(
                            text="Hel",
                            role=mod.Role.ROLE_AGENT,
                            task_id=task_id,
                        ),
                    ),
                )
            )
            yield _FakeEvent(
                task=SimpleNamespace(
                    id=task_id,
                    context_id="ctx-1",
                    status=SimpleNamespace(
                        state=mod.TaskState.TASK_STATE_COMPLETED,
                        message=_make_message(
                            text="Hello",
                            role=mod.Role.ROLE_AGENT,
                            task_id=task_id,
                        ),
                    ),
                )
            )

        async def get_task(self, request):
            raise AssertionError("Polling should not happen for completed stream responses.")

    output = io.StringIO()
    session = mod.A2AChatSession(_StreamingClient(), output=output, poll_interval=0, timeout=1)

    reply = await session.send_and_stream("hello")

    assert reply == "Hello"
    assert output.getvalue() == "Hello\n"


@pytest.mark.asyncio
async def test_chat_session_consumes_status_update_stream_events() -> None:
    mod = _load_script_module()
    task_id = str(uuid4())

    class _StatusStreamingClient:
        def __init__(self):
            self.sent_requests = []

        async def send_message(self, request):
            self.sent_requests.append(request)
            yield _FakeEvent(
                task=SimpleNamespace(
                    id=task_id,
                    context_id="ctx-1",
                    status=SimpleNamespace(state=mod.TaskState.TASK_STATE_SUBMITTED),
                )
            )
            yield _FakeEvent(
                status_update=_make_status_update(
                    task_id=task_id,
                    context_id="ctx-1",
                    state=mod.TaskState.TASK_STATE_WORKING,
                    text="Hel",
                )
            )
            yield _FakeEvent(
                status_update=_make_status_update(
                    task_id=task_id,
                    context_id="ctx-1",
                    state=mod.TaskState.TASK_STATE_COMPLETED,
                    text="Hello",
                )
            )

        async def get_task(self, request):
            raise AssertionError("Polling should not happen when status updates complete the stream.")

    output = io.StringIO()
    session = mod.A2AChatSession(_StatusStreamingClient(), output=output, poll_interval=0, timeout=1)

    reply = await session.send_and_stream("hello")

    assert reply == "Hello"
    assert output.getvalue() == "Hello\n"


@pytest.mark.asyncio
async def test_chat_session_renders_tool_messages_from_stream_and_polling() -> None:
    mod = _load_script_module()
    task_id = str(uuid4())
    tool_call = {
        "id": "call_1",
        "function": {
            "name": "web_search",
            "arguments": '{"q":"cats"}',
        },
    }
    fake_client = _FakeClient(
        [
            {
                "initial_task": SimpleNamespace(
                    id=task_id,
                    context_id="ctx-1",
                    status=SimpleNamespace(state=mod.TaskState.TASK_STATE_SUBMITTED),
                    history=[
                        _make_history_message(
                            role=mod.Role.ROLE_AGENT,
                            task_id=task_id,
                            tool_calls=[tool_call],
                        )
                    ],
                ),
                "polls": [
                    SimpleNamespace(
                        id=task_id,
                        context_id="ctx-1",
                        status=SimpleNamespace(
                            state=mod.TaskState.TASK_STATE_WORKING,
                            message=_make_message(
                                text="Searching...",
                                role=mod.Role.ROLE_AGENT,
                                task_id=task_id,
                            ),
                        ),
                        history=[
                            _make_history_message(
                                role="tool",
                                task_id=task_id,
                                tool_call_id="call_1",
                                tool_name="web_search",
                                text='{"results":["cats"]}',
                            )
                        ],
                    ),
                    _make_task(
                        task_id=task_id,
                        context_id="ctx-1",
                        state=mod.TaskState.TASK_STATE_COMPLETED,
                        text="Here is the summary.",
                    ),
                ],
            }
        ]
    )
    output = io.StringIO()
    session = mod.A2AChatSession(fake_client, output=output, poll_interval=0, timeout=1)

    reply = await session.send_and_stream("search cats")

    assert reply == "Here is the summary."
    assert output.getvalue() == (
        'Assistant(tool): web_search({"q":"cats"})\n'
        'Tool: web_search -> {"results":["cats"]}\n'
        'Searching...\n'
        "Here is the summary.\n"
    )


@pytest.mark.asyncio
async def test_chat_session_deduplicates_repeated_tool_messages_across_polls() -> None:
    mod = _load_script_module()
    task_id = str(uuid4())
    tool_call = {
        "id": "call_1",
        "function": {
            "name": "search_files",
            "arguments": '{"pattern":"README"}',
        },
    }
    repeated_history = [
        _make_history_message(
            role=mod.Role.ROLE_AGENT,
            task_id=task_id,
            tool_calls=[tool_call],
        ),
        _make_history_message(
            role="tool",
            task_id=task_id,
            tool_call_id="call_1",
            tool_name="search_files",
            text='{"matches":1}',
        ),
    ]
    fake_client = _FakeClient(
        [
            {
                "initial_task": _make_task(
                    task_id=task_id,
                    context_id="ctx-1",
                    state=mod.TaskState.TASK_STATE_SUBMITTED,
                    text="",
                ),
                "polls": [
                    SimpleNamespace(
                        id=task_id,
                        context_id="ctx-1",
                        status=SimpleNamespace(state=mod.TaskState.TASK_STATE_WORKING),
                        history=list(repeated_history),
                    ),
                    SimpleNamespace(
                        id=task_id,
                        context_id="ctx-1",
                        status=SimpleNamespace(
                            state=mod.TaskState.TASK_STATE_COMPLETED,
                            message=_make_message(
                                text="Done.",
                                role=mod.Role.ROLE_AGENT,
                                task_id=task_id,
                            ),
                        ),
                        history=list(repeated_history),
                    ),
                ],
            }
        ]
    )
    output = io.StringIO()
    session = mod.A2AChatSession(fake_client, output=output, poll_interval=0, timeout=1)

    await session.send_and_stream("find readme")

    assert output.getvalue() == (
        'Assistant(tool): search_files({"pattern":"README"})\n'
        'Tool: search_files -> {"matches":1}\n'
        "Done.\n"
    )


@pytest.mark.asyncio
async def test_chat_session_renders_tool_messages_from_metadata_events() -> None:
    mod = _load_script_module()
    task_id = str(uuid4())
    fake_client = _FakeClient(
        [
            {
                "initial_task": SimpleNamespace(
                    id=task_id,
                    context_id="ctx-1",
                    status=SimpleNamespace(state=mod.TaskState.TASK_STATE_SUBMITTED),
                    history=[
                        _make_history_message(
                            role=mod.Role.ROLE_AGENT,
                            task_id=task_id,
                            metadata={
                                "hermes": {
                                    "kind": "tool_call",
                                    "tool_call_id": "call_1",
                                    "name": "web_search",
                                    "arguments": {"q": "cats"},
                                }
                            },
                        )
                    ],
                ),
                "polls": [
                    SimpleNamespace(
                        id=task_id,
                        context_id="ctx-1",
                        status=SimpleNamespace(state=mod.TaskState.TASK_STATE_WORKING),
                        history=[
                            _make_history_message(
                                role=mod.Role.ROLE_AGENT,
                                task_id=task_id,
                                metadata={
                                    "hermes": {
                                        "kind": "tool_result",
                                        "tool_call_id": "call_1",
                                        "name": "web_search",
                                        "result": '{"results":["cats"]}',
                                    }
                                },
                            )
                        ],
                    ),
                    _make_task(
                        task_id=task_id,
                        context_id="ctx-1",
                        state=mod.TaskState.TASK_STATE_COMPLETED,
                        text="Summary complete.",
                    ),
                ],
            }
        ]
    )
    output = io.StringIO()
    session = mod.A2AChatSession(fake_client, output=output, poll_interval=0, timeout=1)

    reply = await session.send_and_stream("search cats")

    assert reply == "Summary complete."
    assert output.getvalue() == (
        'Assistant(tool): web_search({"q":"cats"})\n'
        'Tool: web_search -> {"results":["cats"]}\n'
        "Summary complete.\n"
    )


def test_session_reset_clears_context() -> None:
    mod = _load_script_module()
    session = mod.A2AChatSession(SimpleNamespace(), output=io.StringIO())
    session.context_id = "ctx-1"
    session.task_id = "task-1"

    session.reset()

    assert session.context_id is None
    assert session.task_id is None


@pytest.mark.asyncio
async def test_interactive_chat_handles_reset_and_quit() -> None:
    mod = _load_script_module()
    seen_messages = []

    class _FakeSession:
        def __init__(self):
            self.reset_calls = 0

        async def send_and_stream(self, text: str) -> str:
            seen_messages.append(text)
            return f"reply:{text}"

        def reset(self) -> None:
            self.reset_calls += 1

    inputs = iter(["hello", "/reset", "", "/quit"])
    output = io.StringIO()
    session = _FakeSession()

    await mod.interactive_chat_loop(
        session,
        input_fn=lambda prompt: next(inputs),
        output=output,
    )

    assert seen_messages == ["hello"]
    assert session.reset_calls == 1
    assert "Session reset." in output.getvalue()


@pytest.mark.asyncio
async def test_create_client_disables_stream_read_timeout(monkeypatch) -> None:
    mod = _load_script_module()
    captured = {}

    class _DummyClient:
        async def close(self):
            return None

    class _FakeFactory:
        def __init__(self, config):
            captured["config"] = config

        async def create_from_url(self, base_url):
            captured["base_url"] = base_url
            return _DummyClient()

    monkeypatch.setattr(mod, "ClientFactory", _FakeFactory)

    http_client, sdk_client = await mod._create_client("http://agent.local")

    assert captured["base_url"] == "http://agent.local"
    assert captured["config"].httpx_client is http_client
    assert isinstance(http_client.timeout, httpx.Timeout)
    assert http_client.timeout.read is None
    assert http_client.timeout.connect == 10.0
    assert http_client.timeout.write == 60.0
    assert http_client.timeout.pool == 60.0
    await sdk_client.close()
    await http_client.aclose()
