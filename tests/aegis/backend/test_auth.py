from __future__ import annotations

from fastapi.testclient import TestClient


def test_load_settings_generates_token_when_env_missing(
    load_backend,
    monkeypatch,
) -> None:
    monkeypatch.delenv("AEGIS_SESSION_TOKEN", raising=False)

    config = load_backend("aegis.backend.config")
    settings = config.load_aegis_settings()

    assert settings.token_source == "generated"
    assert settings.session_token


def test_login_session_and_logout_routes(client: TestClient) -> None:
    login_response = client.post("/api/auth/login", json={"token": "test-session-token"})
    assert login_response.status_code == 200
    assert login_response.json() == {"authenticated": True}

    session_without_auth = client.get("/api/auth/session")
    assert session_without_auth.status_code == 200
    assert session_without_auth.json() == {
        "authenticated": False,
        "token_source": "env",
    }

    session_with_auth = client.get(
        "/api/auth/session",
        headers={"Authorization": "Bearer test-session-token"},
    )
    assert session_with_auth.status_code == 200
    assert session_with_auth.json() == {
        "authenticated": True,
        "token_source": "env",
    }

    logout_response = client.post("/api/auth/logout")
    assert logout_response.status_code == 200
    assert logout_response.json() == {"logged_out": True}


def test_session_accepts_case_insensitive_bearer_schemes(client: TestClient) -> None:
    lowercase = client.get(
        "/api/auth/session",
        headers={"Authorization": "bearer test-session-token"},
    )
    assert lowercase.status_code == 200
    assert lowercase.json() == {
        "authenticated": True,
        "token_source": "env",
    }

    mixed_case = client.get(
        "/api/auth/session",
        headers={"Authorization": "BeArEr test-session-token"},
    )
    assert mixed_case.status_code == 200
    assert mixed_case.json() == {
        "authenticated": True,
        "token_source": "env",
    }


def test_auth_middleware_protects_other_api_routes(client: TestClient) -> None:
    unauthorized = client.get("/api/does-not-exist")
    assert unauthorized.status_code == 401
    assert unauthorized.json() == {"detail": "Unauthorized"}

    authorized = client.get(
        "/api/does-not-exist",
        headers={"Authorization": "Bearer test-session-token"},
    )
    assert authorized.status_code == 404
    assert authorized.json() == {"detail": "Not Found"}

    lowercase = client.get(
        "/api/does-not-exist",
        headers={"Authorization": "bearer test-session-token"},
    )
    assert lowercase.status_code == 404
    assert lowercase.json() == {"detail": "Not Found"}


def test_public_health_and_bootstrap_routes_are_accessible(client: TestClient) -> None:
    health_response = client.get("/health")
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}

    bootstrap_response = client.get("/api/system/bootstrap")
    assert bootstrap_response.status_code == 200
    assert bootstrap_response.json() == {
        "embedded_chat": False,
        "auth_scheme": "bearer-token",
    }


def test_openapi_includes_bearer_auth_scheme(client: TestClient) -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200

    schema = response.json()
    assert schema["components"]["securitySchemes"]["bearerAuth"] == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "Token",
        "description": (
            "Paste Aegis session token. Swagger will send "
            "`Authorization: Bearer <token>`."
        ),
    }
    assert schema["security"] == [{"bearerAuth": []}]
