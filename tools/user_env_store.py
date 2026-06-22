"""Persistent per-user environment-variable storage.

Data lives in ``$HERMES_HOME/users.env.json`` and is keyed by
``platform.user_id.user_name``. Components are normalized and percent-encoded
so the key remains stable across turns and safe to persist in JSON.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

from hermes_constants import get_hermes_home
from utils import atomic_json_write

logger = logging.getLogger(__name__)

_STORE_LOCK = threading.RLock()


@dataclass(frozen=True)
class LoadedUserEnv:
    platform: str
    user_id: str
    user_name: str
    user_key: str
    env: dict[str, str]


def get_user_env_path() -> Path:
    """Return the persistent user-env store path."""
    return get_hermes_home() / "users.env.json"


def _normalize_identity_component(value: Any) -> str:
    """Normalize one identity component while keeping user-visible dots."""
    text = str(value or "").strip()
    return quote(text, safe=".-_~")


def make_user_env_key(platform: Any, user_id: Any, user_name: Any) -> str:
    """Build the canonical ``platform.user_id.user_name`` store key."""
    return ".".join(
        (
            _normalize_identity_component(platform),
            _normalize_identity_component(user_id),
            _normalize_identity_component(user_name),
        )
    )


def _read_store_unlocked() -> dict[str, dict[str, str]]:
    path = get_user_env_path()
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Could not read user env store %s: %s", path, exc)
        return {}
    if not isinstance(payload, dict):
        return {}
    result: dict[str, dict[str, str]] = {}
    for user_key, raw_env in payload.items():
        if not isinstance(user_key, str) or not isinstance(raw_env, dict):
            continue
        result[user_key] = {
            str(key): str(value)
            for key, value in raw_env.items()
            if isinstance(key, str)
        }
    return result


def _write_store_unlocked(payload: dict[str, dict[str, str]]) -> None:
    atomic_json_write(get_user_env_path(), payload, sort_keys=True)


def _normalize_env_payload(raw_env: dict[str, Any] | None) -> dict[str, str]:
    if not isinstance(raw_env, dict):
        return {}
    return {
        str(key): str(value)
        for key, value in raw_env.items()
        if isinstance(key, str)
    }


def load_user_env(platform: Any, user_id: Any, user_name: Any) -> LoadedUserEnv:
    """Load env for the current identity, migrating username-only drift in-place."""
    platform_text = str(platform or "").strip()
    user_id_text = str(user_id or "").strip()
    user_name_text = str(user_name or "").strip()
    user_key = make_user_env_key(platform_text, user_id_text, user_name_text)
    prefix = (
        f"{_normalize_identity_component(platform_text)}."
        f"{_normalize_identity_component(user_id_text)}."
    )

    with _STORE_LOCK:
        payload = _read_store_unlocked()
        current_env = _normalize_env_payload(payload.get(user_key))
        if current_env:
            return LoadedUserEnv(platform_text, user_id_text, user_name_text, user_key, current_env)

        # Username drift migration: only rename when exactly one matching
        # ``platform.user_id.*`` record exists so we never merge ambiguous users.
        matching_keys = [
            existing_key
            for existing_key, existing_env in payload.items()
            if existing_key.startswith(prefix) and isinstance(existing_env, dict)
        ]
        if len(matching_keys) == 1:
            old_key = matching_keys[0]
            migrated_env = _normalize_env_payload(payload.get(old_key))
            if old_key != user_key:
                payload[user_key] = migrated_env
                del payload[old_key]
                _write_store_unlocked(payload)
            return LoadedUserEnv(platform_text, user_id_text, user_name_text, user_key, migrated_env)
        if len(matching_keys) > 1:
            logger.warning(
                "Ambiguous user env migration for platform=%r user_id=%r user_name=%r; "
                "candidates=%s",
                platform_text,
                user_id_text,
                user_name_text,
                matching_keys,
            )

    return LoadedUserEnv(platform_text, user_id_text, user_name_text, user_key, {})


def list_user_env(platform: Any, user_id: Any, user_name: Any) -> LoadedUserEnv:
    """Return the canonical env view for one user."""
    return load_user_env(platform, user_id, user_name)


def set_user_env_var(platform: Any, user_id: Any, user_name: Any, key: Any, value: Any) -> LoadedUserEnv:
    """Persist one env variable for a single user."""
    env_key = str(key or "").strip()
    if not env_key:
        raise ValueError("Environment variable name is required")
    if "=" in env_key or "\x00" in env_key:
        raise ValueError("Environment variable name cannot contain '=' or NUL bytes")

    loaded = load_user_env(platform, user_id, user_name)
    with _STORE_LOCK:
        payload = _read_store_unlocked()
        current_env = _normalize_env_payload(payload.get(loaded.user_key))
        current_env[env_key] = str(value)
        payload[loaded.user_key] = current_env
        _write_store_unlocked(payload)
    return LoadedUserEnv(loaded.platform, loaded.user_id, loaded.user_name, loaded.user_key, current_env)


def delete_user_env_var(
    platform: Any,
    user_id: Any,
    user_name: Any,
    key: Any,
) -> tuple[LoadedUserEnv, bool]:
    """Delete one env variable for a single user."""
    env_key = str(key or "").strip()
    if not env_key:
        raise ValueError("Environment variable name is required")

    loaded = load_user_env(platform, user_id, user_name)
    with _STORE_LOCK:
        payload = _read_store_unlocked()
        current_env = _normalize_env_payload(payload.get(loaded.user_key))
        deleted = env_key in current_env
        current_env.pop(env_key, None)
        if current_env:
            payload[loaded.user_key] = current_env
        else:
            payload.pop(loaded.user_key, None)
        _write_store_unlocked(payload)
    return (
        LoadedUserEnv(loaded.platform, loaded.user_id, loaded.user_name, loaded.user_key, current_env),
        deleted,
    )
