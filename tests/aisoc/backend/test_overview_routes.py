from __future__ import annotations

from fastapi.testclient import TestClient

from aisoc.backend.config import load_aisoc_settings
from aisoc.backend.server import create_app


REQUIRED_STATUS_KEYS = {
    "status",
    "model",
    "provider",
    "profile",
    "uptime_seconds",
    "last_activity",
}

REQUIRED_STATS_KEYS = {
    "total_sessions",
    "active_sessions",
    "today_tokens",
    "today_input_tokens",
    "today_output_tokens",
    "cron_jobs_total",
    "cron_jobs_enabled",
    "memory_used_chars",
    "memory_total_chars",
    "memory_percent",
    "source_distribution",
}


def _auth_client(monkeypatch) -> tuple[TestClient, dict[str, str]]:
    monkeypatch.setenv("AISOC_SESSION_TOKEN", "test-token")
    settings = load_aisoc_settings()
    app = create_app(settings)
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token"}
    return client, headers


def test_overview_status_requires_auth(monkeypatch) -> None:
    client, headers = _auth_client(monkeypatch)

    unauth = client.get("/api/overview/status")
    assert unauth.status_code == 401

    auth = client.get("/api/overview/status", headers=headers)
    assert auth.status_code == 200
    assert REQUIRED_STATUS_KEYS.issubset(auth.json().keys())


def test_overview_stats_requires_auth(monkeypatch) -> None:
    client, headers = _auth_client(monkeypatch)

    unauth = client.get("/api/overview/stats")
    assert unauth.status_code == 401

    auth = client.get("/api/overview/stats", headers=headers)
    assert auth.status_code == 200
    assert REQUIRED_STATS_KEYS.issubset(auth.json().keys())


def test_overview_token_trend_days_validation(monkeypatch) -> None:
    client, headers = _auth_client(monkeypatch)

    valid_default = client.get("/api/overview/token-trend", headers=headers)
    assert valid_default.status_code == 200

    valid_7 = client.get("/api/overview/token-trend?days=7", headers=headers)
    assert valid_7.status_code == 200

    valid_30 = client.get("/api/overview/token-trend?days=30", headers=headers)
    assert valid_30.status_code == 200

    valid_07 = client.get("/api/overview/token-trend?days=07", headers=headers)
    assert valid_07.status_code == 200

    invalid = client.get("/api/overview/token-trend?days=14", headers=headers)
    assert invalid.status_code == 422
    assert invalid.json() == {"detail": "days must be 7 or 30"}


def test_overview_token_trend_response_shape(monkeypatch) -> None:
    client, headers = _auth_client(monkeypatch)

    response = client.get("/api/overview/token-trend?days=7", headers=headers)
    assert response.status_code == 200

    rows = response.json()
    assert isinstance(rows, list)
    assert len(rows) == 7
    assert set(rows[0].keys()) == {
        "date",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "sessions",
    }
