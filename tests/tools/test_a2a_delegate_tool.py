import json
import re
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from run_agent import AIAgent
from toolsets import TOOLSETS, _HERMES_CORE_TOOLS
from tools.registry import registry


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
        self.entered = False
        self.exited = False
        self.timeouts = []

    def enter_foreground(self):
        self.entered = True
        return True

    def exit_foreground(self):
        self.exited = True

    def read_line(self, timeout=None):
        self.timeouts.append(timeout)
        return next(self._values)


def test_a2a_schemas_are_registered_and_toolset_is_opt_in():
    import tools.a2a_delegate_tool as a2a_delegate_tool

    assert registry.get_schema("a2a_list") is not None
    schema = registry.get_schema("a2a_delegate")
    assert schema is not None
    props = schema["parameters"]["properties"]
    assert {"goal", "context", "agent_name", "session_id", "is_delegate_output", "is_loop"} <= set(props)
    assert "type" not in props
    assert "toolsets" not in props
    assert "max_iterations" not in props
    assert "a2a" in TOOLSETS
    assert TOOLSETS["a2a"]["tools"] == ["a2a_list", "a2a_delegate"]
    assert "a2a_list" not in _HERMES_CORE_TOOLS
    assert "a2a_delegate" not in _HERMES_CORE_TOOLS
    assert a2a_delegate_tool.A2A_DELEGATE_SCHEMA["name"] == "a2a_delegate"


def test_remote_delegate_session_default_poll_interval_is_one_second():
    from tools.a2a_delegate_tool import _A2ADelegateSession

    session = _A2ADelegateSession("http://agent.local/a2a")

    assert session.poll_interval == 1.0


def test_default_a2a_session_id_adds_two_digit_random_suffix(monkeypatch):
    import tools.a2a_delegate_tool as a2a_delegate_tool

    monkeypatch.setattr(a2a_delegate_tool, "get_active_profile_name", lambda: "main")
    monkeypatch.setattr(a2a_delegate_tool.time, "strftime", lambda fmt: "20260710_123456")

    session_id = a2a_delegate_tool._resolve_delegate_session_id(None)

    match = re.match(r"^delegate_main_a2a_20260710_123456_([0-9]{2})$", session_id)
    assert match is not None
    assert 1 <= int(match.group(1)) <= 99


def test_dispatch_helper_forwards_agent_runtime_bindings(monkeypatch):
    captured = {}

    def fake_delegate(**kwargs):
        captured.update(kwargs)
        return '{"ok": true}'

    monkeypatch.setattr("tools.a2a_delegate_tool.a2a_delegate", fake_delegate)
    agent = object.__new__(AIAgent)
    agent._delegate_ext_output_adapter = "output"
    agent._delegate_ext_input_factory = lambda: "input"

    result = agent._dispatch_a2a_delegate(
        {
            "goal": "inspect",
            "context": "ctx",
            "agent_name": "remote",
            "type": "local",
            "toolsets": ["terminal"],
            "max_iterations": 3,
            "session_id": "child-session",
            "is_delegate_output": False,
            "is_loop": True,
        }
    )

    assert json.loads(result) == {"ok": True}
    assert captured["parent_agent"] is agent
    assert captured["output"] == "output"
    assert captured["input"] == "input"
    assert "type" not in captured
    assert "toolsets" not in captured
    assert "max_iterations" not in captured
    assert captured["context"] == "ctx"
    assert captured["agent_name"] == "remote"
    assert captured["session_id"] == "child-session"
    assert captured["is_delegate_output"] is False
    assert captured["is_loop"] is True


def test_a2a_remote_without_sdk_returns_clear_error(monkeypatch):
    from tools.a2a_delegate_tool import A2A_REGISTRY, a2a_delegate

    A2A_REGISTRY.clear()
    A2A_REGISTRY["remote"] = {
        "name": "remote",
        "url": "http://agent.local/a2a",
        "available": True,
        "agent_card": {"supported_interfaces": [{"url": "http://agent.local/a2a"}]},
        "error": None,
    }
    monkeypatch.setattr("tools.a2a_delegate_tool._a2a_sdk_available", lambda: False)

    result = json.loads(
        a2a_delegate(goal="remote", type="a2a", agent_name="remote", parent_agent=_make_parent())
    )

    assert result["success"] is False
    assert "a2a sdk" in result["error"].lower()


def test_a2a_loop_requires_input_adapter(monkeypatch):
    from tools.a2a_delegate_tool import A2A_REGISTRY, a2a_delegate

    A2A_REGISTRY.clear()
    A2A_REGISTRY["remote"] = {
        "name": "remote",
        "url": "http://agent.local/a2a",
        "available": True,
        "agent_card": {"supported_interfaces": [{"url": "http://agent.local/a2a"}]},
        "error": None,
    }
    monkeypatch.setattr("tools.a2a_delegate_tool._a2a_sdk_available", lambda: True)

    result = json.loads(a2a_delegate(goal="remote", agent_name="remote", is_loop=True, parent_agent=_make_parent()))

    assert result["success"] is False
    assert "input adapter" in result["error"].lower()


def test_remote_loop_reuses_session_and_routes_foreground_input(monkeypatch):
    import tools.a2a_delegate_tool as a2a_delegate_tool
    from tools.a2a_delegate_tool import A2A_REGISTRY, a2a_delegate

    A2A_REGISTRY.clear()
    A2A_REGISTRY["remote"] = {
        "name": "remote",
        "url": "http://agent.local/a2a",
        "available": True,
        "agent_card": {"supported_interfaces": [{"url": "http://agent.local/a2a"}]},
        "error": None,
    }
    monkeypatch.setattr("tools.a2a_delegate_tool._a2a_sdk_available", lambda: True)

    sessions = []

    class FakeSession:
        def __init__(self, base_url, *, output=None, session_id=None, headers=None, **kwargs):
            del kwargs
            self.base_url = base_url
            self.output = output
            self.context_id = session_id
            self.task_id = None
            self.headers = headers or {}
            self.turns = []
            sessions.append(self)

        async def send_turn(self, text, *, is_delegate_output=True):
            self.turns.append((text, is_delegate_output, self.context_id))
            self.context_id = "ctx-remote"
            self.task_id = f"task-{len(self.turns)}"
            if self.output and is_delegate_output:
                self.output.emit("delegate", "ai", f"response-{len(self.turns)}", session_id=self.context_id)
            return {
                "final_response": f"response-{len(self.turns)}",
                "state": "completed",
                "state_name": "completed",
                "context_id": self.context_id,
                "task_id": self.task_id,
            }

        async def close(self):
            self.closed = True

        def latest_assistant_text(self):
            return "latest"

        def should_suppress_stop_exception(self, exc):
            del exc
            return False

    monkeypatch.setattr(a2a_delegate_tool, "_A2ADelegateSession", FakeSession)
    parent = _make_parent()
    parent.platform = "slack"
    parent._user_id = "U123"
    parent._user_name = "Ada"
    parent._touch_activity = MagicMock()
    sink = _OutputSink()
    input_adapter = _Input(["follow up", "/main"])

    result = json.loads(
        a2a_delegate(
            goal="start",
            context="extra context",
            agent_name="remote",
            session_id="seed-session",
            is_loop=True,
            input=input_adapter,
            output=sink,
            parent_agent=parent,
        )
    )

    assert result["success"] is True
    assert result["session_id"] == "ctx-remote"
    assert result["loop_exit_reason"] == "main_command"
    assert input_adapter.entered is True
    assert input_adapter.exited is True
    assert parent._touch_activity.call_count == 1
    assert sessions[0].turns[0][2] == "seed-session"
    assert sessions[0].turns[1][2] == "ctx-remote"
    assert "<source>" in sessions[0].turns[0][0]
    assert "extra context" in sessions[0].turns[0][0]
    assert sessions[0].turns[1][0].endswith("follow up")
    assert sink.events == [
        ("delegate", "status", "entered foreground loop", "seed-session"),
        ("delegate", "ai", "response-1", "ctx-remote"),
        ("delegate", "ai", "response-2", "ctx-remote"),
        ("delegate", "status", "return to main", "ctx-remote"),
    ]


def test_remote_loop_timeout_returns_clear_payload(monkeypatch):
    import tools.a2a_delegate_tool as a2a_delegate_tool
    from tools.a2a_delegate_tool import A2A_REGISTRY, _DELEGATE_INPUT_TIMEOUT, a2a_delegate

    A2A_REGISTRY.clear()
    A2A_REGISTRY["remote"] = {
        "name": "remote",
        "url": "http://agent.local/a2a",
        "available": True,
        "agent_card": {"supported_interfaces": [{"url": "http://agent.local/a2a"}]},
        "error": None,
    }
    monkeypatch.setattr("tools.a2a_delegate_tool._a2a_sdk_available", lambda: True)

    class FakeInput(_Input):
        def read_line(self, timeout=None):
            self.timeouts.append(timeout)
            return _DELEGATE_INPUT_TIMEOUT

    class FakeSession:
        def __init__(self, *args, session_id=None, **kwargs):
            del args, kwargs
            self.context_id = session_id
            self.task_id = "task-1"

        async def send_turn(self, text, *, is_delegate_output=True):
            del text, is_delegate_output
            self.context_id = "ctx-timeout"
            return {
                "final_response": "waiting",
                "state": "completed",
                "state_name": "completed",
                "context_id": self.context_id,
                "task_id": self.task_id,
            }

        async def close(self):
            return None

        def latest_assistant_text(self):
            return "waiting"

        def should_suppress_stop_exception(self, exc):
            del exc
            return False

    monkeypatch.setattr(a2a_delegate_tool, "_A2ADelegateSession", FakeSession)
    result = json.loads(
        a2a_delegate(
            goal="start",
            agent_name="remote",
            is_loop=True,
            input=FakeInput([]),
            parent_agent=_make_parent(),
        )
    )

    assert result["success"] is True
    assert result["loop_exit_reason"] == "input_timeout"
    assert "timeout" in result["final_response"].lower()
