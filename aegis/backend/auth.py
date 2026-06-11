"""Aegis auth helpers."""

from __future__ import annotations

from fastapi import HTTPException, Request

from aegis.backend.config import AegisSettings


AUTH_HEADER = "Authorization"


def extract_bearer_token(request: Request) -> str | None:
    """Extract the bearer token from an HTTP request."""
    auth_header = (request.headers.get(AUTH_HEADER) or "").strip()
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = token.strip()
    return token or None


def token_matches(token: str | None, settings: AegisSettings) -> bool:
    """Return True when a candidate token matches the configured session token."""
    return bool(token) and token == settings.session_token


def verify_bearer_token(request: Request, settings: AegisSettings) -> None:
    """Validate request bearer token or raise 401."""
    if not token_matches(extract_bearer_token(request), settings):
        raise HTTPException(status_code=401, detail="Unauthorized")
