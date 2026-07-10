from __future__ import annotations

def auth_headers(token: str = "test-token") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_memory_index_lists_soul_user_and_memory_files(test_client, monkeypatch) -> None:
    from aisoc.backend.services import memory_service

    monkeypatch.setattr(
        memory_service,
        "list_memory_bundle",
        lambda: {
            "soul": {"name": "SOUL.md"},
            "user_preferences": {"name": "USER.md"},
            "memory_files": [{"name": "MEMORY.md"}],
        },
    )
    resp = test_client.get("/api/memory", headers=auth_headers())
    assert resp.status_code == 200
    body = resp.json()
    assert "soul" in body
    assert "user_preferences" in body
    assert "memory_files" in body
