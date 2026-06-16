import asyncio
import json
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from a2a.types import Role, TaskState
import a2a.client as a2a_client

import tools.a2a_delegate_tool as a2a_delegate_tool_module
from tools.a2a_delegate_tool import A2A_REGISTRY, _A2ADelegateSession, a2a_delegate


def _make_parent():
    parent = MagicMock()
    parent.base_url = "https://openrouter.ai/api/v1"
    parent.api_key = "***"
    parent.provider = "openrouter"
    parent.api_mode = "chat_completions"
    parent.model = "anthropic/claude-sonnet-4"
    parent.platform = "cli"
    parent.reasoning_config = None
    parent.prefill_messages = None
    parent.max_tokens = None
    parent._fallback_chain = None
    parent.providers_allowed = None
    parent.providers_ignored = None
    parent.providers_order = None
    parent.provider_sort = None
    parent.openrouter_min_coding_score = None
    parent._session_db = None
    parent.session_id = "parent-session"
    parent._print_fn = None
    parent._credential_pool = None
    parent._active_children = []
    parent._active_children_lock = threading.Lock()
    parent._current_task_id = "parent-task"
    return parent


class _OutputSink:
    def __init__(self):
        self.events = []

    def emit(self, source, event_type, content, session_id=None):
        self.events.append((source, event_type, content, session_id))


class _Input:
    def __init__(self, values):
        self._values = iter(values)

    def read_line(self):
        return next(self._values)


class _FakeA2AEvent:
    def __init__(self, task=None, message=None, status_update=None):
        self.task = task
        self.message = message
        self.status_update = status_update

    def HasField(self, name: str) -> bool:
        return getattr(self, name) is not None


class _FakeA2AClient:
    def __init__(self, turn_plans):
        self.turn_plans = list(turn_plans)
        self.sent_requests = []
        self.turn_index = 0

    async def send_message(self, request):
        self.sent_requests.append(request)
        plan = self.turn_plans[self.turn_index]
        self.turn_index += 1
        yield _FakeA2AEvent(task=plan["initial_task"])

    async def get_task(self, request):
        for plan in self.turn_plans:
            if plan["initial_task"].id == request.id:
                return plan["polls"].pop(0)
        raise AssertionError(f"Unknown task id: {request.id}")

    async def close(self):
        return None


class _FakeAsyncHTTPClient:
    async def aclose(self):
        return None


def _make_a2a_task(*, task_id: str, context_id: str, state, text: str = "", history=None, role=None):
    parts = [SimpleNamespace(text=text)] if text else []
    message = SimpleNamespace(parts=parts, role=role) if parts else None
    return SimpleNamespace(
        id=task_id,
        context_id=context_id,
        status=SimpleNamespace(state=state, message=message),
        history=list(history or []),
    )


def _make_a2a_history_message(
    *,
    role,
    text: str = "",
    context_id: str = "ctx-1",
    task_id: str = "",
    metadata=None,
):
    return SimpleNamespace(
        context_id=context_id,
        task_id=task_id,
        role=role,
        parts=[SimpleNamespace(text=text)] if text else [],
        tool_calls=[],
        tool_call_id="",
        tool_name="",
        metadata=metadata or {},
    )


def teardown_module():
    A2A_REGISTRY.clear()


@patch("tools.a2a_delegate_tool.load_conversation_history", return_value=[])
@patch("run_agent.AIAgent")
def test_local_loop_suppresses_user_events(mock_agent_cls, _mock_history):
    parent = _make_parent()
    child = MagicMock()
    child.session_id = "child-session"
    child._session_db = None
    child.run_conversation.side_effect = [
        {"final_response": "first", "completed": True, "api_calls": 1},
        {"final_response": "second", "completed": True, "api_calls": 1},
    ]
    mock_agent_cls.return_value = child
    sink = _OutputSink()

    result = json.loads(
        a2a_delegate(
            goal="start",
            agent="local",
            is_loop=True,
            input=_Input(["follow up", "/main"]),
            output=sink,
            parent_agent=parent,
        )
    )

    assert result["loop_exit_reason"] == "main_command"
    assert result["is_loop"] is True
    assert sink.events == [
        ("delegate", "status", "entered foreground loop", "child-session"),
        ("delegate", "ai", "first", "child-session"),
        ("delegate", "ai", "second", "child-session"),
        ("delegate", "status", "return to main", "child-session"),
    ]


@patch("tools.a2a_delegate_tool.load_conversation_history", return_value=[])
@patch("run_agent.AIAgent")
def test_local_delegate_emits_ai_delta_before_final_message(mock_agent_cls, _mock_history):
    parent = _make_parent()
    child = MagicMock()
    child.session_id = "child-session"
    child._session_db = None

    def _run_conversation(**kwargs):
        del kwargs
        if callable(child.stream_delta_callback):
            child.stream_delta_callback("chunk-1 ")
            child.stream_delta_callback("chunk-2")
            child.stream_delta_callback(None)
        return {"final_response": "chunk-1 chunk-2", "completed": True, "api_calls": 1}

    child.run_conversation.side_effect = _run_conversation
    mock_agent_cls.return_value = child
    sink = _OutputSink()

    result = json.loads(
        a2a_delegate(
            goal="start",
            agent="local",
            output=sink,
            parent_agent=parent,
        )
    )

    assert result["success"] is True
    assert sink.events == [
        ("delegate", "ai_delta", "chunk-1 ", "child-session"),
        ("delegate", "ai_delta", "chunk-2", "child-session"),
        ("delegate", "ai", "chunk-1 chunk-2", "child-session"),
    ]


@pytest.mark.asyncio
async def test_a2a_session_suppresses_tool_result_events():
    task_id = str(uuid4())
    fake_client = _FakeA2AClient(
        [
            {
                "initial_task": _make_a2a_task(
                    task_id=task_id,
                    context_id="ctx-1",
                    state=TaskState.TASK_STATE_SUBMITTED,
                ),
                "polls": [
                    SimpleNamespace(
                        id=task_id,
                        context_id="ctx-1",
                        status=SimpleNamespace(state=TaskState.TASK_STATE_WORKING),
                        history=[
                            _make_a2a_history_message(
                                role=Role.ROLE_AGENT,
                                task_id=task_id,
                                metadata={
                                    "hermes": {
                                        "kind": "tool_call",
                                        "tool_call_id": "call_1",
                                        "name": "web_search",
                                        "arguments": {"q": "cats"},
                                    }
                                },
                            ),
                            _make_a2a_history_message(
                                role=Role.ROLE_AGENT,
                                task_id=task_id,
                                metadata={
                                    "hermes": {
                                        "kind": "tool_result",
                                        "tool_call_id": "call_1",
                                        "name": "web_search",
                                        "result": '{"results":["cats"]}',
                                    }
                                },
                            ),
                        ],
                    ),
                    _make_a2a_task(
                        task_id=task_id,
                        context_id="ctx-1",
                        state=TaskState.TASK_STATE_WORKING,
                        text="final ",
                        role=Role.ROLE_AGENT,
                    ),
                    _make_a2a_task(
                        task_id=task_id,
                        context_id="ctx-1",
                        state=TaskState.TASK_STATE_COMPLETED,
                        text="final reply",
                        role=Role.ROLE_AGENT,
                    ),
                ],
            }
        ]
    )
    sink = _OutputSink()
    session = _A2ADelegateSession(
        "http://agent.local",
        output=sink,
        poll_interval=0,
        timeout=1,
    )
    session._client = fake_client
    session._http_client = _FakeAsyncHTTPClient()

    result = await session.send_turn("hello")
    await session.close()

    assert result["final_response"] == "final reply"
    assert sink.events == [
        ("delegate", "tool_call", 'web_search {"q":"cats"}', "ctx-1"),
        ("delegate", "ai_delta", "final ", "ctx-1"),
        ("delegate", "ai_delta", "reply", "ctx-1"),
        ("delegate", "ai", "final reply", "ctx-1"),
    ]


@pytest.mark.asyncio
async def test_a2a_session_open_applies_configured_headers(monkeypatch):
    captured = {}

    class _FakeHTTPClient:
        def __init__(self, *args, **kwargs):
            del args
            captured["headers"] = kwargs.get("headers")

        async def aclose(self):
            captured["http_closed"] = True

    class _FakeRemoteClient:
        async def close(self):
            captured["client_closed"] = True

    class _FakeClientFactory:
        def __init__(self, config):
            captured["config_http_client"] = config.httpx_client

        async def create_from_url(self, base_url):
            captured["base_url"] = base_url
            return _FakeRemoteClient()

    monkeypatch.setattr("tools.a2a_delegate_tool.httpx.AsyncClient", _FakeHTTPClient)
    monkeypatch.setattr(a2a_client, "ClientFactory", _FakeClientFactory)

    session = _A2ADelegateSession(
        "http://agent.local",
        headers={"Authorization": "Bearer token"},
    )

    await session.open()
    await session.close()

    assert captured["headers"] == {"Authorization": "Bearer token"}
    assert captured["base_url"] == "http://agent.local"
    assert captured["http_closed"] is True
    assert captured["client_closed"] is True


@pytest.mark.asyncio
async def test_a2a_session_cancel_issues_cancel_task_request():
    captured = {}

    class _CancelableClient:
        async def cancel_task(self, request, *, context=None):
            del context
            captured["request_id"] = request.id
            return _make_a2a_task(
                task_id=request.id,
                context_id="ctx-1",
                state=TaskState.TASK_STATE_CANCELED,
                role=Role.ROLE_AGENT,
            )

        async def close(self):
            return None

    session = _A2ADelegateSession("http://agent.local", session_id="ctx-1")
    session._client = _CancelableClient()
    session._http_client = _FakeAsyncHTTPClient()
    session.task_id = "task-123"

    result = await session.cancel()
    await session.close()

    assert captured["request_id"] == "task-123"
    assert result.id == "task-123"


def test_a2a_cancel_handle_runs_cancel_on_owner_loop_from_foreign_thread():
    session = _A2ADelegateSession("http://agent.local", session_id="ctx-1")
    owner_thread_id = {"value": None}
    cancel_thread_id = {"value": None}
    ready = threading.Event()
    cancelled = threading.Event()

    class _CancelableClient:
        async def cancel_task(self, request, *, context=None):
            del context
            cancel_thread_id["value"] = threading.get_ident()
            cancelled.set()
            return _make_a2a_task(
                task_id=request.id,
                context_id="ctx-1",
                state=TaskState.TASK_STATE_CANCELED,
                role=Role.ROLE_AGENT,
            )

        async def close(self):
            return None

    session._client = _CancelableClient()
    session._http_client = _FakeAsyncHTTPClient()
    session.task_id = "task-123"

    def _run_owner_loop() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        session._owner_loop = loop
        session._owner_thread_id = threading.get_ident()
        owner_thread_id["value"] = threading.get_ident()
        ready.set()
        loop.run_forever()
        loop.close()

    worker = threading.Thread(target=_run_owner_loop, daemon=True)
    worker.start()
    assert ready.wait(timeout=1.0) is True

    try:
        handle = a2a_delegate_tool_module._RemoteA2ADelegateCancelHandle(session)
        assert handle.cancel() == "sent"
    finally:
        owner_loop, _owner_tid = session.owner_runtime()
        assert owner_loop is not None
        assert cancelled.wait(timeout=1.0) is True
        owner_loop.call_soon_threadsafe(owner_loop.stop)
        worker.join(timeout=1.0)

    assert cancel_thread_id["value"] == owner_thread_id["value"]


def test_a2a_cancel_handle_returns_completed_when_owner_loop_future_finishes_immediately():
    session = _A2ADelegateSession("http://agent.local", session_id="ctx-1")
    session.task_id = "task-123"
    loop = MagicMock()
    loop.is_running.return_value = True
    session._owner_loop = loop
    session._owner_thread_id = threading.get_ident() + 1

    class _DoneFuture:
        def done(self):
            return True

        def result(self):
            return _make_a2a_task(
                task_id="task-123",
                context_id="ctx-1",
                state=TaskState.TASK_STATE_CANCELED,
                role=Role.ROLE_AGENT,
            )

    def _patched_run_coroutine_threadsafe(coro, owner_loop):
        del owner_loop
        coro.close()
        return _DoneFuture()

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(
        a2a_delegate_tool_module.asyncio,
        "run_coroutine_threadsafe",
        _patched_run_coroutine_threadsafe,
    )
    try:
        handle = a2a_delegate_tool_module._RemoteA2ADelegateCancelHandle(session)
        assert handle.cancel() == "completed"
    finally:
        monkeypatch.undo()


@patch("tools.a2a_delegate_tool.load_conversation_history", return_value=[])
@patch("run_agent.AIAgent")
def test_local_mode_returns_default_session_id(mock_agent_cls, _mock_history, monkeypatch):
    parent = _make_parent()
    child = MagicMock()
    child.session_id = None
    child._session_db = None
    child.run_conversation.return_value = {
        "final_response": "done",
        "completed": True,
        "api_calls": 1,
    }
    mock_agent_cls.return_value = child
    monkeypatch.setattr("tools.a2a_delegate_tool.get_active_profile_name", lambda: "worker_alpha")
    monkeypatch.setattr("tools.a2a_delegate_tool.time.strftime", lambda fmt: "20260606_120000")

    result = json.loads(a2a_delegate(goal="inspect code", agent="local", parent_agent=parent))

    assert result["session_id"] == "delegate_worker_alpha_local_20260606_120000"
    _, kwargs = mock_agent_cls.call_args
    assert kwargs["session_id"] == "delegate_worker_alpha_local_20260606_120000"


def test_a2a_mode_returns_default_session_id(monkeypatch):
    parent = _make_parent()
    A2A_REGISTRY["remote"] = {
        "name": "remote",
        "url": "http://agent.local",
        "available": True,
        "capabilities": ["streaming"],
        "agent_card": {"supported_interfaces": [{"url": "http://agent.local/a2a"}]},
        "agent_card_name": "Remote Agent",
        "error": None,
    }
    captured = {}

    class _FakeSession:
        def __init__(
            self,
            base_url,
            *,
            output=None,
            timeout=60.0,
            poll_interval=0.05,
            session_id=None,
        ):
            del base_url, output, timeout, poll_interval
            captured["session_id"] = session_id
            self.context_id = session_id

        async def send_turn(self, text: str, *, is_delegate_output: bool = True):
            del text, is_delegate_output
            return {
                "final_response": "remote:first",
                "state": TaskState.TASK_STATE_COMPLETED,
                "state_name": "completed",
            }

        async def close(self):
            return None

    monkeypatch.setattr("tools.a2a_delegate_tool.get_active_profile_name", lambda: "worker_alpha")
    monkeypatch.setattr("tools.a2a_delegate_tool.time.strftime", lambda fmt: "20260606_120000")
    monkeypatch.setattr("tools.a2a_delegate_tool._A2ADelegateSession", _FakeSession)

    result = json.loads(
        a2a_delegate(
            goal="test remote",
            agent="a2a",
            a2a_name="remote",
            parent_agent=parent,
        )
    )

    assert captured["session_id"] == "delegate_worker_alpha_a2a_20260606_120000"
    assert result["session_id"] == "delegate_worker_alpha_a2a_20260606_120000"


def test_a2a_mode_cancelled_task_is_reported_as_interrupted_and_clears_parent_handle(monkeypatch):
    parent = _make_parent()
    A2A_REGISTRY["remote"] = {
        "name": "remote",
        "url": "http://agent.local",
        "available": True,
        "capabilities": ["streaming"],
        "agent_card": {"supported_interfaces": [{"url": "http://agent.local/a2a"}]},
        "agent_card_name": "Remote Agent",
        "error": None,
    }
    captured = {"registered": False}

    class _FakeSession:
        def __init__(self, base_url, *, output=None, timeout=60.0, poll_interval=0.05, session_id=None):
            del base_url, output, timeout, poll_interval
            self.context_id = session_id
            self.task_id = "task-1"

        async def send_turn(self, text: str, *, is_delegate_output: bool = True):
            del text, is_delegate_output
            handle = getattr(parent, "_active_a2a_delegate_session", None)
            captured["registered"] = callable(getattr(handle, "cancel", None))
            return {
                "final_response": "",
                "state": TaskState.TASK_STATE_CANCELED,
                "state_name": "canceled",
            }

        async def close(self):
            return None

        def latest_assistant_text(self):
            return ""

        def should_suppress_stop_exception(self, exc):
            del exc
            return False

    monkeypatch.setattr("tools.a2a_delegate_tool._A2ADelegateSession", _FakeSession)

    result = json.loads(
        a2a_delegate(
            goal="test remote",
            agent="a2a",
            a2a_name="remote",
            parent_agent=parent,
        )
    )

    assert captured["registered"] is True
    assert result["success"] is True
    assert result["is_loop"] is False
    assert result["loop_exit_reason"] == "interrupted"
    assert result["completed"] is False
    assert "error" not in result
    assert result["final_response"] == "已按用户请求停止当前 A2A 委托，无需重试。"
    assert getattr(parent, "_active_a2a_delegate_session", None) is None


def test_a2a_mode_stop_with_last_output_returns_interrupted_payload(monkeypatch):
    parent = _make_parent()
    A2A_REGISTRY["remote"] = {
        "name": "remote",
        "url": "http://agent.local",
        "available": True,
        "capabilities": ["streaming"],
        "agent_card": {"supported_interfaces": [{"url": "http://agent.local/a2a"}]},
        "agent_card_name": "Remote Agent",
        "error": None,
    }
    captured = {"registered": False}

    class _FakeSession:
        def __init__(self, base_url, *, output=None, timeout=60.0, poll_interval=0.05, session_id=None):
            del base_url, output, timeout, poll_interval
            self.context_id = session_id
            self.task_id = "task-1"

        async def send_turn(self, text: str, *, is_delegate_output: bool = True):
            del text, is_delegate_output
            handle = getattr(parent, "_active_a2a_delegate_session", None)
            captured["registered"] = callable(getattr(handle, "cancel", None))
            return {
                "final_response": "partial answer",
                "state": TaskState.TASK_STATE_CANCELED,
                "state_name": "canceled",
            }

        async def close(self):
            return None

        def latest_assistant_text(self):
            return "partial answer"

        def should_suppress_stop_exception(self, exc):
            del exc
            return False

    monkeypatch.setattr("tools.a2a_delegate_tool._A2ADelegateSession", _FakeSession)

    result = json.loads(
        a2a_delegate(
            goal="test remote",
            agent="a2a",
            a2a_name="remote",
            parent_agent=parent,
        )
    )

    assert captured["registered"] is True
    assert result["success"] is True
    assert result["is_loop"] is False
    assert result["loop_exit_reason"] == "interrupted"
    assert "error" not in result
    assert result["final_response"] == (
        "已按用户请求停止当前 A2A 委托，无需重试。\n\n停止前最后输出：partial answer"
    )
    assert getattr(parent, "_active_a2a_delegate_session", None) is None


def test_a2a_mode_stop_close_teardown_exception_still_returns_interrupted_payload(monkeypatch):
    parent = _make_parent()
    A2A_REGISTRY["remote"] = {
        "name": "remote",
        "url": "http://agent.local",
        "available": True,
        "capabilities": ["streaming"],
        "agent_card": {"supported_interfaces": [{"url": "http://agent.local/a2a"}]},
        "agent_card_name": "Remote Agent",
        "error": None,
    }

    class _FakeSession:
        def __init__(self, base_url, *, output=None, timeout=60.0, poll_interval=0.05, session_id=None):
            del base_url, output, timeout, poll_interval
            self.context_id = session_id
            self.task_id = "task-1"
            self._stop_requested = False

        async def send_turn(self, text: str, *, is_delegate_output: bool = True):
            del text, is_delegate_output
            self._stop_requested = True
            return {
                "final_response": "",
                "state": TaskState.TASK_STATE_CANCELED,
                "state_name": "canceled",
            }

        async def close(self):
            raise RuntimeError("Event loop is closed")

        def latest_assistant_text(self):
            return ""

        def should_suppress_stop_exception(self, exc):
            return self._stop_requested and "event loop is closed" in str(exc).lower()

    monkeypatch.setattr("tools.a2a_delegate_tool._A2ADelegateSession", _FakeSession)

    result_text = a2a_delegate(
        goal="test remote",
        agent="a2a",
        a2a_name="remote",
        parent_agent=parent,
    )

    assert not result_text.startswith("Error executing tool")
    result = json.loads(result_text)
    assert result["success"] is True
    assert result["is_loop"] is False
    assert result["loop_exit_reason"] == "interrupted"
    assert result["final_response"] == "已按用户请求停止当前 A2A 委托，无需重试。"
    assert getattr(parent, "_active_a2a_delegate_session", None) is None
