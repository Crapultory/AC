from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aisoc.backend.config import load_aisoc_settings
from aisoc.backend.server import create_app


@pytest.fixture
def auth_token(monkeypatch: pytest.MonkeyPatch) -> str:
    token = "test-token"
    monkeypatch.setenv("AISOC_SESSION_TOKEN", token)
    return token


@pytest.fixture
def test_client(auth_token: str) -> TestClient:
    settings = load_aisoc_settings()
    app = create_app(settings)
    return TestClient(app)


def auth_headers(token: str = "test-token") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}

