from __future__ import annotations

def auth_headers(token: str = "test-token") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_latest_descendant_returns_resume_target(test_client, monkeypatch) -> None:
    from aisoc.backend.services import session_service

    monkeypatch.setattr(
        session_service,
        "get_latest_descendant",
        lambda session_id: {
            "requested_session_id": session_id,
            "session_id": "sess-child",
            "path": [session_id, "sess-child"],
            "changed": True,
        },
    )
    resp = test_client.get(
        "/api/sessions/root/latest-descendant", headers=auth_headers()
    )
    assert resp.status_code == 200
    assert resp.json()["session_id"] == "sess-child"
