"""Tests for Slack Block Kit clarify buttons."""

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_repo = str(Path(__file__).resolve().parents[2])
if _repo not in sys.path:
    sys.path.insert(0, _repo)


def _ensure_slack_mock():
    if "slack_bolt" in sys.modules:
        return
    slack_bolt = MagicMock()
    slack_bolt.async_app.AsyncApp = MagicMock
    sys.modules["slack_bolt"] = slack_bolt
    sys.modules["slack_bolt.async_app"] = slack_bolt.async_app
    handler_mod = MagicMock()
    handler_mod.AsyncSocketModeHandler = MagicMock
    sys.modules["slack_bolt.adapter"] = MagicMock()
    sys.modules["slack_bolt.adapter.socket_mode"] = MagicMock()
    sys.modules["slack_bolt.adapter.socket_mode.async_handler"] = handler_mod
    sdk_mod = MagicMock()
    sdk_mod.web = MagicMock()
    sdk_mod.web.async_client = MagicMock()
    sdk_mod.web.async_client.AsyncWebClient = MagicMock
    sys.modules["slack_sdk"] = sdk_mod
    sys.modules["slack_sdk.web"] = sdk_mod.web
    sys.modules["slack_sdk.web.async_client"] = sdk_mod.web.async_client


_ensure_slack_mock()

import plugins.platforms.slack.adapter as _slack_mod
from gateway.config import PlatformConfig
from plugins.platforms.slack.adapter import SlackAdapter


def _make_adapter():
    adapter = SlackAdapter(PlatformConfig(enabled=True, token="xoxb-test-token"))
    adapter._app = MagicMock()
    adapter._bot_user_id = "U_BOT"
    adapter._team_clients = {"T1": AsyncMock()}
    adapter._team_bot_user_ids = {"T1": "U_BOT"}
    adapter._channel_team = {"C1": "T1"}
    return adapter


class _AuthRunner:
    def __init__(self, authorized=True):
        self.authorized = authorized

    async def handle(self, event):
        return None

    def _is_user_authorized(self, source):
        return self.authorized and source.user_id == "U_OWNER"


def _attach_auth_runner(adapter, *, authorized=True):
    runner = _AuthRunner(authorized=authorized)
    adapter.set_message_handler(runner.handle)
    return runner


@pytest.mark.asyncio
async def test_send_clarify_multi_choice_renders_blocks_and_other_button():
    adapter = _make_adapter()
    mock_client = adapter._team_clients["T1"]
    mock_client.chat_postMessage = AsyncMock(return_value={"ts": "1234.5678"})

    result = await adapter.send_clarify(
        chat_id="C1",
        question="Pick one?",
        choices=["alpha", "beta"],
        clarify_id="cid1",
        session_key="agent:main:slack:group:C1:1111",
    )

    assert result.success is True
    assert result.message_id == "1234.5678"
    assert adapter._clarify_choices["cid1"] == ["alpha", "beta"]

    kwargs = mock_client.chat_postMessage.call_args.kwargs
    assert kwargs["channel"] == "C1"
    assert "Pick one?" in kwargs["text"]
    blocks = kwargs["blocks"]
    assert blocks[0]["type"] == "section"
    assert "Pick one?" in blocks[0]["text"]["text"]
    elements = blocks[1]["elements"]
    assert [element["action_id"] for element in elements] == [
        "hermes_clarify_0",
        "hermes_clarify_1",
        "hermes_clarify_other",
    ]
    assert '"clarify_id": "cid1"' in elements[0]["value"]
    assert '"index": 0' in elements[0]["value"]
    assert elements[-1]["text"]["text"] == "Other (type answer)"


@pytest.mark.asyncio
async def test_send_clarify_sets_thread_ts_from_metadata():
    adapter = _make_adapter()
    mock_client = adapter._team_clients["T1"]
    mock_client.chat_postMessage = AsyncMock(return_value={"ts": "1234.5678"})

    await adapter.send_clarify(
        chat_id="C1",
        question="Pick one?",
        choices=["alpha"],
        clarify_id="cid-thread",
        session_key="session",
        metadata={"thread_id": "9999.0000"},
    )

    assert mock_client.chat_postMessage.call_args.kwargs["thread_ts"] == "9999.0000"


@pytest.mark.asyncio
async def test_send_clarify_open_ended_uses_base_text_fallback(monkeypatch):
    adapter = _make_adapter()
    adapter.send = AsyncMock()
    adapter.send.return_value = MagicMock(success=True, message_id="msg-open")

    result = await adapter.send_clarify(
        chat_id="C1",
        question="What should I use?",
        choices=None,
        clarify_id="cid-open",
        session_key="session",
        metadata={"thread_id": "1111.2222"},
    )

    assert result.success is True
    adapter.send.assert_awaited_once()
    kwargs = adapter.send.await_args.kwargs
    assert kwargs["chat_id"] == "C1"
    assert "What should I use?" in kwargs["content"]
    assert kwargs["metadata"] == {"thread_id": "1111.2222"}


@pytest.mark.asyncio
async def test_send_clarify_not_connected_returns_failure():
    adapter = _make_adapter()
    adapter._app = None

    result = await adapter.send_clarify(
        chat_id="C1",
        question="Pick one?",
        choices=["alpha"],
        clarify_id="cid-offline",
        session_key="session",
    )

    assert result.success is False
    assert "Not connected" in (result.error or "")


@pytest.mark.asyncio
async def test_handle_clarify_choice_resolves_selected_text_and_updates_card():
    adapter = _make_adapter()
    _attach_auth_runner(adapter)
    adapter._clarify_choices["cid1"] = ["alpha", "beta"]
    mock_client = adapter._team_clients["T1"]
    mock_client.chat_update = AsyncMock()
    ack = AsyncMock()
    body = {
        "message": {
            "ts": "1234.5678",
            "blocks": [
                {"type": "section", "text": {"type": "mrkdwn", "text": "Pick one?"}},
            ],
        },
        "channel": {"id": "C1"},
        "user": {"name": "owner", "id": "U_OWNER"},
    }
    action = {
        "action_id": "hermes_clarify_1",
        "value": '{"clarify_id": "cid1", "index": 1}',
    }

    with patch("tools.clarify_gateway.resolve_gateway_clarify", return_value=True) as mock_resolve:
        await adapter._handle_clarify_action(ack, body, action)

    ack.assert_awaited_once()
    mock_resolve.assert_called_once_with("cid1", "beta")
    assert "cid1" not in adapter._clarify_choices
    mock_client.chat_update.assert_awaited_once()
    update_kwargs = mock_client.chat_update.await_args.kwargs
    assert update_kwargs["channel"] == "C1"
    assert update_kwargs["ts"] == "1234.5678"
    assert "selected beta by owner" in update_kwargs["text"]


@pytest.mark.asyncio
async def test_handle_clarify_other_marks_awaiting_text_and_updates_card():
    adapter = _make_adapter()
    _attach_auth_runner(adapter)
    adapter._clarify_choices["cid-other"] = ["alpha"]
    mock_client = adapter._team_clients["T1"]
    mock_client.chat_update = AsyncMock()
    ack = AsyncMock()
    body = {
        "message": {"ts": "1234.5678"},
        "channel": {"id": "C1"},
        "user": {"name": "owner", "id": "U_OWNER"},
    }
    action = {
        "action_id": "hermes_clarify_other",
        "value": '{"clarify_id": "cid-other", "index": "other"}',
    }

    with patch("tools.clarify_gateway.mark_awaiting_text", return_value=True) as mock_mark:
        await adapter._handle_clarify_action(ack, body, action)

    ack.assert_awaited_once()
    mock_mark.assert_called_once_with("cid-other")
    assert adapter._clarify_choices["cid-other"] == ["alpha"]
    update_kwargs = mock_client.chat_update.await_args.kwargs
    assert "waiting for typed answer from owner" in update_kwargs["text"]


@pytest.mark.asyncio
async def test_handle_clarify_rejects_unauthorized_click():
    adapter = _make_adapter()
    _attach_auth_runner(adapter, authorized=False)
    adapter._clarify_choices["cid1"] = ["alpha"]
    mock_client = adapter._team_clients["T1"]
    mock_client.chat_update = AsyncMock()
    ack = AsyncMock()
    body = {
        "message": {"ts": "1234.5678"},
        "channel": {"id": "C1"},
        "user": {"name": "intruder", "id": "U_INTRUDER"},
    }
    action = {
        "action_id": "hermes_clarify_0",
        "value": '{"clarify_id": "cid1", "index": 0}',
    }

    with patch("tools.clarify_gateway.resolve_gateway_clarify") as mock_resolve, \
         patch("tools.clarify_gateway.mark_awaiting_text") as mock_mark:
        await adapter._handle_clarify_action(ack, body, action)

    ack.assert_awaited_once()
    mock_resolve.assert_not_called()
    mock_mark.assert_not_called()
    mock_client.chat_update.assert_not_called()


@pytest.mark.asyncio
async def test_handle_clarify_malformed_value_does_not_resolve_or_update():
    adapter = _make_adapter()
    _attach_auth_runner(adapter)
    mock_client = adapter._team_clients["T1"]
    mock_client.chat_update = AsyncMock()
    ack = AsyncMock()
    body = {
        "message": {"ts": "1234.5678"},
        "channel": {"id": "C1"},
        "user": {"name": "owner", "id": "U_OWNER"},
    }
    action = {"action_id": "hermes_clarify_0", "value": "not-json"}

    with patch("tools.clarify_gateway.resolve_gateway_clarify") as mock_resolve:
        await adapter._handle_clarify_action(ack, body, action)

    ack.assert_awaited_once()
    mock_resolve.assert_not_called()
    mock_client.chat_update.assert_not_called()


@pytest.mark.asyncio
async def test_handle_clarify_out_of_range_index_falls_back_to_index_string():
    adapter = _make_adapter()
    _attach_auth_runner(adapter)
    adapter._clarify_choices["cid1"] = ["alpha"]
    adapter._team_clients["T1"].chat_update = AsyncMock()
    ack = AsyncMock()
    body = {
        "message": {"ts": "1234.5678"},
        "channel": {"id": "C1"},
        "user": {"name": "owner", "id": "U_OWNER"},
    }
    action = {
        "action_id": "hermes_clarify_99",
        "value": '{"clarify_id": "cid1", "index": 99}',
    }

    with patch("tools.clarify_gateway.resolve_gateway_clarify", return_value=True) as mock_resolve:
        await adapter._handle_clarify_action(ack, body, action)

    mock_resolve.assert_called_once_with("cid1", "99")


def test_connect_registers_clarify_action_matcher_without_dropping_existing_handlers():
    adapter = SlackAdapter(PlatformConfig(enabled=True, token="xoxb-test-token"))
    registered_actions = []

    def mock_action(action_id):
        def decorator(fn):
            registered_actions.append((action_id, fn))
            return fn
        return decorator

    def mock_event(_event_type):
        def decorator(fn):
            return fn
        return decorator

    def mock_command(_command):
        def decorator(fn):
            return fn
        return decorator

    mock_app = MagicMock()
    mock_app.event = mock_event
    mock_app.command = mock_command
    mock_app.action = mock_action
    mock_app.client = AsyncMock()
    mock_web_client = AsyncMock()
    mock_web_client.auth_test = AsyncMock(return_value={
        "user_id": "U_BOT",
        "user": "testbot",
        "team_id": "T_FAKE",
        "team": "FakeTeam",
    })

    with patch.object(_slack_mod, "AsyncApp", return_value=mock_app), \
         patch.object(_slack_mod, "AsyncWebClient", return_value=mock_web_client), \
         patch.object(_slack_mod, "AsyncSocketModeHandler", return_value=MagicMock()), \
         patch.dict(os.environ, {"SLACK_APP_TOKEN": "xapp-fake"}), \
         patch("gateway.status.acquire_scoped_lock", return_value=(True, None)), \
         patch("gateway.status.release_scoped_lock"), \
         patch("hermes_cli.plugins.get_plugin_manager") as mock_plugin_manager, \
         patch.object(adapter, "_start_socket_mode_handler"), \
         patch.object(adapter, "_ensure_socket_watchdog"):
        mock_plugin_manager.return_value.get_slack_action_handlers.return_value = []
        result = asyncio.run(adapter.connect())

    assert result is True
    action_ids = [action_id for action_id, _fn in registered_actions]
    assert "hermes_approve_once" in action_ids
    assert "hermes_confirm_once" in action_ids
    assert any(getattr(action_id, "pattern", "") == "^hermes_clarify_" for action_id in action_ids)
