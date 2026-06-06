"""Tests for Slack delegate runtime wiring in GatewayRunner._run_agent()."""

from __future__ import annotations

import importlib
import sys
import threading
import types
from collections import OrderedDict
from types import SimpleNamespace

import pytest

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import BasePlatformAdapter, SendResult
from gateway.session import SessionSource


class _RuntimeCaptureAdapter(BasePlatformAdapter):
    def __init__(self, *, platform: Platform):
        super().__init__(PlatformConfig(enabled=True, token="***"), platform)
        self.runtime_calls = []
        self._runtime_seq = 0

    async def connect(self) -> bool:
        return True

    async def disconnect(self) -> None:
        return None

    async def send(self, chat_id, content, reply_to=None, metadata=None) -> SendResult:
        return SendResult(success=True, message_id="msg-1")

    async def edit_message(self, chat_id, message_id, content, **kwargs) -> SendResult:
        del kwargs
        return SendResult(success=True, message_id=message_id)

    async def send_typing(self, chat_id, metadata=None) -> None:
        return None

    async def stop_typing(self, chat_id) -> None:
        return None

    async def get_chat_info(self, chat_id: str):
        return {"id": chat_id}

    def build_delegate_foreground_runtime(
        self,
        *,
        channel_id: str,
        thread_ts: str | None,
        user_id: str | None = None,
        chat_type: str | None = None,
    ):
        self._runtime_seq += 1
        marker = self._runtime_seq
        runtime = {
            "output": f"output-{marker}",
            "input_factory": lambda marker=marker: f"input-{marker}",
            "metadata": {"thread_id": thread_ts} if thread_ts else None,
        }
        self.runtime_calls.append(
            {
                "channel_id": channel_id,
                "thread_ts": thread_ts,
                "user_id": user_id,
                "chat_type": chat_type,
                "runtime": runtime,
            }
        )
        return runtime


class _NonSlackRuntimeAdapter(_RuntimeCaptureAdapter):
    def build_delegate_foreground_runtime(self, *, channel_id: str, thread_ts: str | None, **kwargs):
        del kwargs
        raise AssertionError(
            f"delegate runtime should not be requested for non-Slack platform: {channel_id}/{thread_ts}"
        )


class _FakeAgent:
    instances = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.tools = []
        self.turn_snapshots = []
        type(self).instances.append(self)

    def run_conversation(self, message, conversation_history=None, task_id=None):
        del message, conversation_history, task_id
        input_factory = getattr(self, "_delegate_ext_input_factory", None)
        self.turn_snapshots.append(
            {
                "output": getattr(self, "_delegate_ext_output_adapter", None),
                "input_factory": input_factory,
                "input_value": input_factory() if callable(input_factory) else None,
            }
        )
        return {
            "final_response": "done",
            "messages": [],
            "api_calls": 1,
        }


def _make_runner(adapter):
    gateway_run = importlib.import_module("gateway.run")
    GatewayRunner = gateway_run.GatewayRunner

    runner = object.__new__(GatewayRunner)
    runner.adapters = {adapter.platform: adapter}
    runner._voice_mode = {}
    runner._prefill_messages = []
    runner._ephemeral_system_prompt = ""
    runner._reasoning_config = None
    runner._provider_routing = {}
    runner._fallback_model = None
    runner._session_db = None
    runner._running_agents = {}
    runner._session_run_generation = {}
    runner._agent_cache = OrderedDict()
    runner._agent_cache_lock = threading.Lock()
    runner.hooks = SimpleNamespace(loaded_hooks=False)
    runner.config = SimpleNamespace(
        thread_sessions_per_user=False,
        group_sessions_per_user=False,
        stt_enabled=False,
    )
    return runner


def _install_fake_agent(monkeypatch, agent_cls):
    fake_dotenv = types.ModuleType("dotenv")
    fake_dotenv.load_dotenv = lambda *args, **kwargs: None
    monkeypatch.setitem(sys.modules, "dotenv", fake_dotenv)

    fake_run_agent = types.ModuleType("run_agent")
    fake_run_agent.AIAgent = agent_cls
    monkeypatch.setitem(sys.modules, "run_agent", fake_run_agent)


@pytest.fixture(autouse=True)
def _reset_fake_agent_instances():
    _FakeAgent.instances = []
    yield
    _FakeAgent.instances = []


class TestSlackDelegateRuntimeWiring:
    @pytest.mark.asyncio
    async def test_run_agent_injects_delegate_runtime_for_new_slack_agent(self, monkeypatch, tmp_path):
        _install_fake_agent(monkeypatch, _FakeAgent)
        adapter = _RuntimeCaptureAdapter(platform=Platform.SLACK)
        runner = _make_runner(adapter)
        gateway_run = importlib.import_module("gateway.run")
        monkeypatch.setattr(gateway_run, "_hermes_home", tmp_path)
        monkeypatch.setattr(gateway_run, "_resolve_runtime_agent_kwargs", lambda: {"api_key": "***"})

        source = SessionSource(
            platform=Platform.SLACK,
            chat_id="D123",
            chat_type="dm",
            thread_id="1717171717.500000",
        )

        result = await runner._run_agent(
            message="hello",
            context_prompt="",
            history=[],
            source=source,
            session_id="sess-slack-runtime-new",
            session_key="agent:main:slack:dm:D123:1717171717.500000",
            event_message_id="1717171717.500001",
        )

        assert result["final_response"] == "done"
        assert len(adapter.runtime_calls) == 1
        assert adapter.runtime_calls[0]["channel_id"] == "D123"
        assert adapter.runtime_calls[0]["thread_ts"] == "1717171717.500000"
        assert adapter.runtime_calls[0]["user_id"] is None
        assert adapter.runtime_calls[0]["chat_type"] == "dm"
        assert len(_FakeAgent.instances) == 1
        assert len(_FakeAgent.instances[0].turn_snapshots) == 1
        snapshot = _FakeAgent.instances[0].turn_snapshots[0]
        assert snapshot["output"] == "output-1"
        assert callable(snapshot["input_factory"])
        assert snapshot["input_value"] == "input-1"

    @pytest.mark.asyncio
    async def test_run_agent_refreshes_delegate_runtime_for_cached_slack_agent(self, monkeypatch, tmp_path):
        _install_fake_agent(monkeypatch, _FakeAgent)
        adapter = _RuntimeCaptureAdapter(platform=Platform.SLACK)
        runner = _make_runner(adapter)
        gateway_run = importlib.import_module("gateway.run")
        monkeypatch.setattr(gateway_run, "_hermes_home", tmp_path)
        monkeypatch.setattr(gateway_run, "_resolve_runtime_agent_kwargs", lambda: {"api_key": "***"})

        source = SessionSource(
            platform=Platform.SLACK,
            chat_id="D123",
            chat_type="dm",
            thread_id=None,
            user_id="U_DM",
        )

        result_one = await runner._run_agent(
            message="hello",
            context_prompt="",
            history=[],
            source=source,
            session_id="sess-slack-runtime-cached",
            session_key="agent:main:slack:dm:D123",
            event_message_id="1717171717.600001",
        )
        result_two = await runner._run_agent(
            message="hello again",
            context_prompt="",
            history=[],
            source=source,
            session_id="sess-slack-runtime-cached",
            session_key="agent:main:slack:dm:D123",
            event_message_id="1717171717.600002",
        )

        assert result_one["final_response"] == "done"
        assert result_two["final_response"] == "done"
        assert len(_FakeAgent.instances) == 1
        assert [call["thread_ts"] for call in adapter.runtime_calls] == [
            "1717171717.600001",
            "1717171717.600002",
        ]
        assert [call["user_id"] for call in adapter.runtime_calls] == ["U_DM", "U_DM"]
        assert [call["chat_type"] for call in adapter.runtime_calls] == ["dm", "dm"]
        assert len(_FakeAgent.instances[0].turn_snapshots) == 2
        first_snapshot, second_snapshot = _FakeAgent.instances[0].turn_snapshots
        assert first_snapshot["output"] == "output-1"
        assert second_snapshot["output"] == "output-2"
        assert first_snapshot["input_value"] == "input-1"
        assert second_snapshot["input_value"] == "input-2"
        assert callable(first_snapshot["input_factory"])
        assert callable(second_snapshot["input_factory"])
        assert first_snapshot["input_factory"] is not second_snapshot["input_factory"]

    @pytest.mark.asyncio
    async def test_run_agent_skips_delegate_runtime_for_non_slack_platform(self, monkeypatch, tmp_path):
        _install_fake_agent(monkeypatch, _FakeAgent)
        adapter = _NonSlackRuntimeAdapter(platform=Platform.TELEGRAM)
        runner = _make_runner(adapter)
        gateway_run = importlib.import_module("gateway.run")
        monkeypatch.setattr(gateway_run, "_hermes_home", tmp_path)
        monkeypatch.setattr(gateway_run, "_resolve_runtime_agent_kwargs", lambda: {"api_key": "***"})

        source = SessionSource(
            platform=Platform.TELEGRAM,
            chat_id="12345",
            chat_type="dm",
            thread_id="17585",
        )

        result = await runner._run_agent(
            message="hello",
            context_prompt="",
            history=[],
            source=source,
            session_id="sess-telegram-runtime-skip",
            session_key="agent:main:telegram:dm:12345:17585",
            event_message_id="9001",
        )

        assert result["final_response"] == "done"
        assert len(_FakeAgent.instances) == 1
        assert _FakeAgent.instances[0].turn_snapshots == [
            {
                "output": None,
                "input_factory": None,
                "input_value": None,
            }
        ]

    @pytest.mark.asyncio
    async def test_run_agent_legacy_slack_dm_does_not_force_synthetic_thread_runtime(self, monkeypatch, tmp_path):
        _install_fake_agent(monkeypatch, _FakeAgent)
        adapter = _RuntimeCaptureAdapter(platform=Platform.SLACK)
        adapter.config.extra["dm_top_level_threads_as_sessions"] = False
        runner = _make_runner(adapter)
        gateway_run = importlib.import_module("gateway.run")
        monkeypatch.setattr(gateway_run, "_hermes_home", tmp_path)
        monkeypatch.setattr(gateway_run, "_resolve_runtime_agent_kwargs", lambda: {"api_key": "***"})

        source = SessionSource(
            platform=Platform.SLACK,
            chat_id="D123",
            chat_type="dm",
            thread_id=None,
            user_id="U_DM",
        )

        result = await runner._run_agent(
            message="legacy dm",
            context_prompt="",
            history=[],
            source=source,
            session_id="sess-slack-runtime-legacy-dm",
            session_key="agent:main:slack:dm:D123",
            event_message_id="1717171717.700001",
        )

        assert result["final_response"] == "done"
        assert len(adapter.runtime_calls) == 1
        assert adapter.runtime_calls[0]["thread_ts"] is None
        assert adapter.runtime_calls[0]["chat_type"] == "dm"
        snapshot = _FakeAgent.instances[0].turn_snapshots[0]
        assert snapshot["output"] == "output-1"
        assert callable(snapshot["input_factory"])
        assert snapshot["input_value"] == "input-1"
