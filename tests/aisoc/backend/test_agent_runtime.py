from __future__ import annotations

from types import SimpleNamespace

from aisoc.backend.agent_runtime import build_profile_agent_kwargs


def _fake_cfg_get(cfg, *keys, default=None):
    current = cfg
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            return default
        current = current[key]
    return current


def test_build_profile_agent_kwargs_reads_platform_toolsets_from_loaded_config() -> None:
    cfg = {
        "model": {
            "default": "deepseek-v4-flash",
            "provider": "custom:chatai",
        },
        "platform_toolsets": {
            "aisoc-a2a": ["web", "a2a"],
        },
    }
    config_module = SimpleNamespace(
        load_config_readonly=lambda: cfg,
        cfg_get=_fake_cfg_get,
    )
    runtime_provider_module = SimpleNamespace(
        resolve_runtime_provider=lambda **_: {
            "provider": "custom",
            "model": "gpt-5.4",
            "source": "custom_provider:chatai",
        }
    )

    agent_kwargs = build_profile_agent_kwargs(
        "context-123",
        platform="aisoc-a2a",
        config_module=config_module,
        runtime_provider_module=runtime_provider_module,
    )

    assert agent_kwargs["enabled_toolsets"] == ["web", "a2a"]


def test_build_profile_agent_kwargs_keeps_a2a_when_platform_toolsets_missing() -> None:
    cfg = {
        "model": {
            "default": "deepseek-v4-flash",
            "provider": "custom:chatai",
        },
    }
    config_module = SimpleNamespace(
        load_config_readonly=lambda: cfg,
        cfg_get=_fake_cfg_get,
    )
    runtime_provider_module = SimpleNamespace(
        resolve_runtime_provider=lambda **_: {
            "provider": "custom",
            "model": "gpt-5.4",
            "source": "custom_provider:chatai",
        }
    )

    agent_kwargs = build_profile_agent_kwargs(
        "context-123",
        platform="aisoc-a2a",
        config_module=config_module,
        runtime_provider_module=runtime_provider_module,
    )

    assert agent_kwargs["enabled_toolsets"] == ["a2a"]


def test_build_profile_agent_kwargs_respects_explicit_empty_platform_toolsets() -> None:
    cfg = {
        "model": {
            "default": "deepseek-v4-flash",
            "provider": "custom:chatai",
        },
        "platform_toolsets": {
            "aisoc-a2a": [],
        },
    }
    config_module = SimpleNamespace(
        load_config_readonly=lambda: cfg,
        cfg_get=_fake_cfg_get,
    )
    runtime_provider_module = SimpleNamespace(
        resolve_runtime_provider=lambda **_: {
            "provider": "custom",
            "model": "gpt-5.4",
            "source": "custom_provider:chatai",
        }
    )

    agent_kwargs = build_profile_agent_kwargs(
        "context-123",
        platform="aisoc-a2a",
        config_module=config_module,
        runtime_provider_module=runtime_provider_module,
    )

    assert agent_kwargs["enabled_toolsets"] == []
