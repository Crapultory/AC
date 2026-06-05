import json
import threading
from unittest.mock import MagicMock, patch

from run_agent import AIAgent
from toolsets import TOOLSETS, _HERMES_CORE_TOOLS
from tools.registry import registry
from tools.delegate_ext_tool import (
    DELEGATE_EXT_SCHEMA,
    _strip_recursive_delegate_tool,
    delegate_ext,
)


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


class TestDelegateExtSchema:
    def test_a2a_list_schema_is_registered(self):
        schema = registry.get_schema("a2a_list")
        assert schema is not None
        assert schema["name"] == "a2a_list"

    def test_schema_fields_present(self):
        assert DELEGATE_EXT_SCHEMA["name"] == "delegate_ext"
        props = DELEGATE_EXT_SCHEMA["parameters"]["properties"]
        assert "goal" in props
        assert "context" in props
        assert "agent" in props
        assert "toolsets" in props
        assert "max_iterations" in props
        assert props["agent"]["enum"] == ["local", "a2a"]

    def test_schema_fields_include_loop_and_io(self):
        props = DELEGATE_EXT_SCHEMA["parameters"]["properties"]
        assert "is_delegate_output" in props
        assert "is_loop" in props

    def test_schema_includes_a2a_name(self):
        props = DELEGATE_EXT_SCHEMA["parameters"]["properties"]
        assert "a2a_name" in props


class TestDelegateExt:
    def test_requires_parent_agent(self):
        result = json.loads(delegate_ext(goal="test"))
        assert "error" in result
        assert "parent agent" in result["error"].lower()

    def test_requires_goal(self):
        parent = _make_mock_parent()
        result = json.loads(delegate_ext(goal="  ", parent_agent=parent))
        assert "error" in result
        assert "goal" in result["error"].lower()

    def test_a2a_mode_placeholder(self):
        parent = _make_mock_parent()
        result = json.loads(
            delegate_ext(goal="test remote", agent="a2a", parent_agent=parent)
        )
        assert result["error"]
        assert result["agent"] == "a2a"
        assert "not implemented" in result["error"].lower()

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

        result = json.loads(delegate_ext(goal="finish task", parent_agent=parent))

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
            delegate_ext(
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

    def test_invalid_toolset_returns_error(self):
        parent = _make_mock_parent()
        result = json.loads(
            delegate_ext(
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
            delegate_ext(goal="inspect", is_loop=True, input=None, parent_agent=parent)
        )
        assert "error" in result
        assert "input" in result["error"].lower()

    @patch("run_agent.AIAgent")
    def test_delegate_ext_emits_output_when_enabled(self, mock_agent_cls):
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
            delegate_ext(
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
    def test_delegate_ext_suppresses_output_when_disabled(self, mock_agent_cls):
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

        delegate_ext(
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

        result = json.loads(delegate_ext(goal="finish task", parent_agent=parent))

        assert result["final_response"] == "done"
        assert result["loop_exit_reason"] == "completed"

    def test_strip_recursive_delegate_tool_removes_delegate_ext(self):
        child = MagicMock()
        child.valid_tool_names = {"read_file", "delegate_ext"}
        child.tool_definitions = [
            {"type": "function", "function": {"name": "delegate_ext"}},
            {"type": "function", "function": {"name": "read_file"}},
        ]

        _strip_recursive_delegate_tool(child)

        assert "delegate_ext" not in child.valid_tool_names
        names = {tool["function"]["name"] for tool in child.tool_definitions}
        assert "delegate_ext" not in names

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
            delegate_ext(
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
            delegate_ext(
                goal="start",
                is_loop=True,
                input=_Input(["/exit"]),
                parent_agent=parent,
            )
        )

        assert result["loop_exit_reason"] == "main_command"


class TestDelegateExtIntegration:
    def test_hermes_core_tools_include_a2a_list(self):
        assert "a2a_list" in _HERMES_CORE_TOOLS

    def test_hermes_core_tools_include_delegate_ext(self):
        assert "delegate_ext" in _HERMES_CORE_TOOLS

    def test_delegation_toolset_includes_a2a_list(self):
        assert "a2a_list" in TOOLSETS["delegation"]["tools"]

    def test_delegation_toolset_includes_delegate_ext(self):
        assert "delegate_ext" in TOOLSETS["delegation"]["tools"]

    @patch("tools.delegate_ext_tool.delegate_ext", return_value='{"ok": true}')
    def test_dispatch_helper_forwards_args(self, mock_delegate_ext):
        agent = object.__new__(AIAgent)

        result = agent._dispatch_delegate_ext(
            {
                "goal": "ship it",
                "context": "repo root",
                "agent": "local",
                "toolsets": ["terminal"],
                "max_iterations": 5,
            }
        )

        assert result == '{"ok": true}'
        mock_delegate_ext.assert_called_once_with(
            goal="ship it",
            context="repo root",
            agent="local",
            toolsets=["terminal"],
            max_iterations=5,
            is_delegate_output=True,
            output=None,
            is_loop=False,
            input=None,
            parent_agent=agent,
        )
