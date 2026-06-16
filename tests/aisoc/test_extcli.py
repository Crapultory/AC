from __future__ import annotations

import json
from io import StringIO
from pathlib import Path
import threading
from unittest.mock import MagicMock, patch

import pytest

import aisoc.backend.extcli as extcli_mod
from aisoc.backend.extcli import ExtCliInputAdapter, ExtCliOutputAdapter, run_extcli_loop, start_extcli
from tools.a2a_delegate_tool import a2a_delegate


class _FakeSessionDB:
    def __init__(self):
        self._messages_by_session: dict[str, list[dict[str, object]]] = {}

    def get_messages_as_conversation(self, session_id: str, include_ancestors: bool = False):
        del include_ancestors
        return list(self._messages_by_session.get(session_id, []))

    def save_messages(self, session_id: str, messages: list[dict[str, object]]) -> None:
        self._messages_by_session[session_id] = list(messages)


class _FakeAgent:
    def __init__(self, label: str, session_id: str, session_db: _FakeSessionDB):
        self.label = label
        self.session_id = session_id
        self._session_db = session_db
        self.calls: list[dict[str, object]] = []

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
    ) -> dict[str, object]:
        del system_message, task_id
        history = list(conversation_history or [])
        self.calls.append({"user_message": user_message, "history": history})
        tool_start = getattr(self, "tool_start_callback", None)
        tool_complete = getattr(self, "tool_complete_callback", None)
        messages: list[dict[str, object]] = list(history)
        messages.append({"role": "user", "content": user_message})
        if user_message == "follow":
            messages.append(
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {"name": "web_search", "arguments": '{"q":"cats"}'},
                    ],
                }
            )
            if tool_start is not None:
                tool_start("call_1", "web_search", {"q": "cats"})
            if tool_complete is not None:
                tool_complete("call_1", "web_search", {"q": "cats"}, "x" * 60)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": "call_1",
                    "tool_name": "web_search",
                    "content": "x" * 60,
                }
            )
        response = f"{self.label}:{user_message}"
        messages.append({"role": "assistant", "content": response})
        self._session_db.save_messages(self.session_id, messages)
        if stream_callback is not None:
            stream_callback(response)
            stream_callback(None)
        return {"final_response": response}


def test_start_extcli_bootstraps_mcp(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    monkeypatch.setattr(extcli_mod, "prepare_hermes_home", lambda: calls.append("prepare"))
    monkeypatch.setattr(extcli_mod, "start_aisoc_mcp_bootstrap", lambda logger=None: calls.append("bootstrap"))
    monkeypatch.setattr(extcli_mod, "run_extcli_loop", lambda **kwargs: calls.append("run"))

    start_extcli()

    assert calls == ["prepare", "bootstrap", "run"]


class _StreamingFailureAgent:
    def __init__(self, session_db: _FakeSessionDB):
        self.session_db = session_db

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
    ) -> dict[str, object]:
        del user_message, system_message, conversation_history, task_id
        if stream_callback is not None:
            stream_callback("partial")
        raise RuntimeError("boom")


class _MultiChunkAgent:
    def __init__(self, session_db: _FakeSessionDB):
        self.session_db = session_db

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
    ) -> dict[str, object]:
        del user_message, system_message, conversation_history, task_id
        if stream_callback is not None:
            stream_callback("hello ")
            stream_callback("world")
            stream_callback(None)
        return {"final_response": "hello world"}


class _StreamingMismatchAgent:
    def __init__(self, session_db: _FakeSessionDB):
        self.session_db = session_db

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
    ) -> dict[str, object]:
        del user_message, system_message, conversation_history, task_id
        if stream_callback is not None:
            stream_callback("hello")
            stream_callback(None)
        return {"final_response": "hello\n"}


class _MultilineStreamingAgent:
    def __init__(self, session_db: _FakeSessionDB):
        self.session_db = session_db

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
    ) -> dict[str, object]:
        del user_message, system_message, conversation_history, task_id
        if stream_callback is not None:
            stream_callback("hello\nworld")
            stream_callback(None)
        return {"final_response": "hello\nworld"}


class _MultilineToolResultAgent(_FakeAgent):
    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
    ) -> dict[str, object]:
        del system_message, task_id
        history = list(conversation_history or [])
        self.calls.append({"user_message": user_message, "history": history})
        tool_start = getattr(self, "tool_start_callback", None)
        tool_complete = getattr(self, "tool_complete_callback", None)
        if tool_start is not None:
            tool_start("call_1", "tool_name", {"q": "cats"})
        if tool_complete is not None:
            tool_complete("call_1", "tool_name", {"q": "cats"}, "line1\nline2")
        if stream_callback is not None:
            stream_callback("done")
            stream_callback(None)
        return {"final_response": "done"}


class _PrivateSessionAgent(_FakeAgent):
    def __init__(self, label: str, session_id: str, session_db: _FakeSessionDB):
        super().__init__(label, session_id, session_db)
        self._private_session_id = session_id
        del self.session_id

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
    ) -> dict[str, object]:
        del system_message, task_id
        history = list(conversation_history or [])
        self.calls.append({"user_message": user_message, "history": history})
        messages: list[dict[str, object]] = list(history)
        messages.append({"role": "user", "content": user_message})
        response = f"{self.label}:{user_message}"
        messages.append({"role": "assistant", "content": response})
        self._session_db.save_messages(self._private_session_id, messages)
        if stream_callback is not None:
            stream_callback(response)
            stream_callback(None)
        return {"final_response": response}


def test_run_extcli_loop_supports_new_exit_and_truncated_tool_results() -> None:
    created_agents: list[_FakeAgent] = []
    session_db = _FakeSessionDB()
    inputs = iter(["hello", "follow", "third", "/new", "again", "/exit"])
    output = StringIO()

    def _agent_factory(session_id: str) -> _FakeAgent:
        agent = _FakeAgent(f"agent{len(created_agents) + 1}", session_id, session_db)
        created_agents.append(agent)
        return agent

    def _input(prompt: str) -> str:
        output.write(prompt)
        return next(inputs)

    run_extcli_loop(
        agent_factory=_agent_factory,
        input_fn=_input,
        output=output,
    )

    assert len(created_agents) == 2
    assert created_agents[0].calls == [
        {"user_message": "hello", "history": []},
        {
            "user_message": "follow",
            "history": [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "agent1:hello"},
            ],
        },
        {
            "user_message": "third",
            "history": [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "agent1:hello"},
                {
                    "role": "user",
                    "content": "follow",
                },
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {"name": "web_search", "arguments": '{"q":"cats"}'},
                    ],
                },
                {
                    "role": "tool",
                    "tool_call_id": "call_1",
                    "tool_name": "web_search",
                    "content": "x" * 60,
                },
                {"role": "assistant", "content": "agent1:follow"},
            ],
        },
    ]
    assert created_agents[1].calls == [
        {"user_message": "again", "history": []},
    ]

    transcript = output.getvalue()
    assert "agent1:hello" in transcript
    assert "main.tool_call: web_search" in transcript
    assert "main.tool_result: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..." in transcript
    assert "Started a new session." in transcript
    assert "Bye." in transcript


def test_run_extcli_loop_uses_factory_session_id_for_worker_history() -> None:
    created_agents: list[_PrivateSessionAgent] = []
    session_db = _FakeSessionDB()
    inputs = iter(["hello", "follow", "/exit"])
    output = StringIO()

    def _agent_factory(session_id: str) -> _PrivateSessionAgent:
        agent = _PrivateSessionAgent(f"agent{len(created_agents) + 1}", session_id, session_db)
        created_agents.append(agent)
        return agent

    run_extcli_loop(
        agent_factory=_agent_factory,
        input_fn=lambda prompt: next(inputs),
        output=output,
    )

    assert len(created_agents) == 1
    assert created_agents[0].calls == [
        {"user_message": "hello", "history": []},
        {
            "user_message": "follow",
            "history": [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "agent1:hello"},
            ],
        },
    ]


def test_run_extcli_loop_skips_empty_input() -> None:
    output = StringIO()
    inputs = iter(["   ", "/exit"])
    session_db = _FakeSessionDB()

    run_extcli_loop(
        agent_factory=lambda session_id: _FakeAgent("agent", session_id, session_db),
        input_fn=lambda prompt: next(inputs),
        output=output,
    )

    assert "Bye." in output.getvalue()


def test_run_extcli_loop_uses_tmp_output_path_by_default(tmp_path, monkeypatch):
    opened = {}
    writes = []

    class _Recorder:
        def write(self, text):
            writes.append(text)

        def flush(self):
            pass

    def _fake_open(path, append=False):
        opened["path"] = path
        opened["append"] = append
        return _Recorder()

    monkeypatch.setattr("aisoc.backend.extcli._open_output_file", _fake_open)
    inputs = iter(["/exit"])

    run_extcli_loop(
        agent_factory=lambda session_id: _FakeAgent("agent", session_id, _FakeSessionDB()),
        input_fn=lambda prompt: next(inputs),
    )

    assert opened["path"] == Path("/tmp/extcli_output")
    assert opened["append"] is False
    assert writes


def test_run_extcli_loop_truncates_output_by_default(tmp_path, monkeypatch):
    output_path = tmp_path / "extcli_output"
    output_path.write_text("old data", encoding="utf-8")
    inputs = iter(["/exit"])

    run_extcli_loop(
        agent_factory=lambda session_id: _FakeAgent("agent", session_id, _FakeSessionDB()),
        input_fn=lambda prompt: next(inputs),
        output_path=output_path,
    )

    text = output_path.read_text(encoding="utf-8")
    assert "old data" not in text
    assert "Bye." in text


def test_run_extcli_loop_appends_when_requested(tmp_path):
    output_path = tmp_path / "extcli_output"
    output_path.write_text("old data\n", encoding="utf-8")
    inputs = iter(["/exit"])

    run_extcli_loop(
        agent_factory=lambda session_id: _FakeAgent("agent", session_id, _FakeSessionDB()),
        input_fn=lambda prompt: next(inputs),
        output_path=output_path,
        append_output=True,
    )

    text = output_path.read_text(encoding="utf-8")
    assert text.startswith("old data\n")
    assert "AISOC extcli ready." in text
    assert "Bye." in text


def test_run_extcli_loop_output_stream_bypasses_open_output_file(monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("_open_output_file should not be called when output is provided")

    monkeypatch.setattr("aisoc.backend.extcli._open_output_file", _boom)
    output = StringIO()
    inputs = iter(["/exit"])

    run_extcli_loop(
        agent_factory=lambda session_id: _FakeAgent("agent", session_id, _FakeSessionDB()),
        input_fn=lambda prompt: next(inputs),
        output=output,
        output_path=Path("/tmp/should-not-be-used"),
    )

    assert "Bye." in output.getvalue()


def test_run_extcli_loop_closes_output_on_agent_factory_failure(monkeypatch):
    closed = []

    class _Recorder:
        def write(self, text):
            pass

        def flush(self):
            pass

        def close(self):
            closed.append(True)

    def _fake_open(path, append=False):
        del path, append
        return _Recorder()

    def _boom(session_id: str):
        del session_id
        raise RuntimeError("factory failed")

    monkeypatch.setattr("aisoc.backend.extcli._open_output_file", _fake_open)

    with pytest.raises(RuntimeError, match="factory failed"):
        run_extcli_loop(agent_factory=_boom, input_fn=lambda prompt: "/exit")

    assert closed == [True]


def test_run_extcli_loop_ends_partial_stream_before_error_line() -> None:
    output = StringIO()
    inputs = iter(["hello", "/exit"])

    run_extcli_loop(
        agent_factory=lambda session_id: _StreamingFailureAgent(_FakeSessionDB()),
        input_fn=lambda prompt: next(inputs),
        output=output,
    )

    transcript = output.getvalue()
    assert "main.ai: partial\nmain.error: boom\n" in transcript


def test_run_extcli_loop_aggregates_streamed_ai_output_into_one_line() -> None:
    output = StringIO()
    inputs = iter(["hello", "/exit"])

    run_extcli_loop(
        agent_factory=lambda session_id: _MultiChunkAgent(_FakeSessionDB()),
        input_fn=lambda prompt: next(inputs),
        output=output,
    )

    transcript = output.getvalue()
    assert "main.ai: hello world\n" in transcript
    assert transcript.count("main.ai:") == 1


def test_run_extcli_loop_uses_one_ai_line_when_final_response_differs_slightly() -> None:
    output = StringIO()
    inputs = iter(["hello", "/exit"])

    run_extcli_loop(
        agent_factory=lambda session_id: _StreamingMismatchAgent(_FakeSessionDB()),
        input_fn=lambda prompt: next(inputs),
        output=output,
    )

    transcript = output.getvalue()
    assert "main.ai: hello\n" in transcript
    assert transcript.count("main.ai:") == 1


def test_run_extcli_loop_escapes_multiline_ai_output_to_one_line() -> None:
    output = StringIO()
    inputs = iter(["hello", "/exit"])

    run_extcli_loop(
        agent_factory=lambda session_id: _MultilineStreamingAgent(_FakeSessionDB()),
        input_fn=lambda prompt: next(inputs),
        output=output,
    )

    transcript = output.getvalue()
    assert "main.ai: hello\\nworld\n" in transcript
    assert "main.ai: hello\nworld\n" not in transcript


def test_run_extcli_loop_escapes_multiline_tool_result_to_one_line() -> None:
    output = StringIO()
    inputs = iter(["hello", "/exit"])

    run_extcli_loop(
        agent_factory=lambda session_id: _MultilineToolResultAgent("agent", session_id, _FakeSessionDB()),
        input_fn=lambda prompt: next(inputs),
        output=output,
    )

    transcript = output.getvalue()
    assert "main.tool_result: line1\\nline2\n" in transcript
    assert "main.tool_result: line1\nline2\n" not in transcript


def test_output_uses_main_prefixes(tmp_path):
    session_db = _FakeSessionDB()
    output_path = tmp_path / "extcli_output"
    inputs = iter(["follow", "/exit"])

    run_extcli_loop(
        agent_factory=lambda session_id: _FakeAgent("agent", session_id, session_db),
        input_fn=lambda prompt: next(inputs),
        output_path=output_path,
    )

    text = output_path.read_text(encoding="utf-8")
    assert "main.ai:" in text
    assert "main.tool_call:" in text
    assert "main.tool_result:" in text
    assert "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..." in text


def test_output_adapter_failure_does_not_deadlock(tmp_path):
    del tmp_path

    writes: list[str] = []

    class _BrokenSink:
        def write(self, text):
            writes.append(text)
            raise OSError("disk full")

        def flush(self):
            pass

    adapter = ExtCliOutputAdapter(_BrokenSink())
    adapter.emit("main", "status", "hello", session_id="s1")
    adapter.emit("main", "status", "again", session_id="s1")
    assert writes == ["main.status: hello\n", "main.status: again\n"]


def test_output_adapter_uses_delegate_session_prefix() -> None:
    output = StringIO()
    adapter = ExtCliOutputAdapter(output)

    adapter.emit("delegate", "status", "entered foreground loop", session_id="child-1")

    assert output.getvalue() == "delegate[child-1].status: entered foreground loop\n"


def test_input_adapter_reads_pushed_lines_until_closed() -> None:
    adapter = ExtCliInputAdapter()
    observed: list[str | None] = []

    def _reader() -> None:
        observed.append(adapter.read_line())
        observed.append(adapter.read_line())

    reader = threading.Thread(target=_reader)
    reader.start()
    adapter.push_line("child followup")
    adapter.close()
    reader.join(timeout=1)

    assert not reader.is_alive()
    assert observed == ["child followup", None]


def test_sync_failures_use_prefixed_error_output(monkeypatch) -> None:
    output = StringIO()
    inputs = iter(["hello", "/exit"])

    def _boom(*args, **kwargs):
        del args, kwargs
        raise RuntimeError("sync boom")

    monkeypatch.setattr("aisoc.backend.extcli._start_main_turn", _boom)

    run_extcli_loop(
        agent_factory=lambda session_id: _FakeAgent("agent", session_id, _FakeSessionDB()),
        input_fn=lambda prompt: next(inputs),
        output=output,
    )

    transcript = output.getvalue()
    assert "main.error: sync boom\n" in transcript


def test_main_session_rejects_input_while_busy(tmp_path):
    session_db = _FakeSessionDB()
    output_path = tmp_path / "extcli_output"
    started = threading.Event()
    release = threading.Event()
    created_agents: list[_FakeAgent] = []

    class _BlockingAgent(_FakeAgent):
        def run_conversation(self, user_message, *args, **kwargs):
            started.set()
            release.wait(timeout=2)
            return super().run_conversation(user_message, *args, **kwargs)

    values = iter(["hello", "second"])

    def _input(prompt: str) -> str:
        del prompt
        try:
            value = next(values)
        except StopIteration:
            release.set()
            raise EOFError()
        if value == "second":
            assert started.wait(timeout=1), "main turn never entered busy state"
        return value

    run_extcli_loop(
        agent_factory=lambda session_id: created_agents.append(
            _BlockingAgent("agent", session_id, session_db)
        ) or created_agents[-1],
        input_fn=_input,
        output_path=output_path,
    )

    release.set()
    text = output_path.read_text(encoding="utf-8")
    assert len(created_agents) == 1
    assert [call["user_message"] for call in created_agents[0].calls] == ["hello"]
    assert "agent:second" not in text
    assert "busy" in text.lower()


def test_new_command_is_rejected_while_main_busy(tmp_path):
    session_db = _FakeSessionDB()
    output_path = tmp_path / "extcli_output"
    started = threading.Event()
    release = threading.Event()
    created_agents: list[_FakeAgent] = []

    class _BlockingAgent(_FakeAgent):
        def run_conversation(self, user_message, *args, **kwargs):
            started.set()
            release.wait(timeout=2)
            return super().run_conversation(user_message, *args, **kwargs)

    values = iter(["hello", "/new"])

    def _input(prompt: str) -> str:
        del prompt
        try:
            value = next(values)
        except StopIteration:
            release.set()
            raise EOFError()
        if value == "/new":
            assert started.wait(timeout=1), "main turn never entered busy state"
        return value

    run_extcli_loop(
        agent_factory=lambda session_id: created_agents.append(
            _BlockingAgent("agent", session_id, session_db)
        ) or created_agents[-1],
        input_fn=_input,
        output_path=output_path,
    )

    release.set()
    text = output_path.read_text(encoding="utf-8")
    assert len(created_agents) == 1
    assert [call["user_message"] for call in created_agents[0].calls] == ["hello"]
    assert "Started a new session." not in text
    assert "busy" in text.lower()


def test_exit_waits_for_busy_main_turn_before_shutdown():
    session_db = _FakeSessionDB()
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    loop_done = threading.Event()
    output = StringIO()

    class _BlockingAgent(_FakeAgent):
        def run_conversation(self, user_message, *args, **kwargs):
            started.set()
            release.wait(timeout=2)
            try:
                return super().run_conversation(user_message, *args, **kwargs)
            finally:
                finished.set()

    inputs = iter(["hello", "/exit"])

    def _run_loop() -> None:
        try:
            run_extcli_loop(
                agent_factory=lambda session_id: _BlockingAgent("agent", session_id, session_db),
                input_fn=lambda prompt: next(inputs),
                output=output,
            )
        finally:
            loop_done.set()

    loop_thread = threading.Thread(target=_run_loop)
    loop_thread.start()

    assert started.wait(timeout=1), "main turn never entered busy state"
    assert not loop_done.wait(timeout=0.2), "loop exited before busy turn finished"

    release.set()
    loop_thread.join(timeout=1)

    assert not loop_thread.is_alive()
    assert finished.is_set()
    assert loop_done.is_set()
    assert "Bye." in output.getvalue()


def test_delegate_loop_takes_foreground_and_returns_to_main(tmp_path):
    output_path = tmp_path / "extcli_output"
    session_db = _FakeSessionDB()
    inputs = iter(["delegate", "child followup", "/exit", "after child", "/exit"])

    def _input(prompt: str) -> str:
        del prompt
        try:
            return next(inputs)
        except StopIteration:
            raise EOFError()

    class _DelegateParentAgent(_FakeAgent):
        def run_conversation(self, user_message, *args, **kwargs):
            if user_message != "delegate":
                return super().run_conversation(user_message, *args, **kwargs)

            child_results = iter(
                [
                    {"final_response": "child start", "completed": True, "api_calls": 1},
                    {"final_response": "child followup done", "completed": True, "api_calls": 2},
                ]
            )

            with patch("run_agent.AIAgent") as mock_agent_cls:
                child = MagicMock()
                child.session_id = "child-session"
                child.run_conversation.side_effect = lambda *a, **k: next(child_results)
                mock_agent_cls.return_value = child
                result = json.loads(
                    a2a_delegate(
                        goal="start child",
                        agent="local",
                        is_loop=True,
                        input=self._delegate_ext_input_factory(),
                        output=self._delegate_ext_output_adapter,
                        parent_agent=self,
                    )
                )

            return {"final_response": f'delegated:{result["final_response"]}'}

    run_extcli_loop(
        agent_factory=lambda session_id: _DelegateParentAgent("agent", session_id, session_db),
        input_fn=_input,
        output_path=output_path,
    )

    text = output_path.read_text(encoding="utf-8")
    assert "delegate[" in text
    assert "return to main" in text
    assert "after child" in text


def test_child_loop_failure_returns_control_to_main(tmp_path):
    output_path = tmp_path / "extcli_output"
    session_db = _FakeSessionDB()
    inputs = iter(["delegate", "after failure", "/exit"])

    def _input(prompt: str) -> str:
        del prompt
        try:
            return next(inputs)
        except StopIteration:
            raise EOFError()

    class _FailingDelegateParentAgent(_FakeAgent):
        def run_conversation(self, user_message, *args, **kwargs):
            if user_message != "delegate":
                return super().run_conversation(user_message, *args, **kwargs)

            with patch("run_agent.AIAgent") as mock_agent_cls:
                child = MagicMock()
                child.session_id = "child-session"
                child.run_conversation.side_effect = RuntimeError("delegate loop failed")
                mock_agent_cls.return_value = child
                result = json.loads(
                    a2a_delegate(
                        goal="start child",
                        agent="local",
                        is_loop=True,
                        input=self._delegate_ext_input_factory(),
                        output=self._delegate_ext_output_adapter,
                        parent_agent=self,
                    )
                )
            assert result["loop_exit_reason"] == "error"
            return {"final_response": "delegate attempted"}

    run_extcli_loop(
        agent_factory=lambda session_id: _FailingDelegateParentAgent("agent", session_id, session_db),
        input_fn=_input,
        output_path=output_path,
    )

    text = output_path.read_text(encoding="utf-8")
    assert "error" in text.lower()
    assert "after failure" in text
    assert "loop failed" in text


def test_child_loop_input_closed_unwinds_cleanly(tmp_path):
    output_path = tmp_path / "extcli_output"
    session_db = _FakeSessionDB()
    inputs = iter(["delegate"])

    def _input(prompt: str) -> str:
        del prompt
        try:
            return next(inputs)
        except StopIteration:
            raise EOFError()

    class _InputClosedDelegateParentAgent(_FakeAgent):
        def run_conversation(self, user_message, *args, **kwargs):
            if user_message != "delegate":
                return super().run_conversation(user_message, *args, **kwargs)

            with patch("run_agent.AIAgent") as mock_agent_cls:
                child = MagicMock()
                child.session_id = "child-session"
                child.run_conversation.return_value = {
                    "final_response": "child start",
                    "completed": True,
                    "api_calls": 1,
                }
                mock_agent_cls.return_value = child
                result = json.loads(
                    a2a_delegate(
                        goal="start child",
                        agent="local",
                        is_loop=True,
                        input=self._delegate_ext_input_factory(),
                        output=self._delegate_ext_output_adapter,
                        parent_agent=self,
                    )
                )
            assert result["loop_exit_reason"] == "input_closed"
            return {"final_response": "delegate closed"}

    run_extcli_loop(
        agent_factory=lambda session_id: _InputClosedDelegateParentAgent("agent", session_id, session_db),
        input_fn=_input,
        output_path=output_path,
    )

    assert "delegate closed" in output_path.read_text(encoding="utf-8")


def test_new_inside_child_loop_is_treated_as_child_input(tmp_path):
    output_path = tmp_path / "extcli_output"
    session_db = _FakeSessionDB()
    inputs = iter(["delegate", "/new", "/exit", "after child", "/exit"])

    def _input(prompt: str) -> str:
        del prompt
        try:
            return next(inputs)
        except StopIteration:
            raise EOFError()

    class _SlashDelegateParentAgent(_FakeAgent):
        def run_conversation(self, user_message, *args, **kwargs):
            if user_message != "delegate":
                return super().run_conversation(user_message, *args, **kwargs)

            child_results = iter(
                [
                    {"final_response": "child start", "completed": True, "api_calls": 1},
                    {"final_response": "child slash seen", "completed": True, "api_calls": 2},
                ]
            )

            with patch("run_agent.AIAgent") as mock_agent_cls:
                child = MagicMock()
                child.session_id = "child-session"
                child.run_conversation.side_effect = lambda *a, **k: next(child_results)
                mock_agent_cls.return_value = child
                result = json.loads(
                    a2a_delegate(
                        goal="start child",
                        agent="local",
                        is_loop=True,
                        input=self._delegate_ext_input_factory(),
                        output=self._delegate_ext_output_adapter,
                        parent_agent=self,
                    )
                )

            return {"final_response": f'delegated:{result["final_response"]}'}

    run_extcli_loop(
        agent_factory=lambda session_id: _SlashDelegateParentAgent("agent", session_id, session_db),
        input_fn=_input,
        output_path=output_path,
    )

    text = output_path.read_text(encoding="utf-8")
    assert "child slash seen" in text
    assert "Started a new session." not in text
