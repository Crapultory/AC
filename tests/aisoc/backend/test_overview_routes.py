from __future__ import annotations

from fastapi.testclient import TestClient

from aisoc.backend.config import load_aisoc_settings
from aisoc.backend.server import create_app


def test_overview_status_requires_auth(monkeypatch) -> None:
    monkeypatch.setenv("AISOC_SESSION_TOKEN", "test-token")
    settings = load_aisoc_settings()
    app = create_app(settings)
    client = TestClient(app)

    unauth = client.get("/api/overview/status")
    assert unauth.status_code == 401

    auth = client.get(
        "/api/overview/status", headers={"Authorization": "Bearer test-token"}
    )
    assert auth.status_code == 200
