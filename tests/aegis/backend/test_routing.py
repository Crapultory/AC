from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


AUTH_HEADERS = {"Authorization": "Bearer test-session-token"}


def _write_store(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


@pytest.fixture
def routing_client(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> Iterator[TestClient]:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    server = load_backend("aegis.backend.server")
    app = server.create_app()
    with TestClient(app) as test_client:
        yield test_client


def test_global_routing_crud_persists_through_shared_store(
    routing_client: TestClient,
    tmp_path,
) -> None:
    create_response = routing_client.post(
        "/api/routing/global",
        headers=AUTH_HEADERS,
        json={
            "name": "Prioritize phishing incidents",
            "policy": "Route all phishing investigations to the email response queue.",
            "status": "active",
        },
    )
    assert create_response.status_code == 201
    created_rule = create_response.json()
    assert created_rule["id"]
    assert len(created_rule["id"]) == 8
    assert created_rule == {
        "id": created_rule["id"],
        "name": "Prioritize phishing incidents",
        "policy": "Route all phishing investigations to the email response queue.",
        "status": "active",
    }

    list_response = routing_client.get("/api/routing/global", headers=AUTH_HEADERS)
    assert list_response.status_code == 200
    assert list_response.json() == {"rules": [created_rule]}

    get_response = routing_client.get(
        f"/api/routing/global/{created_rule['id']}",
        headers=AUTH_HEADERS,
    )
    assert get_response.status_code == 200
    assert get_response.json() == created_rule

    update_response = routing_client.put(
        f"/api/routing/global/{created_rule['id']}",
        headers=AUTH_HEADERS,
        json={
            "name": "Fallback phishing queue",
            "policy": "Fallback unmatched phishing reports to the triage queue.",
            "status": "inactive",
        },
    )
    assert update_response.status_code == 200
    assert update_response.json() == {
        "id": created_rule["id"],
        "name": "Fallback phishing queue",
        "policy": "Fallback unmatched phishing reports to the triage queue.",
        "status": "inactive",
    }

    assert json.loads((tmp_path / "a2a.json").read_text()) == {
        "a2a": {},
        "global": [
            {
                "id": created_rule["id"],
                "name": "Fallback phishing queue",
                "policy": "Fallback unmatched phishing reports to the triage queue.",
                "status": "inactive",
            }
        ],
    }

    delete_response = routing_client.delete(
        f"/api/routing/global/{created_rule['id']}",
        headers=AUTH_HEADERS,
    )
    assert delete_response.status_code == 200
    assert delete_response.json() == {"deleted": True, "id": created_rule["id"]}
    assert json.loads((tmp_path / "a2a.json").read_text()) == {"a2a": {}, "global": []}


def test_create_global_routing_rule_avoids_duplicate_generated_ids(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_store(
        tmp_path / "a2a.json",
        {
            "a2a": {},
            "global": [
                {
                    "id": "deadbeef",
                    "name": "Existing rule",
                    "policy": "Keep existing routing.",
                    "status": "active",
                }
            ],
        },
    )

    routing_service = load_backend("aegis.backend.services.routing_service")
    generated_chars = iter("deadbeeffacecafe")
    monkeypatch.setattr(
        routing_service.secrets,
        "choice",
        lambda _alphabet: next(generated_chars),
    )

    server = load_backend("aegis.backend.server")
    app = server.create_app()
    with TestClient(app) as routing_client:
        response = routing_client.post(
            "/api/routing/global",
            headers=AUTH_HEADERS,
            json={
                "name": "New rule",
                "policy": "Send new cases to the fallback queue.",
                "status": "active",
            },
        )

    assert response.status_code == 201
    assert response.json()["id"] == "facecafe"
    assert [rule["id"] for rule in json.loads((tmp_path / "a2a.json").read_text())["global"]] == [
        "deadbeef",
        "facecafe",
    ]


def test_get_put_and_delete_return_404_for_missing_global_rule(
    routing_client: TestClient,
) -> None:
    get_response = routing_client.get("/api/routing/global/missing123", headers=AUTH_HEADERS)
    assert get_response.status_code == 404
    assert get_response.json() == {"detail": "Global routing rule 'missing123' not found."}

    put_response = routing_client.put(
        "/api/routing/global/missing123",
        headers=AUTH_HEADERS,
        json={
            "name": "Fallback queue",
            "policy": "Route unmatched alerts to the fallback queue.",
            "status": "inactive",
        },
    )
    assert put_response.status_code == 404
    assert put_response.json() == {"detail": "Global routing rule 'missing123' not found."}

    delete_response = routing_client.delete(
        "/api/routing/global/missing123",
        headers=AUTH_HEADERS,
    )
    assert delete_response.status_code == 404
    assert delete_response.json() == {"detail": "Global routing rule 'missing123' not found."}


def test_global_routing_request_body_forbids_extra_fields(
    routing_client: TestClient,
) -> None:
    response = routing_client.post(
        "/api/routing/global",
        headers=AUTH_HEADERS,
        json={
            "id": "rule-should-not-be-accepted",
            "name": "Fallback queue",
            "policy": "Route unmatched alerts to the fallback queue.",
            "status": "active",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "extra_forbidden"


def test_global_routing_status_allows_only_active_or_inactive(
    routing_client: TestClient,
) -> None:
    response = routing_client.post(
        "/api/routing/global",
        headers=AUTH_HEADERS,
        json={
            "name": "Fallback queue",
            "policy": "Route unmatched alerts to the fallback queue.",
            "status": "paused",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "status"]


def test_list_rules_returns_controlled_error_for_malformed_persisted_entry(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_store(
        tmp_path / "a2a.json",
        {
            "a2a": {},
            "global": ["bad-entry"],
        },
    )

    server = load_backend("aegis.backend.server")
    app = server.create_app()
    with TestClient(app) as client:
        response = client.get("/api/routing/global", headers=AUTH_HEADERS)

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Stored global routing rule is invalid.",
    }


def test_get_rule_returns_controlled_error_for_malformed_persisted_entry(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_store(
        tmp_path / "a2a.json",
        {
            "a2a": {},
            "global": [
                {
                    "id": "deadbeef",
                    "name": "Broken rule",
                    "policy": "Route unmatched alerts to the fallback queue.",
                    "status": "paused",
                }
            ],
        },
    )

    server = load_backend("aegis.backend.server")
    app = server.create_app()
    with TestClient(app) as client:
        response = client.get("/api/routing/global/deadbeef", headers=AUTH_HEADERS)

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Stored global routing rule 'deadbeef' has an invalid shape.",
    }
