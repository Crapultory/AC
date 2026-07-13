import pytest

from gateway.config import GatewayConfig, Platform, PlatformConfig
from gateway.platforms.base import MessageEvent
from gateway.run import GatewayRunner
from gateway.session import SessionSource


def _make_runner(config: GatewayConfig) -> GatewayRunner:
    runner = object.__new__(GatewayRunner)
    runner.config = config
    runner.adapters = {}
    runner._model = "openai/gpt-4.1-mini"
    runner._base_url = None
    return runner


@pytest.mark.asyncio
async def test_preprocess_prefixes_sender_for_shared_non_thread_group_session():
    runner = _make_runner(
        GatewayConfig(
            platforms={
                Platform.TELEGRAM: PlatformConfig(enabled=True, token="fake"),
            },
            group_sessions_per_user=False,
        )
    )
    source = SessionSource(
        platform=Platform.TELEGRAM,
        chat_id="-1002285219667",
        chat_name="Test Group",
        chat_type="group",
        user_name="Alice",
    )
    event = MessageEvent(text="hello", source=source)

    result = await runner._prepare_inbound_message_text(
        event=event,
        source=source,
        history=[],
    )

    assert result == "[Alice] hello"


@pytest.mark.asyncio
async def test_preprocess_keeps_plain_text_for_default_group_sessions():
    runner = _make_runner(
        GatewayConfig(
            platforms={
                Platform.TELEGRAM: PlatformConfig(enabled=True, token="fake"),
            },
        )
    )
    source = SessionSource(
        platform=Platform.TELEGRAM,
        chat_id="-1002285219667",
        chat_name="Test Group",
        chat_type="group",
        user_name="Alice",
    )
    event = MessageEvent(text="hello", source=source)

    result = await runner._prepare_inbound_message_text(
        event=event,
        source=source,
        history=[],
    )

    assert result == "hello"


@pytest.mark.asyncio
@pytest.mark.parametrize("chat_type", ["dm", "group"])
async def test_preprocess_adds_structured_source_prefix_for_slack(chat_type: str):
    runner = _make_runner(GatewayConfig())
    source = SessionSource(
        platform=Platform.SLACK,
        chat_id="C123",
        chat_type=chat_type,
        user_id="U456",
        user_name="Alice",
    )
    event = MessageEvent(text="hello", source=source)

    result = await runner._prepare_inbound_message_text(
        event=event,
        source=source,
        history=[],
    )

    assert result == (
        '<source>{"platform":"slack","channel":"C123",'
        '"uid":"U456","uname":"Alice"}</source>\n\nhello'
    )


@pytest.mark.asyncio
async def test_preprocess_keeps_slack_source_prefix_before_thread_reply_context():
    runner = _make_runner(GatewayConfig())
    source = SessionSource(
        platform=Platform.SLACK,
        chat_id="C02MVR0PADS",
        chat_type="group",
        user_id="U02LQJ2S5HN",
        user_name="Guisheng(郭桂生)",
    )
    event = MessageEvent(
        text="获取 TEST_KEY 内容",
        source=source,
        reply_to_message_id="1710000000.000001",
        reply_to_text="当前 userenv 数据，返回对应 key",
    )

    result = await runner._prepare_inbound_message_text(
        event=event,
        source=source,
        history=[],
    )

    assert result == (
        '<source>{"platform":"slack","channel":"C02MVR0PADS",'
        '"uid":"U02LQJ2S5HN","uname":"Guisheng(郭桂生)"}</source>\n\n'
        '[Replying to: "当前 userenv 数据，返回对应 key"]\n\n获取 TEST_KEY 内容'
    )
