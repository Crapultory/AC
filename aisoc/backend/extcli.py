"""AISOC extcli module: a lightweight terminal chat loop backed by AIAgent."""

from __future__ import annotations

from collections.abc import Callable
import json
from pathlib import Path
import threading
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


def _format_event_content(content: str) -> str:
    return content.replace("\\", "\\\\").replace("\r\n", "\\n").replace("\r", "\\n").replace("\n", "\\n")


class ExtCliOutputAdapter:
    def __init__(self, output: TextIO):
        self._output = output
        self._lock = threading.Lock()

    def write(self, text: str) -> None:
        with self._lock:
            try:
                self._output.write(text)
                flush = getattr(self._output, "flush", None)
                if callable(flush):
                    flush()
            except OSError:
                return

    def write_line(self, text: str = "") -> None:
        with self._lock:
            try:
                self._output.write(text + "\n")
                flush = getattr(self._output, "flush", None)
                if callable(flush):
                    flush()
            except OSError:
                return

    def emit(
        self,
        source: str,
        event_type: str,
        content: str,
        *,
        session_id: str | None = None,
    ) -> None:
        del session_id
        self.write_line(f"{source}.{event_type}: {_format_event_content(content)}")


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

def _open_output_file(path: Path, *, append: bool = False) -> TextIO:
    mode = "a" if append else "w"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path.open(mode, encoding="utf-8")


def _run_agent_turn(
    agent: object,
    user_message: str,
    history: list[dict[str, str]],
    output_adapter: ExtCliOutputAdapter,
) -> str:
    streamed_chunks: list[str] = []
    streamed_output_emitted = False

    def _emit_streamed_output(content: str) -> None:
        nonlocal streamed_output_emitted
        if streamed_output_emitted:
            return
        output_adapter.emit(
            "main",
            "ai",
            content,
            session_id=getattr(agent, "session_id", None),
        )
        streamed_output_emitted = True

    def _stream_callback(delta: str | None) -> None:
        if delta is None:
            return
        streamed_chunks.append(delta)

    def _tool_start_callback(tool_call_id: str, function_name: str, function_args: dict | None) -> None:
        del tool_call_id
        payload = ""
        if function_args:
            payload = " " + json.dumps(function_args, ensure_ascii=True, separators=(",", ":"))
        output_adapter.emit(
            "main",
            "tool_call",
            f"{function_name}{payload}",
            session_id=getattr(agent, "session_id", None),
        )

    def _tool_complete_callback(
        tool_call_id: str,
        function_name: str,
        function_args: dict | None,
        function_result: object,
    ) -> None:
        del tool_call_id, function_name, function_args
        output_adapter.emit(
            "main",
            "tool_result",
            _truncate_result(function_result),
            session_id=getattr(agent, "session_id", None),
        )

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
    except Exception:
        streamed_text = "".join(streamed_chunks)
        if streamed_text:
            _emit_streamed_output(streamed_text)
        raise
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
    streamed_text = "".join(streamed_chunks)
    if streamed_text:
        display_response = streamed_text
        if final_response:
            if final_response.rstrip("\r\n") != streamed_text.rstrip("\r\n"):
                display_response = final_response
        else:
            final_response = streamed_text
        _emit_streamed_output(display_response.rstrip("\r\n"))
    elif final_response:
        output_adapter.emit(
            "main",
            "ai",
            final_response,
            session_id=getattr(agent, "session_id", None),
        )
    return final_response


def _run_agent_turn_worker(
    agent: object,
    session_id: str,
    user_message: str,
    output_adapter: ExtCliOutputAdapter,
    router: ExtCliSessionRouter,
) -> None:
    try:
        history = load_conversation_history(agent, session_id)
        _run_agent_turn(agent, user_message, history, output_adapter)
    except Exception as exc:
        output_adapter.emit("main", "error", str(exc), session_id=session_id)
    finally:
        router.end_main_turn()


def _start_main_turn(
    agent: object,
    session_id: str,
    user_message: str,
    output_adapter: ExtCliOutputAdapter,
    router: ExtCliSessionRouter,
) -> threading.Thread:
    worker = threading.Thread(
        target=_run_agent_turn_worker,
        args=(agent, session_id, user_message, output_adapter, router),
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
    output_adapter = ExtCliOutputAdapter(active_output)
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
                worker = _start_main_turn(agent, session_id, user_message, output_adapter, router)
                if worker.is_alive():
                    active_workers = [existing for existing in active_workers if existing.is_alive()]
                    active_workers.append(worker)
            except KeyboardInterrupt:
                router.end_main_turn()
                output_adapter.write_line("Interrupted.")
                continue
            except Exception as exc:
                router.end_main_turn()
                output_adapter.emit("main", "error", str(exc), session_id=session_id)
                continue
    finally:
        for worker in active_workers:
            worker.join()
        if should_close_output:
            close = getattr(active_output, "close", None)
            if callable(close):
                close()


def start_extcli(*, agent_factory: Callable[[str], object] | None = None) -> None:
    """Start AISOC extcli after configuring the active Hermes profile directory."""
    prepare_hermes_home()
    run_extcli_loop(agent_factory=agent_factory)
