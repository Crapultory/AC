"""AISOC extcli module: a lightweight terminal chat loop backed by AIAgent."""

from __future__ import annotations

from collections.abc import Callable
import json
from pathlib import Path
from typing import TextIO
from uuid import uuid4

from aisoc.backend.agent_runtime import (
    default_agent_factory,
    load_conversation_history,
    prepare_hermes_home,
)


_CALLBACK_MISSING = object()
DEFAULT_EXTCLI_OUTPUT_PATH = Path("/tmp/extcli_output")


def _truncate_result(value: object, *, limit: int = 50) -> str:
    text = str(value)
    if len(text) <= limit:
        return text
    return text[:limit] + "..."


def _write_line(output: TextIO, text: str = "") -> None:
    output.write(text + "\n")
    flush = getattr(output, "flush", None)
    if callable(flush):
        flush()


def _open_output_file(path: Path, *, append: bool = False) -> TextIO:
    mode = "a" if append else "w"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path.open(mode, encoding="utf-8")


def _run_agent_turn(
    agent: object,
    user_message: str,
    history: list[dict[str, str]],
    output: TextIO,
) -> str:
    streamed_chunks: list[str] = []
    ai_prefix_written = False

    def _stream_callback(delta: str | None) -> None:
        nonlocal ai_prefix_written
        if delta is None:
            if ai_prefix_written:
                _write_line(output)
            return
        if not ai_prefix_written:
            output.write("ai: ")
            ai_prefix_written = True
        output.write(delta)
        flush = getattr(output, "flush", None)
        if callable(flush):
            flush()
        streamed_chunks.append(delta)

    def _tool_start_callback(tool_call_id: str, function_name: str, function_args: dict | None) -> None:
        del tool_call_id
        payload = ""
        if function_args:
            payload = " " + json.dumps(function_args, ensure_ascii=True, separators=(",", ":"))
        _write_line(output, f"tool call: {function_name}{payload}")

    def _tool_complete_callback(
        tool_call_id: str,
        function_name: str,
        function_args: dict | None,
        function_result: object,
    ) -> None:
        del tool_call_id, function_name, function_args
        _write_line(output, f"tool result: {_truncate_result(function_result)}")

    old_tool_start = getattr(agent, "tool_start_callback", _CALLBACK_MISSING)
    old_tool_complete = getattr(agent, "tool_complete_callback", _CALLBACK_MISSING)
    try:
        setattr(agent, "tool_start_callback", _tool_start_callback)
        setattr(agent, "tool_complete_callback", _tool_complete_callback)
        result = agent.run_conversation(
            user_message,
            None,
            history,
            str(uuid4()),
            stream_callback=_stream_callback,
        )
    finally:
        if old_tool_start is _CALLBACK_MISSING:
            try:
                delattr(agent, "tool_start_callback")
            except Exception:
                pass
        else:
            setattr(agent, "tool_start_callback", old_tool_start)
        if old_tool_complete is _CALLBACK_MISSING:
            try:
                delattr(agent, "tool_complete_callback")
            except Exception:
                pass
        else:
            setattr(agent, "tool_complete_callback", old_tool_complete)

    final_response = str(result.get("final_response") or "")
    if not streamed_chunks and final_response:
        _write_line(output, f"ai: {final_response}")
    elif streamed_chunks and not final_response:
        final_response = "".join(streamed_chunks)
    return final_response


def run_extcli_loop(
    *,
    agent_factory: Callable[[str], object] | None = None,
    input_fn: Callable[[str], str] = input,
    output: TextIO | None = None,
    output_path: Path | str | None = None,
    append_output: bool = False,
) -> None:
    """Run the interactive extcli session loop."""
    if output is not None:
        active_output = output
        should_close_output = False
    else:
        resolved_output_path = (
            Path(output_path) if output_path is not None else DEFAULT_EXTCLI_OUTPUT_PATH
        )
        active_output = _open_output_file(resolved_output_path, append=append_output)
        should_close_output = True
    factory = agent_factory or (lambda session_id: default_agent_factory(session_id, platform="aisoc-extcli"))

    try:
        session_id = str(uuid4())
        agent = factory(session_id)
        _write_line(active_output, "AISOC extcli ready. Use /new to reset and /exit to quit.")
        while True:
            try:
                raw = input_fn("extcli> ")
            except EOFError:
                _write_line(active_output, "Bye.")
                return

            user_message = raw.strip()
            if not user_message:
                continue
            if user_message == "/exit":
                _write_line(active_output, "Bye.")
                return
            if user_message == "/new":
                session_id = str(uuid4())
                agent = factory(session_id)
                _write_line(active_output, "Started a new session.")
                continue

            try:
                history = load_conversation_history(agent, session_id)
                _run_agent_turn(agent, user_message, history, active_output)
            except KeyboardInterrupt:
                _write_line(active_output, "Interrupted.")
                continue
            except Exception as exc:
                _write_line(active_output, f"error: {exc}")
                continue
    finally:
        if should_close_output:
            close = getattr(active_output, "close", None)
            if callable(close):
                close()


def start_extcli(*, agent_factory: Callable[[str], object] | None = None) -> None:
    """Start AISOC extcli after configuring the active Hermes profile directory."""
    prepare_hermes_home()
    run_extcli_loop(agent_factory=agent_factory)
