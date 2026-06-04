"""Official A2A SDK executor implementation for AISOC."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import inspect
import json
import logging
import os
import time

from a2a.helpers.proto_helpers import new_task_from_user_message
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import TaskState

from hermes_state import SessionDB
from hermes_constants import get_config_path
from hermes_cli import config as hermes_config
from hermes_cli import runtime_provider

from .converter import a2a_to_text, history_to_a2a, role_to_history_role, text_to_message


AgentFactory = Callable[[str], object]


logger = logging.getLogger(__name__)


class _EchoAgent:
    """Deterministic agent for smoke and e2e tests."""

    def __init__(self):
        self._interrupt_requested = False

    def run_conversation(
        self,
        user_message: str,
        system_message: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        task_id: str | None = None,
        stream_callback=None,
    ) -> dict[str, object]:
        del system_message, task_id
        if self._interrupt_requested:
            raise RuntimeError("Canceled by user.")
        history = list(conversation_history or [])
        response = f"echo(turn={(len(history) // 2) + 1}): {user_message}"
        if stream_callback is not None:
            midpoint = max(1, len(response) // 2)
            stream_callback(response[:midpoint])
            time.sleep(0.01)
            stream_callback(response[midpoint:])
            stream_callback(None)
        return {
            "final_response": response,
            "messages": history,
        }


def _default_agent_factory(session_id: str):
    if os.environ.get("AISOC_A2A_TEST_MODE") == "echo":
        return _EchoAgent()
    from run_agent import AIAgent

    agent_kwargs = _profile_agent_kwargs(session_id)
    logger.info(
        "A2A profile injection from %s: %s",
        get_config_path(),
        {
            "provider": agent_kwargs.get("provider"),
            "model": agent_kwargs.get("model"),
            "base_url": agent_kwargs.get("base_url"),
            "api_mode": agent_kwargs.get("api_mode"),
            "source": agent_kwargs.get("_a2a_runtime_source")
        },
    )
    agent_kwargs.pop("_a2a_runtime_source", None)
    try:
        agent_kwargs["session_db"] = SessionDB()
    except Exception as exc:
        logger.warning("A2A SessionDB unavailable; continuing without session persistence: %s", exc)
    return AIAgent(**agent_kwargs)


def _profile_agent_kwargs(session_id: str) -> dict[str, object]:
    """Resolve the current profile into explicit AIAgent kwargs."""
    cfg = hermes_config.load_config_readonly()
    model_cfg = hermes_config.cfg_get(cfg, "model", default={})
    if not isinstance(model_cfg, dict):
        model_cfg = {}

    requested_provider = str(model_cfg.get("provider") or "").strip() or None
    requested_model = str(model_cfg.get("default") or model_cfg.get("model") or "").strip() or None

    runtime = runtime_provider.resolve_runtime_provider(
        requested=requested_provider,
        target_model=requested_model,
    )

    resolved_provider = str(runtime.get("provider") or requested_provider or "auto").strip()
    resolved_model = str(runtime.get("model") or requested_model or "").strip()
    resolved_base_url = str(runtime.get("base_url") or "").strip()
    resolved_api_key = str(runtime.get("api_key") or "").strip()
    resolved_api_mode = str(runtime.get("api_mode") or "").strip()

    agent_kwargs: dict[str, object] = {
        "quiet_mode": True,
        "platform": "aisoc-a2a",
        "session_id": session_id,
        "provider": resolved_provider,
    }
    if resolved_model:
        agent_kwargs["model"] = resolved_model
    if resolved_base_url:
        agent_kwargs["base_url"] = resolved_base_url
    if resolved_api_key:
        agent_kwargs["api_key"] = resolved_api_key
    if resolved_api_mode:
        agent_kwargs["api_mode"] = resolved_api_mode
    if runtime.get("request_overrides"):
        agent_kwargs["request_overrides"] = dict(runtime["request_overrides"])
    if runtime.get("fallback_model"):
        agent_kwargs["fallback_model"] = runtime["fallback_model"]

    agent_kwargs["_a2a_runtime_source"] = runtime.get("source", "config")
    return agent_kwargs


class HermesA2AExecutor(AgentExecutor):
    """Bridge the official A2A SDK to Hermes conversations."""

    _STREAM_DONE = object()
    _CALLBACK_MISSING = object()

    def __init__(
        self,
        agent_factory: AgentFactory | None = None,
        *,
        enable_streaming: bool = False,
    ):
        self._agent_factory = agent_factory or _default_agent_factory
        self._enable_streaming = enable_streaming
        self._agents: dict[str, object] = {}
        self._history_by_context: dict[str, list[dict[str, str]]] = {}
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._lock = asyncio.Lock()

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        if context.message is None:
            raise ValueError("A2A request missing message payload.")

        task = context.current_task
        if task is None:
            task = new_task_from_user_message(context.message)
            context.current_task = task
            await event_queue.enqueue_event(task)

        updater = TaskUpdater(event_queue, task.id, task.context_id)
        cancel_event = asyncio.Event()
        async with self._lock:
            self._cancel_events[task.id] = cancel_event

        user_input = a2a_to_text(context.message)
        await updater.start_work()

        if user_input == "__input_required__":
            await updater.requires_input(
                updater.new_agent_message([text_to_message("Need more information.").parts[0]])
            )
            return

        if user_input == "__fail__":
            await updater.failed(
                updater.new_agent_message([text_to_message("boom").parts[0]])
            )
            return

        if user_input == "__cancel__":
            try:
                await asyncio.wait_for(cancel_event.wait(), timeout=10.0)
            except TimeoutError:
                await updater.failed(
                    updater.new_agent_message(
                        [text_to_message("Cancellation timeout.").parts[0]]
                    )
                )
            return

        history = list(self._history_by_context.get(task.context_id, []))
        agent = await self._get_agent(task.context_id)
        delta_queue: asyncio.Queue[object] | None = None
        stream_task: asyncio.Task[str] | None = None
        stream_callback = None
        tool_start_callback = None
        tool_complete_callback = None
        loop = asyncio.get_running_loop()
        if self._enable_streaming:
            delta_queue = asyncio.Queue()
            stream_task = asyncio.create_task(
                self._drain_stream_deltas(delta_queue, updater)
            )
            tool_start_callback = self._make_tool_start_callback(loop, delta_queue)
            tool_complete_callback = self._make_tool_complete_callback(loop, delta_queue)
            if self._agent_accepts_stream_callback(agent):
                stream_callback = self._make_stream_callback(loop, delta_queue)
        try:
            result = await asyncio.to_thread(
                self._run_agent_conversation,
                agent,
                user_input,
                history,
                task.id,
                stream_callback,
                tool_start_callback,
                tool_complete_callback,
            )
        except Exception as exc:
            await self._finish_stream_consumer(loop, delta_queue, stream_task)
            await updater.failed(
                updater.new_agent_message([text_to_message(str(exc)).parts[0]])
            )
            return
        finally:
            async with self._lock:
                self._cancel_events.pop(task.id, None)

        streamed_text = await self._finish_stream_consumer(loop, delta_queue, stream_task)
        response_text = str(result.get("final_response") or "")
        if not response_text and streamed_text:
            response_text = streamed_text
        response_message = updater.new_agent_message(
            [text_to_message(response_text, context_id=task.context_id, task_id=task.id).parts[0]]
        )
        self._history_by_context[task.context_id] = history + [
            {"role": role_to_history_role(context.message.role), "content": user_input},
            {"role": "assistant", "content": response_text},
        ]
        if bool(result.get("input_required")):
            await updater.requires_input(response_message)
        else:
            await updater.complete(response_message)

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        task = context.current_task
        if task is None:
            return
        async with self._lock:
            event = self._cancel_events.setdefault(task.id, asyncio.Event())
            event.set()
        agent = self._agents.get(task.context_id)
        if agent is not None:
            setattr(agent, "_interrupt_requested", True)
        updater = TaskUpdater(event_queue, task.id, task.context_id)
        await updater.cancel(
            updater.new_agent_message([text_to_message("Canceled by user.").parts[0]])
        )

    async def export_history(
        self, context_id: str, task_id: str
    ) -> list:
        """Expose stored history in A2A message format for tests and diagnostics."""
        history = self._history_by_context.get(context_id, [])
        return history_to_a2a(history, context_id=context_id, task_id=task_id)

    async def _get_agent(self, context_id: str):
        async with self._lock:
            agent = self._agents.get(context_id)
            if agent is None:
                agent = self._agent_factory(context_id)
                self._agents[context_id] = agent
            return agent

    def _agent_accepts_stream_callback(self, agent: object) -> bool:
        try:
            signature = inspect.signature(agent.run_conversation)
        except (TypeError, ValueError, AttributeError):
            return False

        if "stream_callback" in signature.parameters:
            return True
        return any(
            parameter.kind is inspect.Parameter.VAR_KEYWORD
            for parameter in signature.parameters.values()
        )

    def _make_stream_callback(
        self,
        loop: asyncio.AbstractEventLoop,
        delta_queue: asyncio.Queue[object],
    ) -> Callable[[str | None], None]:
        def _callback(delta: str | None) -> None:
            loop.call_soon_threadsafe(delta_queue.put_nowait, delta)

        return _callback

    def _make_tool_start_callback(
        self,
        loop: asyncio.AbstractEventLoop,
        delta_queue: asyncio.Queue[object],
    ) -> Callable[[str, str, dict | None], None]:
        def _callback(tool_call_id: str, function_name: str, function_args: dict | None) -> None:
            loop.call_soon_threadsafe(
                delta_queue.put_nowait,
                {
                    "kind": "tool_call",
                    "tool_call_id": tool_call_id,
                    "name": function_name,
                    "arguments": function_args or {},
                },
            )

        return _callback

    def _make_tool_complete_callback(
        self,
        loop: asyncio.AbstractEventLoop,
        delta_queue: asyncio.Queue[object],
    ) -> Callable[[str, str, dict | None, object], None]:
        def _callback(
            tool_call_id: str,
            function_name: str,
            function_args: dict | None,
            function_result: object,
        ) -> None:
            loop.call_soon_threadsafe(
                delta_queue.put_nowait,
                {
                    "kind": "tool_result",
                    "tool_call_id": tool_call_id,
                    "name": function_name,
                    "arguments": function_args or {},
                    "result": str(function_result),
                },
            )

        return _callback

    def _new_tool_event_message(self, updater: TaskUpdater, payload: dict[str, object]):
        hermes_metadata = {
            "kind": str(payload.get("kind") or ""),
            "tool_call_id": str(payload.get("tool_call_id") or ""),
            "name": str(payload.get("name") or ""),
        }
        arguments = payload.get("arguments")
        if arguments not in (None, {}):
            hermes_metadata["arguments"] = arguments
        result = payload.get("result")
        parts = []
        if result not in (None, ""):
            hermes_metadata["result"] = str(result)
            parts = [text_to_message(str(result)).parts[0]]
        elif arguments not in (None, {}):
            parts = [text_to_message(json.dumps(arguments, ensure_ascii=True, separators=(",", ":"))).parts[0]]
        return updater.new_agent_message(parts, metadata={"hermes": hermes_metadata})

    async def _drain_stream_deltas(
        self,
        delta_queue: asyncio.Queue[object],
        updater: TaskUpdater,
    ) -> str:
        accumulated = ""
        while True:
            delta = await delta_queue.get()
            if delta is self._STREAM_DONE:
                return accumulated
            if delta is None:
                continue
            if isinstance(delta, dict):
                await updater.update_status(
                    TaskState.TASK_STATE_WORKING,
                    self._new_tool_event_message(updater, delta),
                )
                continue

            text = str(delta)
            if not text:
                continue
            accumulated += text
            await updater.update_status(
                TaskState.TASK_STATE_WORKING,
                updater.new_agent_message([text_to_message(accumulated).parts[0]]),
            )

    async def _finish_stream_consumer(
        self,
        loop: asyncio.AbstractEventLoop,
        delta_queue: asyncio.Queue[object] | None,
        stream_task: asyncio.Task[str] | None,
    ) -> str:
        if delta_queue is None or stream_task is None:
            return ""
        loop.call_soon_threadsafe(delta_queue.put_nowait, self._STREAM_DONE)
        return await stream_task

    def _run_agent_conversation(
        self,
        agent: object,
        user_input: str,
        history: list[dict[str, str]],
        task_id: str,
        stream_callback,
        tool_start_callback=None,
        tool_complete_callback=None,
    ) -> dict[str, object]:
        kwargs: dict[str, object] = {}
        if stream_callback is not None:
            kwargs["stream_callback"] = stream_callback
        old_tool_start = getattr(agent, "tool_start_callback", self._CALLBACK_MISSING)
        old_tool_complete = getattr(agent, "tool_complete_callback", self._CALLBACK_MISSING)
        try:
            if tool_start_callback is not None:
                setattr(agent, "tool_start_callback", tool_start_callback)
            if tool_complete_callback is not None:
                setattr(agent, "tool_complete_callback", tool_complete_callback)
            return agent.run_conversation(
                user_input,
                None,
                history,
                task_id,
                **kwargs,
            )
        finally:
            if old_tool_start is self._CALLBACK_MISSING:
                try:
                    delattr(agent, "tool_start_callback")
                except Exception:
                    pass
            else:
                setattr(agent, "tool_start_callback", old_tool_start)
            if old_tool_complete is self._CALLBACK_MISSING:
                try:
                    delattr(agent, "tool_complete_callback")
                except Exception:
                    pass
            else:
                setattr(agent, "tool_complete_callback", old_tool_complete)
