"""Aegis backend configuration helpers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import secrets
from typing import Literal


TokenSource = Literal["env", "generated"]


@dataclass(frozen=True)
class AegisSettings:
    host: str = "127.0.0.1"
    port: int = 9130
    open_browser: bool = True
    allow_public: bool = False
    embedded_chat: bool = False
    session_token: str = ""
    token_source: TokenSource = "generated"
    dist_dir: Path | None = None


def load_aegis_settings(
    *,
    host: str = "127.0.0.1",
    port: int = 9130,
    open_browser: bool = True,
    allow_public: bool = False,
    embedded_chat: bool = False,
    dist_dir: Path | None = None,
) -> AegisSettings:
    """Load settings from explicit args plus environment fallback."""
    env_token = (os.environ.get("AEGIS_SESSION_TOKEN") or "").strip()
    if env_token:
        token = env_token
        source: TokenSource = "env"
    else:
        token = secrets.token_urlsafe(32)
        source = "generated"

    return AegisSettings(
        host=host,
        port=port,
        open_browser=open_browser,
        allow_public=allow_public,
        embedded_chat=embedded_chat,
        session_token=token,
        token_source=source,
        dist_dir=dist_dir,
    )


def is_loopback_host(host: str) -> bool:
    """Return True when host binds loopback only."""
    normalized = (host or "").strip().lower()
    return normalized in {"127.0.0.1", "localhost", "::1"}

