from __future__ import annotations

def auth_headers(token: str = "test-token") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_chat_status_available(test_client) -> None:
    resp = test_client.get("/api/chat/status", headers=auth_headers())
    assert resp.status_code == 200
    assert "embedded_chat" in resp.json()
