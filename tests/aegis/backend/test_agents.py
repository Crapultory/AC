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
def agent_client(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    hermes_home,
) -> Iterator[TestClient]:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")

    server = load_backend("aegis.backend.server")
    app = server.create_app()
    with TestClient(app) as test_client:
        yield test_client


def test_agents_crud_persists_through_shared_store(
    agent_client: TestClient,
    hermes_home,
) -> None:
    create_response = agent_client.post(
        "/api/agents/agent-1",
        headers=AUTH_HEADERS,
        json={
            "url": "http://127.0.0.1:9086/a2a",
            "description": "A2A test endpoint",
            "headers": {"Authorization": "Bearer abc"},
            "status": "active",
            "extcapabilities": ["query-ip", "query-domain"],
        },
    )
    assert create_response.status_code == 201
    assert create_response.json() == {
        "agent_id": "agent-1",
        "url": "http://127.0.0.1:9086/a2a",
        "description": "A2A test endpoint",
        "headers": {"Authorization": "Bearer abc"},
        "status": "active",
        "extcapabilities": ["query-ip", "query-domain"],
    }

    list_response = agent_client.get("/api/agents", headers=AUTH_HEADERS)
    assert list_response.status_code == 200
    assert list_response.json() == {
        "agents": [
            {
                "agent_id": "agent-1",
                "url": "http://127.0.0.1:9086/a2a",
                "description": "A2A test endpoint",
                "headers": {"Authorization": "Bearer abc"},
                "status": "active",
                "extcapabilities": ["query-ip", "query-domain"],
            }
        ]
    }

    get_response = agent_client.get("/api/agents/agent-1", headers=AUTH_HEADERS)
    assert get_response.status_code == 200
    assert get_response.json() == {
        "agent_id": "agent-1",
        "url": "http://127.0.0.1:9086/a2a",
        "description": "A2A test endpoint",
        "headers": {"Authorization": "Bearer abc"},
        "status": "active",
        "extcapabilities": ["query-ip", "query-domain"],
    }

    update_response = agent_client.put(
        "/api/agents/agent-1",
        headers=AUTH_HEADERS,
        json={
            "url": "http://127.0.0.1:9087/a2a",
            "description": "Updated endpoint",
            "headers": {"X-Token": "def"},
            "status": "idle",
            "extcapabilities": ["query-url"],
        },
    )
    assert update_response.status_code == 200
    assert update_response.json() == {
        "agent_id": "agent-1",
        "url": "http://127.0.0.1:9087/a2a",
        "description": "Updated endpoint",
        "headers": {"X-Token": "def"},
        "status": "idle",
        "extcapabilities": ["query-url"],
    }

    assert json.loads((hermes_home / "a2a.json").read_text()) == {
        "a2a": {
            "agent-1": {
                "url": "http://127.0.0.1:9087/a2a",
                "description": "Updated endpoint",
                "headers": {"X-Token": "def"},
                "status": "idle",
                "extcapabilities": ["query-url"],
            }
        },
        "global": [],
    }

    delete_response = agent_client.delete("/api/agents/agent-1", headers=AUTH_HEADERS)
    assert delete_response.status_code == 200
    assert delete_response.json() == {"deleted": True, "agent_id": "agent-1"}
    assert json.loads((hermes_home / "a2a.json").read_text()) == {"a2a": {}, "global": []}


def test_agent_create_and_global_rule_create_share_same_persisted_store(
    load_backend,
    agent_client: TestClient,
    hermes_home,
) -> None:
    agent_response = agent_client.post(
        "/api/agents/agent-1",
        headers=AUTH_HEADERS,
        json={
            "url": "http://127.0.0.1:9086/a2a",
            "description": "A2A test endpoint",
            "headers": {"Authorization": "Bearer abc"},
            "status": "active",
            "extcapabilities": ["query-ip"],
        },
    )
    assert agent_response.status_code == 201

    rule_response = agent_client.post(
        "/api/routing/global",
        headers=AUTH_HEADERS,
        json={
            "name": "Prioritize phishing incidents",
            "policy": "Route all phishing investigations to the email response queue.",
            "status": "active",
        },
    )
    assert rule_response.status_code == 201
    created_rule = rule_response.json()

    assert json.loads((hermes_home / "a2a.json").read_text()) == {
        "a2a": {
            "agent-1": {
                "url": "http://127.0.0.1:9086/a2a",
                "description": "A2A test endpoint",
                "headers": {"Authorization": "Bearer abc"},
                "status": "active",
                "extcapabilities": ["query-ip"],
            }
        },
        "global": [
            {
                "id": created_rule["id"],
                "name": "Prioritize phishing incidents",
                "policy": "Route all phishing investigations to the email response queue.",
                "status": "active",
            }
        ],
    }

    server = load_backend("aegis.backend.server")
    reloaded_app = server.create_app()
    with TestClient(reloaded_app) as reloaded_client:
        reloaded_agent = reloaded_client.get("/api/agents/agent-1", headers=AUTH_HEADERS)
        assert reloaded_agent.status_code == 200
        assert reloaded_agent.json() == {
            "agent_id": "agent-1",
            "url": "http://127.0.0.1:9086/a2a",
            "description": "A2A test endpoint",
            "headers": {"Authorization": "Bearer abc"},
            "status": "active",
            "extcapabilities": ["query-ip"],
        }

        reloaded_rules = reloaded_client.get("/api/routing/global", headers=AUTH_HEADERS)
        assert reloaded_rules.status_code == 200
        assert reloaded_rules.json() == {
            "rules": [
                {
                    "id": created_rule["id"],
                    "name": "Prioritize phishing incidents",
                    "policy": "Route all phishing investigations to the email response queue.",
                    "status": "active",
                }
            ]
        }


def test_post_rejects_duplicate_agent(agent_client: TestClient) -> None:
    payload = {
        "url": "http://127.0.0.1:9086/a2a",
        "description": "A2A test endpoint",
        "headers": {},
        "status": "active",
        "extcapabilities": [],
    }

    first = agent_client.post("/api/agents/agent-1", headers=AUTH_HEADERS, json=payload)
    assert first.status_code == 201

    second = agent_client.post("/api/agents/agent-1", headers=AUTH_HEADERS, json=payload)
    assert second.status_code == 409
    assert second.json() == {"detail": "Agent 'agent-1' already exists."}


def test_get_put_and_delete_return_404_for_missing_agent(agent_client: TestClient) -> None:
    get_response = agent_client.get("/api/agents/missing", headers=AUTH_HEADERS)
    assert get_response.status_code == 404
    assert get_response.json() == {"detail": "Agent 'missing' not found."}

    put_response = agent_client.put(
        "/api/agents/missing",
        headers=AUTH_HEADERS,
        json={
            "url": "http://127.0.0.1:9086/a2a",
            "description": "A2A test endpoint",
            "headers": {},
            "status": "offline",
            "extcapabilities": [],
        },
    )
    assert put_response.status_code == 404
    assert put_response.json() == {"detail": "Agent 'missing' not found."}

    delete_response = agent_client.delete("/api/agents/missing", headers=AUTH_HEADERS)
    assert delete_response.status_code == 404
    assert delete_response.json() == {"detail": "Agent 'missing' not found."}


def test_request_body_must_not_contain_agent_id(agent_client: TestClient) -> None:
    response = agent_client.post(
        "/api/agents/agent-1",
        headers=AUTH_HEADERS,
        json={
            "agent_id": "other-agent",
            "url": "http://127.0.0.1:9086/a2a",
            "description": "A2A test endpoint",
            "headers": {},
            "status": "active",
            "extcapabilities": [],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "extra_forbidden"


def test_status_allows_only_expected_values(agent_client: TestClient) -> None:
    response = agent_client.post(
        "/api/agents/agent-1",
        headers=AUTH_HEADERS,
        json={
            "url": "http://127.0.0.1:9086/a2a",
            "description": "A2A test endpoint",
            "headers": {},
            "status": "paused",
            "extcapabilities": [],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "status"]


def test_list_agents_returns_controlled_error_for_malformed_persisted_entry(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_store(
        tmp_path / "a2a.json",
        {
            "a2a": {
                "legacy-agent": "http://127.0.0.1:9086/a2a",
            },
            "global": [],
        },
    )

    server = load_backend("aegis.backend.server")
    app = server.create_app()
    with TestClient(app) as client:
        response = client.get("/api/agents", headers=AUTH_HEADERS)

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Stored agent 'legacy-agent' has an invalid shape.",
    }


def test_get_agent_returns_controlled_error_for_malformed_persisted_entry(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_store(
        tmp_path / "a2a.json",
        {
            "a2a": {
                "broken-agent": {
                    "url": "http://127.0.0.1:9086/a2a",
                    "description": "A2A endpoint",
                    "headers": [],
                    "status": "active",
                    "extcapabilities": [],
                }
            },
            "global": [],
        },
    )

    server = load_backend("aegis.backend.server")
    app = server.create_app()
    with TestClient(app) as client:
        response = client.get("/api/agents/broken-agent", headers=AUTH_HEADERS)

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Stored agent 'broken-agent' has an invalid shape.",
    }


def test_create_rejects_invalid_url(agent_client: TestClient) -> None:
    response = agent_client.post(
        "/api/agents/agent-1",
        headers=AUTH_HEADERS,
        json={
            "url": "not-a-url",
            "description": "A2A test endpoint",
            "headers": {},
            "status": "active",
            "extcapabilities": [],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "url"]


def test_update_rejects_invalid_url(agent_client: TestClient) -> None:
    create_response = agent_client.post(
        "/api/agents/agent-1",
        headers=AUTH_HEADERS,
        json={
            "url": "https://127.0.0.1:9086/a2a",
            "description": "A2A test endpoint",
            "headers": {},
            "status": "active",
            "extcapabilities": [],
        },
    )
    assert create_response.status_code == 201

    response = agent_client.put(
        "/api/agents/agent-1",
        headers=AUTH_HEADERS,
        json={
            "url": "ftp://127.0.0.1:9087/a2a",
            "description": "Updated endpoint",
            "headers": {},
            "status": "idle",
            "extcapabilities": [],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "url"]
