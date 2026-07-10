from __future__ import annotations

from fastapi.testclient import TestClient

from aisoc.backend.config import load_aisoc_settings
from aisoc.backend.server import create_app


def test_generated_token_is_non_empty_when_env_missing(monkeypatch) -> None:
    monkeypatch.delenv("AISOC_SESSION_TOKEN", raising=False)
    settings = load_aisoc_settings()
    assert settings.session_token
    assert settings.token_source == "generated"


def test_login_accepts_env_token(monkeypatch) -> None:
    monkeypatch.setenv("AISOC_SESSION_TOKEN", "test-token")
    settings = load_aisoc_settings()
    app = create_app(settings)
    client = TestClient(app)

    resp = client.post("/api/auth/login", json={"token": "test-token"})
    assert resp.status_code == 200
    assert resp.json() == {"authenticated": True}


def test_login_rejects_bad_token(monkeypatch) -> None:
    monkeypatch.setenv("AISOC_SESSION_TOKEN", "test-token")
    settings = load_aisoc_settings()
    app = create_app(settings)
    client = TestClient(app)

    resp = client.post("/api/auth/login", json={"token": "wrong"})
    assert resp.status_code == 401


def test_session_reflects_bearer_auth_state(monkeypatch) -> None:
    monkeypatch.setenv("AISOC_SESSION_TOKEN", "test-token")
    settings = load_aisoc_settings()
    app = create_app(settings)
    client = TestClient(app)

    unauth = client.get("/api/auth/session")
    assert unauth.status_code == 200
    assert unauth.json()["authenticated"] is False

    auth = client.get(
        "/api/auth/session", headers={"Authorization": "Bearer test-token"}
    )
    assert auth.status_code == 200
    assert auth.json()["authenticated"] is True


def test_middleware_blocks_protected_api_without_token(monkeypatch) -> None:
    monkeypatch.setenv("AISOC_SESSION_TOKEN", "test-token")
    settings = load_aisoc_settings()
    app = create_app(settings)

    @app.get("/api/private")
    async def private() -> dict[str, bool]:
        return {"ok": True}

    client = TestClient(app)
    blocked = client.get("/api/private")
    assert blocked.status_code == 401

    allowed = client.get(
        "/api/private", headers={"Authorization": "Bearer test-token"}
    )
    assert allowed.status_code == 200
    assert allowed.json() == {"ok": True}


def test_openapi_exposes_bearer_auth_scheme(monkeypatch) -> None:
    monkeypatch.setenv("AISOC_SESSION_TOKEN", "test-token")
    settings = load_aisoc_settings()
    app = create_app(settings)
    client = TestClient(app)

    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()
    security_schemes = schema["components"]["securitySchemes"]
    assert "bearerAuth" in security_schemes
    assert security_schemes["bearerAuth"]["type"] == "http"
    assert security_schemes["bearerAuth"]["scheme"] == "bearer"
    assert {"bearerAuth": []} in schema.get("security", [])
