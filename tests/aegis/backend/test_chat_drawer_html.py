from __future__ import annotations


def test_chat_drawer_html_requires_authentication_and_returns_document(
    client,
    auth_headers: dict[str, str],
) -> None:
    path = "2026-06-07-aegis-architecture-showcase.html"

    assert client.get("/api/chat/drawer-html", params={"path": path}).status_code == 401

    response = client.get(
        "/api/chat/drawer-html",
        params={"path": path},
        headers=auth_headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["title"] == path
    assert "<title>Aegis Architecture Showcase</title>" in payload["content"]


def test_chat_drawer_html_returns_not_found_for_missing_document(
    client,
    auth_headers: dict[str, str],
) -> None:
    response = client.get(
        "/api/chat/drawer-html",
        params={"path": "does-not-exist.html"},
        headers=auth_headers,
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Drawer HTML document not found."}
