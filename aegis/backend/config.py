"""Aegis backend configuration helpers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import secrets



@dataclass(frozen=True)
class AegisSettings:
    host: str = "127.0.0.1"
    port: int = 9130
    open_browser: bool = True
    allow_public: bool = False
    embedded_chat: bool = False
    jwt_secret: str = ""
    jwt_expire_seconds: int = 28800
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
    jwt_secret = (os.environ.get("AEGIS_JWT_SECRET") or "").strip() or secrets.token_urlsafe(32)

    return AegisSettings(
        host=host,
        port=port,
        open_browser=open_browser,
        allow_public=allow_public,
        embedded_chat=embedded_chat,
        jwt_secret=jwt_secret,
        jwt_expire_seconds=28800,
        dist_dir=dist_dir,
    )


def is_loopback_host(host: str) -> bool:
    """Return True when host binds loopback only."""
    normalized = (host or "").strip().lower()
    return normalized in {"127.0.0.1", "localhost", "::1"}
