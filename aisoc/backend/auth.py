"""AISOC auth helpers."""

from __future__ import annotations

from fastapi import HTTPException, Request, WebSocketException

from aisoc.backend.config import AisocSettings


AUTH_HEADER = "Authorization"


def extract_bearer_token(request: Request) -> str | None:
    """Extract the bearer token from an HTTP request."""
    auth_header = (request.headers.get(AUTH_HEADER) or "").strip()
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[len("Bearer ") :].strip()
    return token or None


def token_matches(token: str | None, settings: AisocSettings) -> bool:
    """Return True when a candidate token matches the configured session token."""
    return bool(token) and token == settings.session_token


def verify_bearer_token(request: Request, settings: AisocSettings) -> None:
    """Validate request bearer token or raise 401."""
    if not token_matches(extract_bearer_token(request), settings):
        raise HTTPException(status_code=401, detail="Unauthorized")


def verify_ws_token(token: str | None, settings: AisocSettings) -> None:
    """Validate websocket token or raise websocket unauthorized."""
    if not token_matches(token, settings):
        raise WebSocketException(code=4401, reason="Unauthorized")

