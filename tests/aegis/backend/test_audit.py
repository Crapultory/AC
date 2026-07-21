from __future__ import annotations

import jwt
from fastapi.testclient import TestClient

from tools.a2a_delegate_aegis import AegisDelegateStore


AUTH_TOKEN = jwt.encode(
    {
        "sub": "0000000000000001",
        "username": "admin",
        "email": "admin@aegis.local",
        "iat": 1,
        "exp": 4102444800,
    },
    "test-jwt-secret-1234567890-abcdef",
    algorithm="HS256",
)
AUTH_HEADERS = {"Authorization": f"Bearer {AUTH_TOKEN}"}


def _record_logs(hermes_home) -> None:
    store = AegisDelegateStore(hermes_home / "aegis.db")
    common = {
        "platform": "aegis",
        "agent_name": "responder",
        "session_id": "remote-session",
        "is_loop": False,
        "is_delegate_output": True,
    }
    store.record_audit(
        **common,
        user_id="u-1",
        user_name="Alice",
        goal="Investigate phishing",
        status="succ",
        audit_id="audit-1",
        timestamp="2026-07-21T01:00:00.000000Z",
    )
    store.record_audit(
        **common,
        user_id="u-2",
        user_name="Bob",
        goal="Investigate malware",
        status="fail",
        audit_id="audit-2",
        timestamp="2026-07-21T02:00:00.000000Z",
    )
    store.record_audit(
        **{**common, "is_loop": True},
        user_id="u-1",
        user_name="Alice",
        goal="Investigate phishing attachment",
        status="auth_denied",
        audit_id="audit-3",
        timestamp="2026-07-21T03:00:00.000000Z",
    )


def test_audit_api_pages_newest_first(client: TestClient, hermes_home) -> None:
    _record_logs(hermes_home)
    first = client.get(
        "/api/audit/a2a-delegates",
        headers=AUTH_HEADERS,
        params={"page": 1, "page_size": 2},
    )
    assert first.status_code == 200
    assert first.json()["total"] == 3
    assert first.json()["page_size"] == 2
    assert [row["id"] for row in first.json()["logs"]] == ["audit-3", "audit-2"]

    second = client.get(
        "/api/audit/a2a-delegates",
        headers=AUTH_HEADERS,
        params={"page": 2, "page_size": 2},
    )
    assert [row["id"] for row in second.json()["logs"]] == ["audit-1"]


def test_audit_api_combines_independent_filters(client: TestClient, hermes_home) -> None:
    _record_logs(hermes_home)
    response = client.get(
        "/api/audit/a2a-delegates",
        headers=AUTH_HEADERS,
        params={
            "id": "audit",
            "platform": "AEG",
            "user_id": "u-1",
            "user_name": "ali",
            "agent_name": "POND",
            "goal": "PHISHING",
            "session_id": "SESSION",
            "status": "auth_denied",
            "is_loop": "true",
            "is_delegate_output": "true",
            "timestamp_from": "2026-07-21T02:30:00Z",
            "timestamp_to": "2026-07-21T03:30:00Z",
        },
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["logs"][0]["id"] == "audit-3"


def test_audit_api_requires_admin(client: TestClient) -> None:
    create = client.post(
        "/api/users",
        headers=AUTH_HEADERS,
        json={
            "username": "analyst",
            "password": "Password123!",
            "email": "analyst@example.com",
            "status": "enabled",
        },
    )
    assert create.status_code == 201
    login = client.post(
        "/api/auth/login",
        json={"username": "analyst", "password": "Password123!"},
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = client.get("/api/audit/a2a-delegates", headers=headers)
    assert response.status_code == 403


def test_audit_api_validates_pagination_and_status(client: TestClient) -> None:
    assert client.get(
        "/api/audit/a2a-delegates",
        headers=AUTH_HEADERS,
        params={"page": 0},
    ).status_code == 422
    assert client.get(
        "/api/audit/a2a-delegates",
        headers=AUTH_HEADERS,
        params={"status": "pending"},
    ).status_code == 422
