import json
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from a2a.types import Role, TaskState
from run_agent import AIAgent
from toolsets import TOOLSETS
import tools.a2a_delegate_tool as a2a_delegate_tool_module
from tools.registry import registry
from tools.a2a_delegate_tool import (
    A2A_REGISTRY,
    A2A_DELEGATE_SCHEMA,
    _A2ADelegateSession,
    _strip_recursive_delegate_tool,
    a2a_list,
    a2a_delegate,
)


class _FakeSessionDB:
    def __init__(self):
        self._messages_by_session: dict[str, list[dict[str, object]]] = {}

    def get_messages_as_conversation(self, session_id: str, include_ancestors: bool = False):
        del include_ancestors
        return list(self._messages_by_session.get(session_id, []))

    def save_messages(self, session_id: str, messages: list[dict[str, object]]) -> None:
        self._messages_by_session[session_id] = list(messages)


def _make_mock_parent():
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


def _make_a2a_task(
    *,
    task_id: str,
    context_id: str,
    state,
    text: str = "",
    history=None,
    role=None,
):
    parts = [SimpleNamespace(text=text)] if text else []
    message = SimpleNamespace(parts=parts, role=role) if parts else None
    return SimpleNamespace(
        id=task_id,
        context_id=context_id,
        status=SimpleNamespace(
            state=state,
            message=message,
        ),
        history=list(history or []),
    )


def _make_a2a_history_message(
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


class TestDelegateExtSchema:
    def test_a2a_list_schema_is_registered(self):
        schema = registry.get_schema("a2a_list")
        assert schema is not None
        assert schema["name"] == "a2a_list"

    def test_a2a_delegate_schema_is_registered(self):
        schema = registry.get_schema("a2a_delegate")
        assert schema is not None
        assert schema["name"] == "a2a_delegate"
        assert registry.get_schema("delegate_ext") is None

    def test_schema_fields_present(self):
        assert A2A_DELEGATE_SCHEMA["name"] == "a2a_delegate"
        props = A2A_DELEGATE_SCHEMA["parameters"]["properties"]
        assert "goal" in props
        assert "context" in props
        assert "agent" in props
        assert "toolsets" in props
        assert "max_iterations" in props
        assert "session_id" in props
        assert props["agent"]["enum"] == ["local", "a2a"]

    def test_schema_fields_include_loop_and_io(self):
        props = A2A_DELEGATE_SCHEMA["parameters"]["properties"]
        assert "is_delegate_output" in props
        assert "is_loop" in props

    def test_schema_includes_a2a_name(self):
        props = A2A_DELEGATE_SCHEMA["parameters"]["properties"]
        assert "a2a_name" in props


class TestDelegateExt:
    def teardown_method(self):
        A2A_REGISTRY.clear()

    def test_requires_parent_agent(self):
        result = json.loads(a2a_delegate(goal="test"))
        assert "error" in result
        assert "parent agent" in result["error"].lower()

    def test_requires_goal(self):
        parent = _make_mock_parent()
        result = json.loads(a2a_delegate(goal="  ", parent_agent=parent))
        assert "error" in result
        assert "goal" in result["error"].lower()

    def test_a2a_mode_requires_a2a_name(self):
        parent = _make_mock_parent()
        result = json.loads(
            a2a_delegate(goal="test remote", agent="a2a", parent_agent=parent)
        )
        assert result["error"]
        assert result["agent"] == "a2a"
        assert "a2a_name" in result["error"].lower()

    def test_a2a_list_reads_profile_local_registry(self, tmp_path, monkeypatch):
        hermes_home = tmp_path / "profile"
        hermes_home.mkdir()
        (hermes_home / "a2a.json").write_text(
            '{"a2a":{"test":"http://127.0.0.1/a2a"}}',
            encoding="utf-8",
        )
        monkeypatch.setattr(a2a_delegate_tool_module, "get_hermes_home", lambda: hermes_home)
        monkeypatch.setattr(
            a2a_delegate_tool_module,
            "_fetch_agent_card",
            lambda url: (
                {
                    "name": "Test Agent",
                    "description": "Test remote worker.",
                    "version": "1.0.0",
                    "capabilities": {"streaming": True, "push_notifications": False},
                    "default_input_modes": ["text/plain"],
                    "default_output_modes": ["text/plain"],
                    "supported_interfaces": [
                        {
                            "url": "http://127.0.0.1/a2a",
                            "protocol_binding": "JSONRPC",
                            "protocol_version": "0.3.0",
                        }
                    ],
                    "skills": [{"name": "research"}],
                },
                None,
            ),
        )

        result = json.loads(a2a_list())

        assert result["success"] is True
        assert result["count"] == 1
        assert result["agents"][0]["name"] == "test"
        assert result["agents"][0]["capabilities"] == ["streaming", "skill:research"]
        assert result["agents"][0]["agent_card"]["version"] == "1.0.0"
        assert result["agents"][0]["agent_card"]["capabilities"] == {
            "streaming": True,
            "push_notifications": False,
        }
        assert result["agents"][0]["agent_card"]["skills"] == ["research"]
        assert result["agents"][0]["agent_card_name"] == "Test Agent"

    def test_a2a_list_keeps_broken_agent_entries(self, tmp_path, monkeypatch):
        hermes_home = tmp_path / "profile"
        hermes_home.mkdir()
        (hermes_home / "a2a.json").write_text(
            '{"a2a":{"broken":"http://127.0.0.1/a2a"}}',
            encoding="utf-8",
        )
        monkeypatch.setattr(a2a_delegate_tool_module, "get_hermes_home", lambda: hermes_home)
        monkeypatch.setattr(
            a2a_delegate_tool_module,
            "_fetch_agent_card",
            lambda url: (None, "connection refused"),
        )

        result = json.loads(a2a_list())

        assert result["success"] is True
        assert result["agents"][0]["available"] is False
        assert result["agents"][0]["capabilities"] == []
        assert "connection refused" in result["agents"][0]["error"]

    def test_a2a_list_skips_offline_agents_and_merges_extcapabilities(self, tmp_path, monkeypatch):
        hermes_home = tmp_path / "profile"
        hermes_home.mkdir()
        (hermes_home / "a2a.json").write_text(
            json.dumps(
                {
                    "a2a": {
                        "test": {
                            "url": "http://127.0.0.1:9086/a2a",
                            "description": "A2A test endpoint",
                            "headers": {"Authorization": "Bearer secret-token"},
                            "status": "active",
                            "extcapabilities": ["xxx", "bbb"],
                        },
                        "offline-agent": {
                            "url": "http://127.0.0.1:9087/a2a",
                            "status": "offline",
                            "extcapabilities": ["should-not-appear"],
                        },
                    }
                }
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(a2a_delegate_tool_module, "get_hermes_home", lambda: hermes_home)
        fetched = []

        def _fake_fetch_agent_card(url, headers=None):
            fetched.append((url, headers))
            return (
                {
                    "name": "Test Agent",
                    "description": "Test remote worker.",
                    "version": "1.0.0",
                    "capabilities": {"streaming": True},
                    "skills": [{"name": "research"}],
                },
                None,
            )

        monkeypatch.setattr(a2a_delegate_tool_module, "_fetch_agent_card", _fake_fetch_agent_card)

        result = json.loads(a2a_list())

        assert result["success"] is True
        assert result["count"] == 1
        assert [agent["name"] for agent in result["agents"]] == ["test"]
        assert result["agents"][0]["capabilities"] == [
            "streaming",
            "skill:research",
            "xxx",
            "bbb",
        ]
        assert "headers" not in result["agents"][0]
        assert fetched == [
            (
                "http://127.0.0.1:9086/a2a",
                {"Authorization": "Bearer secret-token"},
            )
        ]

    def test_a2a_list_fails_on_malformed_registry(self, tmp_path, monkeypatch):
        hermes_home = tmp_path / "profile"
        hermes_home.mkdir()
        (hermes_home / "a2a.json").write_text('{"a2a":[1,2,3]}', encoding="utf-8")
        monkeypatch.setattr(a2a_delegate_tool_module, "get_hermes_home", lambda: hermes_home)

        result = json.loads(a2a_list())

        assert result["success"] is False
        assert "a2a" in result["error"].lower()

    def test_a2a_mode_runs_single_turn_and_ignores_local_only_params(self, monkeypatch):
        parent = _make_mock_parent()
        A2A_REGISTRY["remote"] = {
            "name": "remote",
            "url": "http://agent.local",
            "available": True,
            "capabilities": ["streaming"],
            "agent_card": {
                "supported_interfaces": [
                    {"url": "http://agent.local/a2a"},
                ]
            },
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
                del timeout, poll_interval
                captured["base_url"] = base_url
                captured["output"] = output
                captured["session_id"] = session_id
                self.context_id = session_id

            async def send_turn(self, text: str, *, is_delegate_output: bool = True):
                captured.setdefault("turns", []).append((text, is_delegate_output))
                self.context_id = "ctx-remote"
                return {
                    "final_response": "remote:first",
                    "state": TaskState.TASK_STATE_COMPLETED,
                    "state_name": "completed",
                }

            async def close(self):
                captured["closed"] = True

        monkeypatch.setattr(a2a_delegate_tool_module, "_A2ADelegateSession", _FakeSession)

        result = json.loads(
            a2a_delegate(
                goal="test remote",
                agent="a2a",
                a2a_name="remote",
                toolsets=["terminal"],
                max_iterations=7,
                parent_agent=parent,
            )
        )

        assert captured["base_url"] == "http://agent.local/a2a"
        assert captured["turns"] == [("test remote", True)]
        assert captured["closed"] is True
        assert result["success"] is True
        assert result["agent"] == "a2a"
        assert result["a2a_name"] == "remote"
        assert result["session_id"] == "ctx-remote"
        assert result["toolsets"] is None
        assert result["max_iterations"] is None
        assert result["remote_url"] == "http://agent.local/a2a"
        assert result["agent_card_name"] == "Remote Agent"
        assert result["final_response"] == "remote:first"

    def test_a2a_mode_passes_entry_headers_into_remote_session(self, monkeypatch):
        parent = _make_mock_parent()
        A2A_REGISTRY["remote"] = {
            "name": "remote",
            "url": "http://agent.local",
            "available": True,
            "capabilities": ["streaming"],
            "agent_card": {"supported_interfaces": [{"url": "http://agent.local/a2a"}]},
            "agent_card_name": "Remote Agent",
            "headers": {"Authorization": "Bearer token"},
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
                headers=None,
            ):
                del output, timeout, poll_interval
                captured["base_url"] = base_url
                captured["session_id"] = session_id
                captured["headers"] = headers
                self.context_id = session_id

            async def send_turn(self, text: str, *, is_delegate_output: bool = True):
                del text, is_delegate_output
                self.context_id = "ctx-remote"
                return {
                    "final_response": "remote:first",
                    "state": TaskState.TASK_STATE_COMPLETED,
                    "state_name": "completed",
                }

            async def close(self):
                captured["closed"] = True

        monkeypatch.setattr(a2a_delegate_tool_module, "_A2ADelegateSession", _FakeSession)

        result = json.loads(
            a2a_delegate(
                goal="test remote",
                agent="a2a",
                a2a_name="remote",
                parent_agent=parent,
            )
        )

        assert result["success"] is True
        assert captured["base_url"] == "http://agent.local/a2a"
        assert captured["headers"] == {"Authorization": "Bearer token"}
        assert captured["closed"] is True

    def test_a2a_mode_honors_explicit_session_id(self, monkeypatch):
        parent = _make_mock_parent()
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

        monkeypatch.setattr(a2a_delegate_tool_module, "_A2ADelegateSession", _FakeSession)

        result = json.loads(
            a2a_delegate(
                goal="test remote",
                agent="a2a",
                a2a_name="remote",
                session_id="persisted-remote-session",
                parent_agent=parent,
            )
        )

        assert captured["session_id"] == "persisted-remote-session"
        assert result["session_id"] == "persisted-remote-session"

    def test_a2a_loop_mode_reuses_same_session_until_main(self, monkeypatch):
        parent = _make_mock_parent()
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
        sink = []

        class _Input:
            def __init__(self, values):
                self._values = iter(values)

            def enter_foreground(self):
                captured["entered"] = captured.get("entered", 0) + 1
                return True

            def exit_foreground(self):
                captured["exited"] = captured.get("exited", 0) + 1

            def read_line(self):
                return next(self._values)

        class _Output:
            def emit(self, source, event_type, content, session_id=None):
                sink.append((source, event_type, content, session_id))

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
                del base_url, timeout, poll_interval
                self.output = output
                captured["session_id"] = session_id
                self.context_id = session_id

            async def send_turn(self, text: str, *, is_delegate_output: bool = True):
                captured.setdefault("turns", []).append((text, is_delegate_output))
                self.context_id = "ctx-remote"
                index = len(captured["turns"])
                return {
                    "final_response": f"remote:{index}",
                    "state": TaskState.TASK_STATE_COMPLETED,
                    "state_name": "completed",
                }

            async def close(self):
                captured["closed"] = True

        monkeypatch.setattr(a2a_delegate_tool_module, "_A2ADelegateSession", _FakeSession)

        result = json.loads(
            a2a_delegate(
                goal="start remote",
                agent="a2a",
                a2a_name="remote",
                is_loop=True,
                input=_Input(["follow up", "/main"]),
                output=_Output(),
                parent_agent=parent,
            )
        )

        assert captured["turns"] == [("start remote", True), ("follow up", True)]
        assert captured["entered"] == 1
        assert captured["exited"] == 1
        assert captured["closed"] is True
        assert result["loop_exit_reason"] == "main_command"
        assert result["final_response"] == "remote:2"
        assert sink == [
            ("delegate", "status", "entered foreground loop", captured["session_id"]),
            ("delegate", "user", "follow up", "ctx-remote"),
            ("delegate", "status", "return to main", "ctx-remote"),
        ]

    @patch("run_agent.AIAgent")
    def test_local_mode_uses_defaults(self, mock_agent_cls):
        parent = _make_mock_parent()
        child = MagicMock()
        child.run_conversation.return_value = {
            "final_response": "done",
            "completed": True,
            "api_calls": 2,
            "messages": [{"role": "assistant", "content": "done"}],
        }
        mock_agent_cls.return_value = child

        result = json.loads(a2a_delegate(goal="finish task", parent_agent=parent))

        assert result["agent"] == "local"
        assert result["toolsets"] == ["hermes-cli"]
        assert result["final_response"] == "done"
        _, kwargs = mock_agent_cls.call_args
        assert kwargs["enabled_toolsets"] == ["hermes-cli"]
        assert kwargs["provider"] == "openrouter"
        assert kwargs["base_url"] == "https://openrouter.ai/api/v1"
        assert kwargs["api_mode"] == "chat_completions"
        assert kwargs["parent_session_id"] == "parent-session"
        child.run_conversation.assert_called_once()
        assert parent._active_children == []

    @patch("run_agent.AIAgent")
    def test_local_mode_honors_toolsets_and_max_iterations(self, mock_agent_cls):
        parent = _make_mock_parent()
        child = MagicMock()
        child.run_conversation.return_value = {
            "final_response": "done",
            "completed": True,
            "api_calls": 1,
            "messages": [{"role": "assistant", "content": "done"}],
        }
        mock_agent_cls.return_value = child

        result = json.loads(
            a2a_delegate(
                goal="inspect code",
                context="focus on tests",
                toolsets=["terminal", "file"],
                max_iterations=17,
                parent_agent=parent,
            )
        )

        assert result["max_iterations"] == 17
        assert result["toolsets"] == ["terminal", "file"]
        _, kwargs = mock_agent_cls.call_args
        assert kwargs["enabled_toolsets"] == ["terminal", "file"]
        assert kwargs["max_iterations"] == 17

    @patch("run_agent.AIAgent")
    def test_local_mode_honors_explicit_session_id(self, mock_agent_cls):
        parent = _make_mock_parent()
        child = MagicMock()
        child.session_id = "persisted-local-session"
        child.run_conversation.return_value = {
            "final_response": "done",
            "completed": True,
            "api_calls": 1,
        }
        mock_agent_cls.return_value = child

        result = json.loads(
            a2a_delegate(
                goal="inspect code",
                session_id="persisted-local-session",
                parent_agent=parent,
            )
        )

        _, kwargs = mock_agent_cls.call_args
        assert kwargs["session_id"] == "persisted-local-session"
        assert result["session_id"] == "persisted-local-session"

    @patch("run_agent.AIAgent")
    def test_local_mode_generates_default_session_id_when_missing(self, mock_agent_cls, monkeypatch):
        parent = _make_mock_parent()
        child = MagicMock()
        child.run_conversation.return_value = {
            "final_response": "done",
            "completed": True,
            "api_calls": 1,
        }
        mock_agent_cls.return_value = child
        monkeypatch.setattr(a2a_delegate_tool_module, "get_active_profile_name", lambda: "worker_alpha")
        monkeypatch.setattr(a2a_delegate_tool_module.time, "strftime", lambda fmt: "20260605_123456")

        result = json.loads(a2a_delegate(goal="inspect code", parent_agent=parent))

        _, kwargs = mock_agent_cls.call_args
        assert kwargs["session_id"] == "delegate_worker_alpha_local_20260605_123456"
        assert result["session_id"] == "delegate_worker_alpha_local_20260605_123456"

    def test_a2a_mode_generates_default_session_id_when_missing(self, monkeypatch):
        parent = _make_mock_parent()
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

        monkeypatch.setattr(a2a_delegate_tool_module, "get_active_profile_name", lambda: "worker_alpha")
        monkeypatch.setattr(a2a_delegate_tool_module.time, "strftime", lambda fmt: "20260605_123456")
        monkeypatch.setattr(a2a_delegate_tool_module, "_A2ADelegateSession", _FakeSession)

        result = json.loads(
            a2a_delegate(
                goal="test remote",
                agent="a2a",
                a2a_name="remote",
                parent_agent=parent,
            )
        )

        assert captured["session_id"] == "delegate_worker_alpha_a2a_20260605_123456"
        assert result["session_id"] == "delegate_worker_alpha_a2a_20260605_123456"

    def test_invalid_toolset_returns_error(self):
        parent = _make_mock_parent()
        result = json.loads(
            a2a_delegate(
                goal="bad tools",
                toolsets=["nope-toolset"],
                parent_agent=parent,
            )
        )
        assert "error" in result
        assert "unknown toolset" in result["error"].lower()

    def test_loop_mode_requires_input_adapter(self):
        parent = _make_mock_parent()
        result = json.loads(
            a2a_delegate(goal="inspect", is_loop=True, input=None, parent_agent=parent)
        )
        assert "error" in result
        assert "input" in result["error"].lower()

    @patch("run_agent.AIAgent")
    def test_a2a_delegate_emits_output_when_enabled(self, mock_agent_cls):
        parent = _make_mock_parent()
        child = MagicMock()
        child.session_id = "child-session"
        child.run_conversation.return_value = {
            "final_response": "done",
            "completed": True,
            "api_calls": 1,
        }
        mock_agent_cls.return_value = child
        sink = []

        class _Output:
            def emit(self, source, event_type, content, session_id=None):
                sink.append((source, event_type, content, session_id))

        result = json.loads(
            a2a_delegate(
                goal="finish",
                is_loop=False,
                is_delegate_output=True,
                output=_Output(),
                parent_agent=parent,
            )
        )

        assert result["final_response"] == "done"
        assert sink == [("delegate", "ai", "done", "child-session")]

    @patch("run_agent.AIAgent")
    def test_a2a_delegate_suppresses_output_when_disabled(self, mock_agent_cls):
        parent = _make_mock_parent()
        child = MagicMock()
        child.session_id = "child-session"
        child.run_conversation.return_value = {
            "final_response": "done",
            "completed": True,
            "api_calls": 1,
        }
        mock_agent_cls.return_value = child
        sink = []

        class _Output:
            def emit(self, source, event_type, content, session_id=None):
                sink.append((source, event_type, content, session_id))

        a2a_delegate(
            goal="finish",
            is_loop=False,
            is_delegate_output=False,
            output=_Output(),
            parent_agent=parent,
        )

        assert sink == []

    @patch("run_agent.AIAgent")
    def test_omitted_loop_flag_preserves_one_shot_compatibility(self, mock_agent_cls):
        parent = _make_mock_parent()
        child = MagicMock()
        child.run_conversation.return_value = {
            "final_response": "done",
            "completed": True,
            "api_calls": 1,
        }
        mock_agent_cls.return_value = child

        result = json.loads(a2a_delegate(goal="finish task", parent_agent=parent))

        assert result["final_response"] == "done"
        assert result["loop_exit_reason"] == "completed"

    def test_strip_recursive_delegate_tool_removes_a2a_delegate(self):
        child = MagicMock()
        child.valid_tool_names = {"read_file", "a2a_delegate"}
        child.tool_definitions = [
            {"type": "function", "function": {"name": "a2a_delegate"}},
            {"type": "function", "function": {"name": "read_file"}},
        ]

        _strip_recursive_delegate_tool(child)

        assert "a2a_delegate" not in child.valid_tool_names
        names = {tool["function"]["name"] for tool in child.tool_definitions}
        assert "a2a_delegate" not in names

    @patch("run_agent.AIAgent")
    def test_loop_mode_consumes_multiple_turns_until_main(self, mock_agent_cls):
        parent = _make_mock_parent()

        class _Input:
            def __init__(self, values):
                self._values = iter(values)

            def read_line(self):
                return next(self._values)

        child = MagicMock()
        child.run_conversation.side_effect = [
            {"final_response": "first", "completed": True, "api_calls": 1},
            {"final_response": "second", "completed": True, "api_calls": 2},
        ]
        mock_agent_cls.return_value = child

        result = json.loads(
            a2a_delegate(
                goal="start",
                is_loop=True,
                input=_Input(["follow up", "/main"]),
                parent_agent=parent,
            )
        )

        assert result["final_response"] == "second"
        assert result["loop_exit_reason"] == "main_command"
        assert child.run_conversation.call_count == 2

    @patch("run_agent.AIAgent")
    def test_exit_command_matches_main_in_loop_mode(self, mock_agent_cls):
        parent = _make_mock_parent()

        class _Input:
            def __init__(self, values):
                self._values = iter(values)

            def read_line(self):
                return next(self._values)

        child = MagicMock()
        child.run_conversation.return_value = {
            "final_response": "first",
            "completed": True,
            "api_calls": 1,
        }
        mock_agent_cls.return_value = child

        result = json.loads(
            a2a_delegate(
                goal="start",
                is_loop=True,
                input=_Input(["/exit"]),
                parent_agent=parent,
            )
        )

        assert result["loop_exit_reason"] == "main_command"

    @patch("run_agent.AIAgent")
    def test_loop_mode_restores_history_from_session_db_each_turn(self, mock_agent_cls):
        parent = _make_mock_parent()
        session_db = _FakeSessionDB()
        parent._session_db = session_db

        class _Input:
            def __init__(self, values):
                self._values = iter(values)

            def read_line(self):
                return next(self._values)

        class _HistoryAwareChild:
            def __init__(self):
                self.session_id = "child-session"
                self._session_db = session_db
                self.observed_histories: list[list[dict[str, object]]] = []

            def run_conversation(
                self,
                user_message: str,
                system_message: str | None = None,
                conversation_history: list[dict[str, object]] | None = None,
                task_id: str | None = None,
            ) -> dict[str, object]:
                del system_message, task_id
                history = list(conversation_history or [])
                self.observed_histories.append(history)
                response = f"child:{user_message}"
                messages = list(history)
                messages.append({"role": "user", "content": user_message})
                messages.append({"role": "assistant", "content": response})
                self._session_db.save_messages(self.session_id, messages)
                return {
                    "final_response": response,
                    "completed": True,
                    "api_calls": 1,
                }

            def close(self):
                pass

        child = _HistoryAwareChild()
        mock_agent_cls.return_value = child

        result = json.loads(
            a2a_delegate(
                goal="start",
                is_loop=True,
                input=_Input(["follow up", "/main"]),
                parent_agent=parent,
            )
        )

        assert result["final_response"] == "child:follow up"
        assert child.observed_histories == [
            [],
            [
                {"role": "user", "content": "start"},
                {"role": "assistant", "content": "child:start"},
            ],
        ]


class TestDelegateExtIntegration:
    def test_a2a_toolset_includes_a2a_list(self):
        assert "a2a_list" in TOOLSETS["a2a"]["tools"]

    def test_a2a_toolset_includes_a2a_delegate(self):
        assert "a2a_delegate" in TOOLSETS["a2a"]["tools"]

    @patch("tools.a2a_delegate_tool.a2a_delegate", return_value='{"ok": true}')
    def test_dispatch_helper_forwards_args(self, mock_a2a_delegate):
        agent = object.__new__(AIAgent)

        result = agent._dispatch_a2a_delegate(
            {
                "goal": "ship it",
                "context": "repo root",
                "agent": "local",
                "a2a_name": "remote-reviewer",
                "toolsets": ["terminal"],
                "max_iterations": 5,
            }
        )

        assert result == '{"ok": true}'
        mock_a2a_delegate.assert_called_once_with(
            goal="ship it",
            context="repo root",
            agent="local",
            a2a_name="remote-reviewer",
            toolsets=["terminal"],
            max_iterations=5,
            session_id=None,
            is_delegate_output=True,
            output=None,
            is_loop=False,
            input=None,
            parent_agent=agent,
        )


class TestA2ADelegateSession:
    @pytest.mark.asyncio
    async def test_send_turn_reuses_context_and_emits_tool_metadata(self):
        first_task_id = str(uuid4())
        second_task_id = str(uuid4())
        tool_call = {
            "id": "call_1",
            "function": {
                "name": "web_search",
                "arguments": '{"q":"cats"}',
            },
        }
        fake_client = _FakeA2AClient(
            [
                {
                    "initial_task": _make_a2a_task(
                        task_id=first_task_id,
                        context_id="ctx-1",
                        state=TaskState.TASK_STATE_SUBMITTED,
                    ),
                    "polls": [
                        SimpleNamespace(
                            id=first_task_id,
                            context_id="ctx-1",
                            status=SimpleNamespace(state=TaskState.TASK_STATE_WORKING),
                            history=[
                                _make_a2a_history_message(
                                    role=Role.ROLE_AGENT,
                                    task_id=first_task_id,
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
                                    task_id=first_task_id,
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
                            task_id=first_task_id,
                            context_id="ctx-1",
                            state=TaskState.TASK_STATE_COMPLETED,
                            text="first reply",
                            role=Role.ROLE_AGENT,
                        ),
                    ],
                },
                {
                    "initial_task": SimpleNamespace(
                        id=second_task_id,
                        context_id="ctx-1",
                        status=SimpleNamespace(state=TaskState.TASK_STATE_SUBMITTED),
                            history=[
                                _make_a2a_history_message(
                                    role=Role.ROLE_AGENT,
                                    task_id=second_task_id,
                                    tool_calls=[tool_call],
                                )
                        ],
                    ),
                    "polls": [
                        _make_a2a_task(
                            task_id=second_task_id,
                            context_id="ctx-1",
                            state=TaskState.TASK_STATE_COMPLETED,
                            text="second reply",
                            role=Role.ROLE_AGENT,
                        ),
                    ],
                },
            ]
        )
        sink = []

        class _Output:
            def emit(self, source, event_type, content, session_id=None):
                sink.append((source, event_type, content, session_id))

        session = _A2ADelegateSession(
            "http://agent.local",
            output=_Output(),
            poll_interval=0,
            timeout=1,
        )
        session._client = fake_client
        session._http_client = _FakeAsyncHTTPClient()

        first = await session.send_turn("hello")
        second = await session.send_turn("follow up")
        await session.close()

        assert first["final_response"] == "first reply"
        assert second["final_response"] == "second reply"
        assert fake_client.sent_requests[0].message.context_id == ""
        assert fake_client.sent_requests[1].message.context_id == "ctx-1"
        assert sink == [
            ("delegate", "tool_call", 'web_search {"q":"cats"}', "ctx-1"),
            ("delegate", "tool_result", 'web_search -> {"results":["cats"]}', "ctx-1"),
            ("delegate", "ai", "first reply", "ctx-1"),
            ("delegate", "tool_call", 'web_search {"q":"cats"}', "ctx-1"),
            ("delegate", "ai", "second reply", "ctx-1"),
        ]
