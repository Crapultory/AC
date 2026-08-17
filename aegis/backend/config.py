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
    oidc_issuer: str = "http://127.0.0.1:8080"
    oidc_backchannel_url: str = "http://127.0.0.1:8080"
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_redirect_uri: str = "http://127.0.0.1:9130/api/sso/callback"
    oidc_post_login_redirect: str = "/sso/callback"
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
    oidc_issuer = (os.environ.get("OIDC_ISSUER") or "http://127.0.0.1:8080").strip().rstrip("/")
    oidc_backchannel_url = (
        os.environ.get("OIDC_BACKCHANNEL_URL") or oidc_issuer
    ).strip().rstrip("/")
    oidc_redirect_uri = (
        os.environ.get("OIDC_REDIRECT_URI")
        or "http://127.0.0.1:9130/api/sso/callback"
    ).strip()
    oidc_post_login_redirect = (
        os.environ.get("OIDC_POST_LOGIN_REDIRECT") or "/sso/callback"
    ).strip()

    return AegisSettings(
        host=host,
        port=port,
        open_browser=open_browser,
        allow_public=allow_public,
        embedded_chat=embedded_chat,
        jwt_secret=jwt_secret,
        jwt_expire_seconds=28800,
        oidc_issuer=oidc_issuer,
        oidc_backchannel_url=oidc_backchannel_url,
        oidc_client_id=(os.environ.get("OIDC_CLIENT_ID") or "").strip(),
        oidc_client_secret=(os.environ.get("OIDC_CLIENT_SECRET") or "").strip(),
        oidc_redirect_uri=oidc_redirect_uri,
        oidc_post_login_redirect=oidc_post_login_redirect,
        dist_dir=dist_dir,
    )


def is_loopback_host(host: str) -> bool:
    """Return True when host binds loopback only."""
    normalized = (host or "").strip().lower()
    return normalized in {"127.0.0.1", "localhost", "::1"}
