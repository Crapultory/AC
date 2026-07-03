"""
Tests for Slack foreground delegate routing.

These tests are self-contained on purpose so they do not rely on fixtures from
``tests/gateway/test_slack.py``.
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from gateway.config import PlatformConfig
from gateway.platforms.base import SendResult
from tools.a2a_delegate_tool import _a2a_completed_state, a2a_delegate


def _ensure_slack_mock() -> None:
    """Install mock slack modules so SlackAdapter can be imported."""
    if "slack_bolt" in sys.modules and hasattr(sys.modules["slack_bolt"], "__file__"):
        return

    slack_bolt = MagicMock()
    slack_bolt.async_app.AsyncApp = MagicMock
    slack_bolt.adapter.socket_mode.async_handler.AsyncSocketModeHandler = MagicMock

    slack_sdk = MagicMock()
    slack_sdk.web.async_client.AsyncWebClient = MagicMock

    for name, mod in [
        ("slack_bolt", slack_bolt),
        ("slack_bolt.async_app", slack_bolt.async_app),
        ("slack_bolt.adapter", slack_bolt.adapter),
        ("slack_bolt.adapter.socket_mode", slack_bolt.adapter.socket_mode),
        ("slack_bolt.adapter.socket_mode.async_handler", slack_bolt.adapter.socket_mode.async_handler),
        ("slack_sdk", slack_sdk),
        ("slack_sdk.web", slack_sdk.web),
        ("slack_sdk.web.async_client", slack_sdk.web.async_client),
    ]:
        sys.modules.setdefault(name, mod)

    sys.modules.setdefault("aiohttp", MagicMock())


_ensure_slack_mock()

import gateway.platforms.slack as _slack_mod

_slack_mod.SLACK_AVAILABLE = True

from gateway.platforms.slack import SlackAdapter  # noqa: E402


@pytest.fixture()
def adapter():
    config = PlatformConfig(enabled=True, token="xoxb-fake-token")
    slack_adapter = SlackAdapter(config)
    slack_adapter._app = MagicMock()
    slack_adapter._app.client = AsyncMock()
    slack_adapter._bot_user_id = "U_BOT"
    slack_adapter._running = True
    slack_adapter.handle_message = AsyncMock()
    slack_adapter.send = AsyncMock(return_value=SendResult(success=True, message_id="msg-1"))
    slack_adapter.edit_message = AsyncMock(return_value=SendResult(success=True, message_id="msg-1"))
    slack_adapter._resolve_user_name = AsyncMock(return_value="testuser")
    slack_adapter._fetch_thread_context = AsyncMock(return_value="")
    slack_adapter._fetch_thread_parent_text = AsyncMock(return_value=None)
    return slack_adapter


def _make_event(
    text: str,
    *,
    channel: str = "D123",
    channel_type: str = "im",
    ts: str = "1717171717.000001",
    thread_ts: str | None = None,
    user: str = "U_USER",
) -> dict:
    event = {
        "text": text,
        "user": user,
        "channel": channel,
        "channel_type": channel_type,
        "ts": ts,
    }
    if thread_ts is not None:
        event["thread_ts"] = thread_ts
    return event


def _make_mock_parent_agent():
    parent = MagicMock()
    parent.base_url = "https://openrouter.ai/api/v1"
    parent.api_key = "***"
    parent.provider = "openrouter"
    parent.api_mode = "chat_completions"
    parent.model = "anthropic/claude-sonnet-4"
    parent.platform = "slack"
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


async def _wait_for_route(adapter, *, channel_id: str, thread_ts: str, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if adapter._get_delegate_route(channel_id=channel_id, thread_ts=thread_ts) is not None:
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"delegate route did not activate for {channel_id}/{thread_ts}")


class TestSlackDelegateForegroundRouteState:
    @pytest.mark.asyncio
    async def test_edit_message_marks_network_errors_retryable(self):
        config = PlatformConfig(enabled=True, token="xoxb-fake-token")
        slack_adapter = SlackAdapter(config)
        slack_adapter._app = MagicMock()
        slack_adapter._app.client = AsyncMock()
        slack_adapter._app.client.chat_update = AsyncMock(
            side_effect=RuntimeError("ConnectError: network down")
        )

        result = await slack_adapter.edit_message(
            chat_id="C456",
            message_id="msg-1",
            content="updated",
        )

        assert result.success is False
        assert result.retryable is True

    @pytest.mark.asyncio
    async def test_edit_message_marks_rate_limit_errors_retryable(self):
        class _SlackRateLimitError(Exception):
            response = {"status_code": 429, "error": "ratelimited"}

        config = PlatformConfig(enabled=True, token="xoxb-fake-token")
        slack_adapter = SlackAdapter(config)
        slack_adapter._app = MagicMock()
        slack_adapter._app.client = AsyncMock()
        slack_adapter._app.client.chat_update = AsyncMock(
            side_effect=_SlackRateLimitError("ratelimited")
        )

        result = await slack_adapter.edit_message(
            chat_id="C456",
            message_id="msg-1",
            content="updated",
        )

        assert result.success is False
        assert result.retryable is True

    def test_delegate_input_enter_and_exit_updates_thread_route(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.000100",
        )
        input_adapter = runtime["input_factory"]()

        assert adapter._get_delegate_route(
            channel_id="D123",
            thread_ts="1717171717.000100",
        ) is None

        assert input_adapter.enter_foreground() is True

        route = adapter._get_delegate_route(
            channel_id="D123",
            thread_ts="1717171717.000100",
        )
        assert route is not None
        assert route.channel_id == "D123"
        assert route.thread_ts == "1717171717.000100"
        assert route.input_adapter is input_adapter

        input_adapter.exit_foreground()

        assert adapter._get_delegate_route(
            channel_id="D123",
            thread_ts="1717171717.000100",
        ) is None

    def test_delegate_input_round_trips_pushed_lines_and_close_returns_none(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.000200",
        )
        input_adapter = runtime["input_factory"]()

        assert input_adapter.enter_foreground() is True
        assert input_adapter.push_line("follow up") is True
        assert input_adapter.read_line() == "follow up"

        input_adapter.close()

        assert input_adapter.read_line() is None

        input_adapter.exit_foreground()

    def test_delegate_input_timeout_returns_none_without_input(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.000250",
        )
        input_adapter = runtime["input_factory"]()

        assert input_adapter.enter_foreground() is True
        assert input_adapter.read_line(timeout=0.001) is None
        input_adapter.exit_foreground()

    def test_delegate_input_timeout_returns_pushed_line(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.000260",
        )
        input_adapter = runtime["input_factory"]()

        assert input_adapter.enter_foreground() is True
        assert input_adapter.push_line("follow up") is True
        assert input_adapter.read_line(timeout=0.001) == "follow up"
        input_adapter.exit_foreground()

    def test_delegate_input_timeout_returns_none_after_close(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.000270",
        )
        input_adapter = runtime["input_factory"]()

        assert input_adapter.enter_foreground() is True
        input_adapter.close()
        assert input_adapter.read_line(timeout=0.001) is None
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_output_emit_targets_same_slack_thread(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000300",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit(
            "delegate",
            "status",
            "entered foreground loop",
            session_id="delegate-session-1",
        )
        await asyncio.sleep(0)

        route = adapter._get_delegate_route(
            channel_id="C456",
            thread_ts="1717171717.000300",
        )
        assert route is not None
        assert route.session_id == "delegate-session-1"
        adapter.send.assert_awaited_once()
        assert adapter.send.await_args.kwargs["chat_id"] == "C456"
        assert adapter.send.await_args.kwargs["metadata"] == {
            "thread_id": "1717171717.000300",
        }
        assert "entered foreground loop" in adapter.send.await_args.kwargs["content"]
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_ai_output_is_filtered_from_slack_send(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit(
            "delegate",
            "ai",
            "child final answer",
            session_id="delegate-session-2",
        )
        await asyncio.sleep(0)

        route = adapter._get_delegate_route(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        assert route is not None
        assert route.session_id == "delegate-session-2"
        adapter.send.assert_not_called()
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_ai_delta_output_reuses_normal_slack_send(self, adapter):
        adapter._delegate_stream_edit_interval = 0.01
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit(
            "delegate",
            "ai_delta",
            "partial chunk",
            session_id="delegate-session-delta",
        )
        await asyncio.sleep(0)

        route = adapter._get_delegate_route(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        assert route is not None
        assert route.session_id == "delegate-session-delta"
        adapter.send.assert_awaited_once()
        assert adapter.send.await_args.kwargs["chat_id"] == "C456"
        assert adapter.send.await_args.kwargs["metadata"] == {
            "thread_id": "1717171717.000301",
        }
        assert adapter.send.await_args.kwargs["content"] == "partial chunk"
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_ai_delta_subsequent_chunks_edit_existing_message(self, adapter):
        adapter._delegate_stream_edit_interval = 0.01
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit(
            "delegate",
            "ai_delta",
            "partial",
            session_id="delegate-session-delta",
        )
        await asyncio.sleep(0)
        runtime["output"].emit(
            "delegate",
            "ai_delta",
            " chunk",
            session_id="delegate-session-delta",
        )
        await asyncio.sleep(0.05)

        adapter.send.assert_awaited_once()
        adapter.edit_message.assert_awaited_once()
        assert adapter.edit_message.await_args.kwargs["chat_id"] == "C456"
        assert adapter.edit_message.await_args.kwargs["message_id"] == "msg-1"
        assert adapter.edit_message.await_args.kwargs["content"] == "partial chunk"
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_ai_delta_rolls_over_when_message_exceeds_limit(self, adapter):
        adapter._delegate_stream_edit_interval = 0.01
        adapter.MAX_MESSAGE_LENGTH = 10
        send_ids = iter(["msg-1", "msg-2"])
        adapter.send = AsyncMock(
            side_effect=lambda *args, **kwargs: SendResult(
                success=True,
                message_id=next(send_ids),
            )
        )
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit(
            "delegate",
            "ai_delta",
            "12345",
            session_id="delegate-session-delta",
        )
        await asyncio.sleep(0)
        runtime["output"].emit(
            "delegate",
            "ai_delta",
            "67890abc",
            session_id="delegate-session-delta",
        )
        await asyncio.sleep(0.05)

        assert adapter.send.await_count == 2
        assert adapter.send.await_args_list[0].kwargs["content"] == "12345"
        assert adapter.edit_message.await_args.kwargs["content"] == "1234567890"
        assert adapter.send.await_args_list[1].kwargs["content"] == "abc"
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_ai_delta_edits_newest_message_after_rollover(self, adapter):
        adapter._delegate_stream_edit_interval = 0.01
        adapter.MAX_MESSAGE_LENGTH = 10
        send_ids = iter(["msg-1", "msg-2"])
        adapter.send = AsyncMock(
            side_effect=lambda *args, **kwargs: SendResult(
                success=True,
                message_id=next(send_ids),
            )
        )
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit("delegate", "ai_delta", "12345", session_id="delegate-session-delta")
        await asyncio.sleep(0)
        runtime["output"].emit("delegate", "ai_delta", "67890abc", session_id="delegate-session-delta")
        await asyncio.sleep(0.05)
        runtime["output"].emit("delegate", "ai_delta", "def", session_id="delegate-session-delta")
        await asyncio.sleep(0.05)

        assert adapter.send.await_count == 2
        assert adapter.edit_message.await_args_list[-1].kwargs["message_id"] == "msg-2"
        assert adapter.edit_message.await_args_list[-1].kwargs["content"] == "abcdef"
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_foreground_user_message_starts_new_ai_delta_message(self, adapter):
        adapter._delegate_stream_edit_interval = 0.01
        send_ids = iter(["msg-1", "msg-2"])
        adapter.send = AsyncMock(
            side_effect=lambda *args, **kwargs: SendResult(
                success=True,
                message_id=next(send_ids),
            )
        )
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.000301",
            user_id="U_USER",
            chat_type="dm",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit("delegate", "ai_delta", "first", session_id="delegate-session-delta")
        await asyncio.sleep(0)
        runtime["output"].emit("delegate", "ai_delta", " answer", session_id="delegate-session-delta")
        await asyncio.sleep(0.05)

        assert adapter.send.await_count == 1
        assert adapter.edit_message.await_args.kwargs["content"] == "first answer"

        adapter.send.reset_mock()
        adapter.edit_message.reset_mock()
        await adapter._handle_slack_message(
            _make_event(
                "new task",
                channel="D123",
                channel_type="im",
                ts="1717171717.000302",
                thread_ts="1717171717.000301",
                user="U_USER",
            )
        )
        assert input_adapter.read_line() == "new task"

        runtime["output"].emit("delegate", "ai_delta", "second", session_id="delegate-session-delta")
        await asyncio.sleep(0)

        adapter.send.assert_awaited_once()
        adapter.edit_message.assert_not_called()
        assert adapter.send.await_args.kwargs["content"] == "second"
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_ai_delta_clears_stream_state_when_route_released(self, adapter):
        adapter._delegate_stream_edit_interval = 0.01
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit(
            "delegate",
            "ai_delta",
            "hello",
            session_id="delegate-session-delta",
        )
        await asyncio.sleep(0)
        input_adapter.exit_foreground()
        adapter.send.reset_mock()
        adapter.edit_message.reset_mock()

        second_runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        second_input_adapter = second_runtime["input_factory"]()
        assert second_input_adapter.enter_foreground() is True

        second_runtime["output"].emit(
            "delegate",
            "ai_delta",
            "world",
            session_id="delegate-session-delta-2",
        )
        await asyncio.sleep(0)

        adapter.send.assert_awaited_once()
        adapter.edit_message.assert_not_called()
        assert adapter.send.await_args.kwargs["content"] == "world"
        second_input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_ai_delta_batches_after_nonretryable_edit_failure(self, adapter):
        adapter._delegate_stream_edit_interval = 0.05
        adapter._delegate_stream_buffer_threshold = 100
        adapter.edit_message = AsyncMock(
            return_value=SendResult(success=False, error="edit failed")
        )
        send_ids = iter(["msg-1", "msg-2", "msg-3"])
        adapter.send = AsyncMock(
            side_effect=lambda *args, **kwargs: SendResult(
                success=True,
                message_id=next(send_ids),
            )
        )
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit("delegate", "ai_delta", "a", session_id="delegate-session-delta")
        await asyncio.sleep(0)
        runtime["output"].emit("delegate", "ai_delta", "b", session_id="delegate-session-delta")
        await asyncio.sleep(0.06)

        assert adapter.send.await_count == 2
        adapter.edit_message.assert_awaited_once()
        assert adapter.send.await_args_list[1].kwargs["content"] == "b"

        runtime["output"].emit("delegate", "ai_delta", "c", session_id="delegate-session-delta")
        await asyncio.sleep(0)
        runtime["output"].emit("delegate", "ai_delta", "d", session_id="delegate-session-delta")
        await asyncio.sleep(0.01)

        assert adapter.send.await_count == 2

        await asyncio.sleep(0.06)

        assert adapter.send.await_count == 3
        assert adapter.send.await_args_list[2].kwargs["content"] == "cd"
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_ai_final_flushes_pending_delta_without_duplicate_final(self, adapter):
        adapter._delegate_stream_edit_interval = 1.0
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit("delegate", "ai_delta", "hello", session_id="delegate-session-delta")
        await asyncio.sleep(0)
        runtime["output"].emit("delegate", "ai_delta", " there", session_id="delegate-session-delta")
        await asyncio.sleep(0)
        runtime["output"].emit("delegate", "ai", "hello there", session_id="delegate-session-delta")
        await asyncio.sleep(0)

        adapter.send.assert_awaited_once()
        adapter.edit_message.assert_awaited_once()
        assert adapter.edit_message.await_args.kwargs["content"] == "hello there"
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_ai_delta_retryable_edit_failure_keeps_aggregated_state(self, adapter):
        adapter._delegate_stream_edit_interval = 0.01
        adapter.edit_message = AsyncMock(
            side_effect=[
                SendResult(success=False, error="temporary", retryable=True),
                SendResult(success=True, message_id="msg-1"),
            ]
        )
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000301",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit("delegate", "ai_delta", "a", session_id="delegate-session-delta")
        await asyncio.sleep(0)
        runtime["output"].emit("delegate", "ai_delta", "b", session_id="delegate-session-delta")
        await asyncio.sleep(0.05)
        runtime["output"].emit("delegate", "ai_delta", "c", session_id="delegate-session-delta")
        await asyncio.sleep(0.05)

        adapter.send.assert_awaited_once()
        assert adapter.edit_message.await_count == 2
        assert adapter.edit_message.await_args_list[-1].kwargs["content"] == "abc"
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_tool_call_starts_a_new_ai_delta_message_segment(self, adapter):
        adapter._delegate_stream_edit_interval = 1.0
        send_ids = iter(["msg-1", "tool-msg", "msg-2"])
        adapter.send = AsyncMock(
            side_effect=lambda *args, **kwargs: SendResult(
                success=True,
                message_id=next(send_ids),
            )
        )
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000302",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit("delegate", "ai_delta", "hello", session_id="delegate-session-3")
        await asyncio.sleep(0)
        runtime["output"].emit("delegate", "ai_delta", " there", session_id="delegate-session-3")
        await asyncio.sleep(0)
        runtime["output"].emit(
            "delegate",
            "tool_call",
            'web_search {"q":"cats"}',
            session_id="delegate-session-3",
        )
        await asyncio.sleep(0)
        runtime["output"].emit("delegate", "ai_delta", "world", session_id="delegate-session-3")
        await asyncio.sleep(0)

        assert adapter.send.await_count == 3
        assert adapter.send.await_args_list[0].kwargs["content"] == "hello"
        assert adapter.edit_message.await_args.kwargs["content"] == "hello there"
        assert "web_search" in adapter.send.await_args_list[1].kwargs["content"]
        assert adapter.send.await_args_list[2].kwargs["content"] == "world"
        input_adapter.exit_foreground()

    @pytest.mark.asyncio
    async def test_delegate_tool_call_output_uses_tool_progress_style(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000302",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit(
            "delegate",
            "tool_call",
            'web_search {"q":"cats"}',
            session_id="delegate-session-3",
        )
        await asyncio.sleep(0)

        adapter.send.assert_awaited_once()
        assert adapter.send.await_args.kwargs["chat_id"] == "C456"
        assert adapter.send.await_args.kwargs["metadata"] == {
            "thread_id": "1717171717.000302",
        }
        content = adapter.send.await_args.kwargs["content"]
        assert "delegate-session-3" not in content
        assert "delegate.tool_call" not in content
        assert "web_search" in content
        assert "cats" in content
        input_adapter.exit_foreground()


class TestSlackDelegateForegroundInterception:
    @pytest.mark.asyncio
    async def test_foreground_delegate_thread_message_is_pushed_and_skips_main_pipeline(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.100000",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        await adapter._handle_slack_message(
            _make_event(
                "follow up from Slack",
                ts="1717171717.100001",
                thread_ts="1717171717.100000",
            )
        )

        assert input_adapter.read_line() == "follow up from Slack"
        adapter.handle_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_delegate_commands_are_forwarded_to_delegate_while_foreground(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.200000",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        await adapter._handle_slack_message(
            _make_event(
                "!main",
                ts="1717171717.200001",
                thread_ts="1717171717.200000",
            )
        )
        await adapter._handle_slack_message(
            _make_event(
                "!exit",
                ts="1717171717.200002",
                thread_ts="1717171717.200000",
            )
        )
        await adapter._handle_slack_message(
            _make_event(
                "/new",
                ts="1717171717.200003",
                thread_ts="1717171717.200000",
            )
        )

        assert input_adapter.read_line() == "/main"
        assert input_adapter.read_line() == "/exit"
        assert input_adapter.read_line() == "/new"
        adapter.handle_message.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("raw_text", "expected_text"),
        [
            ("/main", "/main"),
            ("!exit", "/exit"),
        ],
    )
    async def test_delegate_return_commands_ignore_slack_thread_enrichment(
        self,
        adapter,
        raw_text,
        expected_text,
    ):
        adapter._fetch_thread_context = AsyncMock(
            return_value=(
                "[Thread context — prior messages in this thread (not yet in conversation history):]\n"
                "[thread parent] testuser: /restart\n"
                "testuser: 当前有哪些工具可用\n"
                "[End of thread context]\n\n"
            )
        )
        adapter._fetch_thread_parent_text = AsyncMock(return_value="/restart")
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.250000",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        await adapter._handle_slack_message(
            _make_event(
                raw_text,
                ts="1717171717.250001",
                thread_ts="1717171717.250000",
            )
        )

        assert input_adapter.read_line() == expected_text
        adapter.handle_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_failed_delegate_push_releases_route_and_falls_back_to_main(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.300000",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True
        input_adapter.close()

        await adapter._handle_slack_message(
            _make_event(
                "route this through main",
                ts="1717171717.300001",
                thread_ts="1717171717.300000",
            )
        )

        assert adapter._get_delegate_route(
            channel_id="D123",
            thread_ts="1717171717.300000",
        ) is None
        adapter.handle_message.assert_awaited_once()
        msg_event = adapter.handle_message.await_args.args[0]
        assert msg_event.text == "route this through main"

    @pytest.mark.asyncio
    async def test_legacy_dm_top_level_foreground_stays_top_level_without_synthetic_thread(self, adapter):
        adapter.config.extra["dm_top_level_threads_as_sessions"] = False
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts=None,
            chat_type="dm",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        runtime["output"].emit(
            "delegate",
            "status",
            "legacy dm foreground",
            session_id="legacy-dm-session",
        )
        await asyncio.sleep(0)

        assert adapter.send.await_args.kwargs["metadata"] is None
        adapter.send.reset_mock()

        await adapter._handle_slack_message(
            _make_event(
                "follow up in legacy dm",
                ts="1717171717.310001",
                thread_ts=None,
            )
        )

        assert input_adapter.read_line() == "follow up in legacy dm"
        route = adapter._get_delegate_route(
            channel_id="D123",
            thread_ts=None,
            chat_type="dm",
        )
        assert route is not None
        assert route.thread_ts is None

    @pytest.mark.asyncio
    async def test_foreground_delegate_respects_thread_per_user_isolation(self, adapter):
        store = MagicMock()
        store._entries = {}
        store._ensure_loaded = MagicMock()
        store.config = SimpleNamespace(
            group_sessions_per_user=True,
            thread_sessions_per_user=True,
        )
        adapter.set_session_store(store)

        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C123",
            thread_ts="1717171717.320000",
            user_id="U_OWNER",
            chat_type="group",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        await adapter._handle_slack_message(
            _make_event(
                "wrong user should not enter delegate",
                channel="C123",
                channel_type="channel",
                ts="1717171717.320001",
                thread_ts="1717171717.320000",
                user="U_OTHER",
            )
        )
        await adapter._handle_slack_message(
            _make_event(
                "owner reaches delegate",
                channel="C123",
                channel_type="channel",
                ts="1717171717.320002",
                thread_ts="1717171717.320000",
                user="U_OWNER",
            )
        )

        assert input_adapter.read_line() == "owner reaches delegate"
        adapter.handle_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_foreground_delegate_receives_enriched_slack_text(self, adapter):
        adapter._fetch_thread_parent_text = AsyncMock(return_value="Earlier parent message")
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.330000",
            chat_type="dm",
        )
        input_adapter = runtime["input_factory"]()
        assert input_adapter.enter_foreground() is True

        event = _make_event(
            "Hello from Slack",
            ts="1717171717.330001",
            thread_ts="1717171717.330000",
        )
        event["blocks"] = [
            {
                "type": "rich_text",
                "elements": [
                    {
                        "type": "rich_text_quote",
                        "elements": [
                            {
                                "type": "rich_text_section",
                                "elements": [{"type": "text", "text": "Quoted block text"}],
                            }
                        ],
                    }
                ],
            }
        ]
        event["attachments"] = [
            {
                "title": "Unfurled preview",
                "title_link": "https://example.com/article",
                "text": "Attachment body text",
            }
        ]

        await adapter._handle_slack_message(event)

        delegated_text = input_adapter.read_line()
        assert delegated_text != "Hello from Slack"
        assert 'Replying to: "Earlier parent message"' in delegated_text
        assert "Quoted block text" in delegated_text
        assert "Unfurled preview" in delegated_text
        assert "Attachment body text" in delegated_text


class TestSlackDelegateForegroundLoopRelease:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("agent_mode", ["local", "a2a"])
    @pytest.mark.parametrize("return_command", ["/main", "/exit"])
    async def test_return_commands_release_foreground_route_through_delegate_loop(
        self,
        adapter,
        agent_mode,
        return_command,
    ):
        parent = _make_mock_parent_agent()
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="D123",
            thread_ts="1717171717.400000",
        )
        input_adapter = runtime["input_factory"]()
        result_box = {}

        def _run_local_delegate() -> None:
            child = MagicMock()
            child.session_id = "delegate-local-session"
            child.run_conversation.return_value = {
                "final_response": "local start",
                "completed": True,
                "api_calls": 1,
            }
            with patch("run_agent.AIAgent", return_value=child):
                result_box["payload"] = json.loads(
                    a2a_delegate(
                        goal="start local delegate",
                        type="local",
                        is_loop=True,
                        input=input_adapter,
                        output=runtime["output"],
                        parent_agent=parent,
                    )
                )

        def _run_a2a_delegate() -> None:
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
                    self.context_id = session_id

                async def send_turn(self, text: str, *, is_delegate_output: bool = True):
                    del text, is_delegate_output
                    return {
                        "final_response": "remote start",
                        "state": _a2a_completed_state(),
                        "state_name": "completed",
                    }

                async def close(self):
                    return None

            with patch(
                "tools.a2a_delegate_tool._resolve_a2a_entry",
                return_value=(
                    {
                        "available": True,
                        "url": "https://example.invalid/a2a",
                        "agent_card_name": "remote",
                    },
                    None,
                ),
            ), patch(
                "tools.a2a_delegate_tool._A2ADelegateSession",
                _FakeSession,
            ):
                result_box["payload"] = json.loads(
                    a2a_delegate(
                        goal="start remote delegate",
                        type="a2a",
                        agent_name="remote",
                        is_loop=True,
                        input=input_adapter,
                        output=runtime["output"],
                        parent_agent=parent,
                    )
                )

        worker = threading.Thread(
            target=_run_local_delegate if agent_mode == "local" else _run_a2a_delegate,
            daemon=True,
        )
        worker.start()

        await _wait_for_route(
            adapter,
            channel_id="D123",
            thread_ts="1717171717.400000",
        )

        await adapter._handle_slack_message(
            _make_event(
                return_command,
                ts="1717171717.400001",
                thread_ts="1717171717.400000",
            )
        )

        worker.join(timeout=5)
        assert not worker.is_alive()

        payload = result_box["payload"]
        assert payload["loop_exit_reason"] == "main_command"
        assert adapter._get_delegate_route(
            channel_id="D123",
            thread_ts="1717171717.400000",
        ) is None

        adapter.handle_message.reset_mock()
        await adapter._handle_slack_message(
            _make_event(
                "back to main",
                ts="1717171717.400002",
                thread_ts="1717171717.400000",
            )
        )
        adapter.handle_message.assert_awaited_once()
