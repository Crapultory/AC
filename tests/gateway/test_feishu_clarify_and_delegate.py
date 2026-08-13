"""Feishu clarify-card and foreground A2A delegate adapter coverage."""

import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_repo = str(Path(__file__).resolve().parents[2])
if _repo not in sys.path:
    sys.path.insert(0, _repo)


def _ensure_feishu_mocks():
    if importlib.util.find_spec("lark_oapi") is None and "lark_oapi" not in sys.modules:
        mock = MagicMock()
        for name in ("lark_oapi", "lark_oapi.api.im.v1", "lark_oapi.event"):
            sys.modules.setdefault(name, mock)


_ensure_feishu_mocks()

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import SendResult
from gateway.run import GatewayRunner
import plugins.platforms.feishu.adapter as feishu_module
from plugins.platforms.feishu.adapter import FeishuAdapter


def _make_adapter() -> FeishuAdapter:
    adapter = FeishuAdapter(PlatformConfig(enabled=True))
    adapter._client = MagicMock()
    return adapter


def _card_data(value, *, chat_id="oc_123", open_id="ou_owner", token="token-1"):
    return SimpleNamespace(
        event=SimpleNamespace(
            token=token,
            context=SimpleNamespace(open_chat_id=chat_id),
            operator=SimpleNamespace(open_id=open_id, user_id=""),
            action=SimpleNamespace(value=value),
        )
    )


class _Response:
    def __init__(self):
        self.card = None


class _Card:
    def __init__(self):
        self.type = None
        self.data = None


@pytest.mark.asyncio
async def test_feishu_send_clarify_renders_card_and_keeps_choices_private():
    adapter = _make_adapter()
    response = SimpleNamespace(success=lambda: True, data=SimpleNamespace(message_id="om_card"))
    with patch.object(adapter, "_feishu_send_with_retry", new_callable=AsyncMock, return_value=response) as send:
        result = await adapter.send_clarify(
            chat_id="oc_123",
            question="Pick one?",
            choices=["alpha", "beta"],
            clarify_id="clarify-1",
            session_key="session-1",
            metadata={"thread_id": "th_1"},
        )

    assert result.success is True
    assert adapter._clarify_choices["clarify-1"]["choices"] == ["alpha", "beta"]
    kwargs = send.call_args.kwargs
    assert kwargs["msg_type"] == "interactive"
    assert kwargs["metadata"] == {"thread_id": "th_1"}
    card = json.loads(kwargs["payload"])
    actions = card["elements"][1]["actions"]
    assert [button["value"]["index"] for button in actions] == [0, 1, "other"]
    assert all("alpha" not in button["value"] for button in actions)


@pytest.mark.asyncio
async def test_feishu_open_ended_clarify_uses_base_text_fallback():
    adapter = _make_adapter()
    adapter.send = AsyncMock(return_value=SendResult(success=True, message_id="om_text"))

    result = await adapter.send_clarify(
        chat_id="oc_123", question="Explain?", choices=None, clarify_id="open", session_key="s"
    )

    assert result.success is True
    adapter.send.assert_awaited_once()


def test_feishu_clarify_choice_callback_returns_resolved_card(monkeypatch):
    adapter = _make_adapter()
    adapter._loop = MagicMock()
    adapter._loop.is_closed.return_value = False
    adapter._allowed_group_users = {"ou_owner"}
    adapter._clarify_choices["clarify-1"] = {"choices": ["alpha", "beta"], "chat_id": "oc_123"}
    adapter._sender_name_cache["ou_owner"] = ("Owner", 9999999999)
    monkeypatch.setattr(feishu_module, "P2CardActionTriggerResponse", _Response)
    monkeypatch.setattr(feishu_module, "CallBackCard", _Card)

    def _close(coro, _loop):
        coro.close()
        return SimpleNamespace(add_done_callback=lambda *_args: None)

    with patch("asyncio.run_coroutine_threadsafe", side_effect=_close):
        response = adapter._on_card_action_trigger(_card_data({
            "hermes_clarify_action": "select", "clarify_id": "clarify-1", "index": 1,
        }))

    assert response.card is not None
    assert "beta" in response.card.data["elements"][0]["content"]


@pytest.mark.asyncio
async def test_feishu_clarify_other_marks_text_capture_and_retires_card_state(monkeypatch):
    adapter = _make_adapter()
    adapter._allowed_group_users = {"ou_owner"}
    adapter._clarify_choices["clarify-1"] = {"choices": ["alpha"], "chat_id": "oc_123"}
    adapter._sender_name_cache["ou_owner"] = ("Owner", 9999999999)
    monkeypatch.setattr(feishu_module, "P2CardActionTriggerResponse", _Response)
    monkeypatch.setattr(feishu_module, "CallBackCard", _Card)
    adapter._loop = MagicMock()
    adapter._loop.is_closed.return_value = False

    with patch("tools.clarify_gateway.mark_awaiting_text", return_value=True) as mark:
        response = adapter._on_card_action_trigger(_card_data({
            "hermes_clarify_action": "other", "clarify_id": "clarify-1", "index": "other",
        }))

    mark.assert_called_once_with("clarify-1")
    assert "clarify-1" not in adapter._clarify_choices
    assert "Waiting" in response.card.data["header"]["title"]["content"]


def test_feishu_clarify_rejects_cross_chat_and_duplicate_callbacks(monkeypatch):
    adapter = _make_adapter()
    adapter._loop = MagicMock()
    adapter._loop.is_closed.return_value = False
    adapter._allowed_group_users = {"ou_owner"}
    adapter._clarify_choices["clarify-1"] = {"choices": ["alpha"], "chat_id": "oc_expected"}
    monkeypatch.setattr(feishu_module, "P2CardActionTriggerResponse", _Response)
    monkeypatch.setattr(feishu_module, "CallBackCard", _Card)
    value = {"hermes_clarify_action": "select", "clarify_id": "clarify-1", "index": 0}

    mismatch = adapter._on_card_action_trigger(_card_data(value, chat_id="oc_other", token="mismatch"))
    assert mismatch.card is None
    assert "clarify-1" in adapter._clarify_choices

    def _close(coro, _loop):
        coro.close()
        return SimpleNamespace(add_done_callback=lambda *_args: None)

    with patch("asyncio.run_coroutine_threadsafe", side_effect=_close):
        first = adapter._on_card_action_trigger(_card_data(value, chat_id="oc_expected", token="once"))
        second = adapter._on_card_action_trigger(_card_data(value, chat_id="oc_expected", token="once"))
    assert first.card is not None
    assert second.card is None


def test_feishu_clarify_rejects_unauthorized_and_distinct_duplicate_clicks(monkeypatch):
    adapter = _make_adapter()
    adapter._loop = MagicMock()
    adapter._loop.is_closed.return_value = False
    adapter._allowed_group_users = {"ou_owner"}
    adapter._clarify_choices["clarify-1"] = {"choices": ["alpha"], "chat_id": "oc_123"}
    monkeypatch.setattr(feishu_module, "P2CardActionTriggerResponse", _Response)
    monkeypatch.setattr(feishu_module, "CallBackCard", _Card)
    value = {"hermes_clarify_action": "select", "clarify_id": "clarify-1", "index": 0}

    unauthorized = adapter._on_card_action_trigger(_card_data(value, open_id="ou_other", token="nope"))
    assert unauthorized.card is None
    assert "clarify-1" in adapter._clarify_choices

    def _close(coro, _loop):
        coro.close()
        return SimpleNamespace(add_done_callback=lambda *_args: None)

    with patch("asyncio.run_coroutine_threadsafe", side_effect=_close):
        first = adapter._on_card_action_trigger(_card_data(value, token="first"))
        second = adapter._on_card_action_trigger(_card_data(value, token="second"))
    assert first.card is not None
    assert second.card is None


@pytest.mark.asyncio
async def test_feishu_delegate_foreground_route_and_stream_are_isolated():
    adapter = _make_adapter()
    adapter.send = AsyncMock(return_value=SendResult(success=True, message_id="om_stream"))
    adapter.edit_message = AsyncMock(return_value=SendResult(success=True, message_id="om_stream"))

    runtime = adapter.build_delegate_foreground_runtime(
        channel_id="oc_123", thread_ts="th_1", user_id="ou_owner", chat_type="group"
    )
    first = runtime["input_factory"]()
    second = runtime["input_factory"]()
    assert first is not second
    first.enter_foreground()

    assert await adapter._maybe_route_delegate_foreground_message(
        text="follow up", chat_id="oc_123", thread_id="th_1", user_id="ou_owner", chat_type="group"
    )
    assert first.read_line(timeout=0) == "follow up"
    assert not await adapter._maybe_route_delegate_foreground_message(
        text="other user", chat_id="oc_123", thread_id="th_1", user_id="ou_other", chat_type="group"
    )

    route_key = adapter._delegate_route_key(
        chat_id="oc_123", thread_id="th_1", user_id="ou_owner", chat_type="group"
    )
    with patch.object(adapter, "_delegate_stream_edit_interval", return_value=60.0):
        await adapter.handle_delegate_ai_delta(route_key=route_key, chat_id="oc_123", content="hello", metadata={"thread_id": "th_1"})
        await adapter.handle_delegate_ai_delta(route_key=route_key, chat_id="oc_123", content=" world", metadata={"thread_id": "th_1"})
    adapter.send.assert_awaited_once()
    adapter.edit_message.assert_not_awaited()
    await adapter.handle_delegate_stream_segment_break(
        route_key=route_key, chat_id="oc_123", metadata={"thread_id": "th_1"}
    )
    adapter.edit_message.assert_awaited_once_with("oc_123", "om_stream", "hello world")
    assert route_key in adapter._delegate_stream_states
    first.close()
    assert route_key not in adapter._delegate_routes
    assert route_key not in adapter._delegate_stream_states


def test_gateway_binds_feishu_delegate_runtime_for_each_turn():
    adapter = _make_adapter()
    runner = object.__new__(GatewayRunner)
    runner.adapters = {Platform.FEISHU: adapter}
    agent = SimpleNamespace()
    source = SimpleNamespace(
        platform=Platform.FEISHU, chat_id="oc_123", thread_id=None, user_id="ou_owner", chat_type="dm"
    )

    runner._bind_delegate_foreground_runtime_for_turn(agent, source, event_message_id="om_1")

    assert agent._delegate_ext_output_adapter is not None
    assert callable(agent._delegate_ext_input_factory)
