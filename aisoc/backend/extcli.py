"""AISOC extcli module: a lightweight terminal chat loop backed by AIAgent."""

from __future__ import annotations

from collections.abc import Callable
import json
from pathlib import Path
import threading
import time
from typing import TextIO
from uuid import uuid4

from aisoc.backend.agent_runtime import (
    default_agent_factory,
    load_conversation_history,
    prepare_hermes_home,
)


_CALLBACK_MISSING = object()
DEFAULT_EXTCLI_OUTPUT_PATH = Path("/tmp/extcli_output")
_FAST_TURN_JOIN_TIMEOUT_SECONDS = 0.01


class _ExtCliOutputAdapter:
    def __init__(self, output: TextIO):
        self._output = output
        self._lock = threading.Lock()

    def write(self, text: str) -> None:
        with self._lock:
            self._output.write(text)
            flush = getattr(self._output, "flush", None)
            if callable(flush):
                flush()

    def write_line(self, text: str = "") -> None:
        with self._lock:
            self._output.write(text + "\n")
            flush = getattr(self._output, "flush", None)
            if callable(flush):
                flush()

    def emit(self, target: str, event_type: str, message: str, *, session_id: str | None = None) -> None:
        del session_id
        if event_type == "error":
            self.write_line(f"error: {message}")
            return
        if event_type == "busy":
            self.write_line(f"{target} busy: {message}")
            return
        self.write_line(message)


class ExtCliSessionRouter:
    def __init__(self):
        self._lock = threading.Lock()
        self._foreground = "main"
        self._main_busy = False
        self._delegate_input = None

    def begin_main_turn(self) -> bool:
        with self._lock:
            if self._foreground != "main" or self._main_busy:
                return False
            self._main_busy = True
            return True

    def end_main_turn(self) -> None:
        with self._lock:
            self._main_busy = False

    def current_target(self) -> str:
        with self._lock:
            return self._foreground


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
    output_adapter: _ExtCliOutputAdapter,
) -> str:
    streamed_chunks: list[str] = []
    ai_prefix_written = False
    ai_line_open = False

    def _stream_callback(delta: str | None) -> None:
        nonlocal ai_prefix_written, ai_line_open
        if delta is None:
            if ai_line_open:
                output_adapter.write_line()
                ai_line_open = False
            return
        if not ai_prefix_written:
            output_adapter.write("ai: ")
            ai_prefix_written = True
        ai_line_open = True
        output_adapter.write(delta)
        streamed_chunks.append(delta)

    def _tool_start_callback(tool_call_id: str, function_name: str, function_args: dict | None) -> None:
        del tool_call_id
        payload = ""
        if function_args:
            payload = " " + json.dumps(function_args, ensure_ascii=True, separators=(",", ":"))
        output_adapter.write_line(f"tool call: {function_name}{payload}")

    def _tool_complete_callback(
        tool_call_id: str,
        function_name: str,
        function_args: dict | None,
        function_result: object,
    ) -> None:
        del tool_call_id, function_name, function_args
        output_adapter.write_line(f"tool result: {_truncate_result(function_result)}")

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
        if ai_line_open:
            output_adapter.write_line()

    final_response = str(result.get("final_response") or "")
    if not streamed_chunks and final_response:
        output_adapter.write_line(f"ai: {final_response}")
    elif streamed_chunks and not final_response:
        final_response = "".join(streamed_chunks)
    return final_response


def _run_agent_turn_worker(
    agent: object,
    user_message: str,
    output_adapter: _ExtCliOutputAdapter,
    router: ExtCliSessionRouter,
) -> None:
    try:
        history = load_conversation_history(agent, getattr(agent, "session_id", None))
        _run_agent_turn(agent, user_message, history, output_adapter)
    except Exception as exc:
        output_adapter.emit("main", "error", str(exc), session_id=getattr(agent, "session_id", None))
    finally:
        router.end_main_turn()


def _start_main_turn(
    agent: object,
    user_message: str,
    output_adapter: _ExtCliOutputAdapter,
    router: ExtCliSessionRouter,
) -> threading.Thread:
    worker = threading.Thread(
        target=_run_agent_turn_worker,
        args=(agent, user_message, output_adapter, router),
        daemon=True,
    )
    worker.start()
    worker.join(timeout=_FAST_TURN_JOIN_TIMEOUT_SECONDS)
    return worker


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
    output_adapter = _ExtCliOutputAdapter(active_output)
    factory = agent_factory or (lambda session_id: default_agent_factory(session_id, platform="aisoc-extcli"))
    router = ExtCliSessionRouter()
    active_workers: list[threading.Thread] = []

    try:
        session_id = str(uuid4())
        agent = factory(session_id)
        output_adapter.write_line("AISOC extcli ready. Use /new to reset and /exit to quit.")
        while True:
            try:
                raw = input_fn("extcli> ")
            except EOFError:
                output_adapter.write_line("Bye.")
                return

            user_message = raw.strip()
            if not user_message:
                continue
            if user_message == "/exit":
                output_adapter.write_line("Bye.")
                return
            if router.current_target() == "main" and not router.begin_main_turn():
                output_adapter.emit("main", "busy", "main session is busy")
                continue
            if user_message == "/new":
                router.end_main_turn()
                session_id = str(uuid4())
                agent = factory(session_id)
                output_adapter.write_line("Started a new session.")
                continue

            try:
                worker = _start_main_turn(agent, user_message, output_adapter, router)
                if worker.is_alive():
                    active_workers = [existing for existing in active_workers if existing.is_alive()]
                    active_workers.append(worker)
            except KeyboardInterrupt:
                router.end_main_turn()
                output_adapter.write_line("Interrupted.")
                continue
            except Exception as exc:
                router.end_main_turn()
                output_adapter.write_line(f"error: {exc}")
                continue
    finally:
        deadline = time.time() + 2
        for worker in active_workers:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            worker.join(timeout=remaining)
        if should_close_output:
            close = getattr(active_output, "close", None)
            if callable(close):
                close()


def start_extcli(*, agent_factory: Callable[[str], object] | None = None) -> None:
    """Start AISOC extcli after configuring the active Hermes profile directory."""
    prepare_hermes_home()
    run_extcli_loop(agent_factory=agent_factory)
