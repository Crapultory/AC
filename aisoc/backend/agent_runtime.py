"""Shared Hermes runtime helpers for AISOC modules."""

from __future__ import annotations

import logging
import os
import time

from hermes_state import SessionDB
from hermes_constants import get_config_path
from hermes_cli import config as hermes_config
from hermes_cli import runtime_provider


logger = logging.getLogger(__name__)


class EchoAgent:
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


def prepare_hermes_home() -> None:
    """Point AISOC child operations at the active Hermes profile directory."""
    try:
        from hermes_constants import get_hermes_home

        print(f"Using Hermes home: {get_hermes_home()}")
        hermes_home = str(get_hermes_home())
        os.chdir(hermes_home)
        os.environ["HERMES_HOME"] = hermes_home
        os.environ["HOME"] = hermes_home + "/home"
    except Exception as exc:
        print(f"Warning: Failed to set TERMINAL_CWD from Hermes profile: {exc}")


def build_profile_agent_kwargs(
    session_id: str,
    *,
    platform: str,
    config_module=hermes_config,
    runtime_provider_module=runtime_provider,
) -> dict[str, object]:
    """Resolve the current profile into explicit AIAgent kwargs."""
    cfg = config_module.load_config_readonly()
    model_cfg = config_module.cfg_get(cfg, "model", default={})
    if not isinstance(model_cfg, dict):
        model_cfg = {}

    requested_provider = str(model_cfg.get("provider") or "").strip() or None
    requested_model = str(model_cfg.get("default") or model_cfg.get("model") or "").strip() or None

    runtime = runtime_provider_module.resolve_runtime_provider(
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
        "platform": platform,
        "session_id": session_id,
        "provider": resolved_provider,
        "enabled_toolsets": ["delegation_ext"],
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


def default_agent_factory(
    session_id: str,
    *,
    platform: str,
    config_module=hermes_config,
    runtime_provider_module=runtime_provider,
    session_db_cls=SessionDB,
    log: logging.Logger | None = None,
):
    """Create a profile-configured AIAgent for AISOC modules."""
    if os.environ.get("AISOC_A2A_TEST_MODE") == "echo":
        return EchoAgent()

    from run_agent import AIAgent

    active_logger = log or logger
    agent_kwargs = build_profile_agent_kwargs(
        session_id,
        platform=platform,
        config_module=config_module,
        runtime_provider_module=runtime_provider_module,
    )
    log_prefix = "A2A" if "a2a" in platform else "AISOC"
    active_logger.info(
        "%s profile injection from %s: %s",
        log_prefix,
        get_config_path(),
        {
            "provider": agent_kwargs.get("provider"),
            "model": agent_kwargs.get("model"),
            "base_url": agent_kwargs.get("base_url"),
            "api_mode": agent_kwargs.get("api_mode"),
            "source": agent_kwargs.get("_a2a_runtime_source"),
        },
    )
    agent_kwargs.pop("_a2a_runtime_source", None)
    try:
        agent_kwargs["session_db"] = session_db_cls()
    except Exception as exc:
        active_logger.warning(
            "AISOC SessionDB unavailable; continuing without session persistence: %s",
            exc,
        )
    return AIAgent(**agent_kwargs)


def load_conversation_history(
    agent: object,
    session_id: str | None = None,
) -> list[dict[str, object]]:
    """Load OpenAI-format conversation history from the agent's SessionDB."""
    active_session_id = str(session_id or getattr(agent, "session_id", "") or "").strip()
    if not active_session_id:
        return []

    session_db = None
    getter = getattr(agent, "_get_session_db_for_recall", None)
    if callable(getter):
        try:
            session_db = getter()
        except Exception:
            session_db = None
    if session_db is None:
        session_db = getattr(agent, "_session_db", None)
    if session_db is None:
        return []

    loader = getattr(session_db, "get_messages_as_conversation", None)
    if not callable(loader):
        return []
    try:
        history = loader(active_session_id)
    except Exception:
        return []
    return list(history or [])
