from __future__ import annotations

from io import StringIO
from pathlib import Path
import threading

import pytest

from aisoc.backend.extcli import run_extcli_loop


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
    assert "tool call: web_search" in transcript
    assert "tool result: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..." in transcript
    assert "Started a new session." in transcript
    assert "Bye." in transcript


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
    assert "ai: partial\nerror: boom\n" in transcript


def test_main_session_rejects_input_while_busy(tmp_path):
    session_db = _FakeSessionDB()
    output_path = tmp_path / "extcli_output"
    started = threading.Event()
    release = threading.Event()

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
        agent_factory=lambda session_id: _BlockingAgent("agent", session_id, session_db),
        input_fn=_input,
        output_path=output_path,
    )

    release.set()
    text = output_path.read_text(encoding="utf-8")
    assert "busy" in text.lower()


def test_new_command_is_rejected_while_main_busy(tmp_path):
    session_db = _FakeSessionDB()
    output_path = tmp_path / "extcli_output"
    started = threading.Event()
    release = threading.Event()

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
        agent_factory=lambda session_id: _BlockingAgent("agent", session_id, session_db),
        input_fn=_input,
        output_path=output_path,
    )

    release.set()
    assert "busy" in output_path.read_text(encoding="utf-8").lower()
