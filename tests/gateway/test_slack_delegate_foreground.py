"""
Tests for Slack foreground delegate routing.

These tests are self-contained on purpose so they do not rely on fixtures from
``tests/gateway/test_slack.py``.
"""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

from gateway.config import PlatformConfig
from gateway.platforms.base import SendResult


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
    return slack_adapter


class TestSlackDelegateForegroundRouteState:
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

    @pytest.mark.asyncio
    async def test_delegate_output_emit_targets_same_slack_thread(self, adapter):
        runtime = adapter.build_delegate_foreground_runtime(
            channel_id="C456",
            thread_ts="1717171717.000300",
        )

        runtime["output"].emit(
            "delegate",
            "status",
            "entered foreground loop",
            session_id="delegate-session-1",
        )
        await asyncio.sleep(0)

        adapter.send.assert_awaited_once()
        assert adapter.send.await_args.kwargs["chat_id"] == "C456"
        assert adapter.send.await_args.kwargs["metadata"] == {
            "thread_id": "1717171717.000300",
        }
        assert "entered foreground loop" in adapter.send.await_args.kwargs["content"]
