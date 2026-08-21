from __future__ import annotations


def test_session_detail_includes_tool_call_id_for_history_reconstruction(monkeypatch) -> None:
    """The frontend groups consecutive role="tool" rows into a reconstructed
    tool-call bubble on refresh (chatRuntime.tsx messagesFromSessionDetail),
    keyed by tool_call_id. Regression guard: don't drop that field again."""
    from aisoc.backend.services import session_service

    class FakeSessionDB:
        def resolve_session_id(self, session_id: str) -> str:
            return session_id

        def get_session(self, sid: str) -> dict:
            return {
                "source": "aisoc_web",
                "model": "test-model",
                "started_at": 1,
                "ended_at": 2,
                "message_count": 3,
                "input_tokens": 10,
                "output_tokens": 20,
                "user_id": "admin-uid",
            }

        def get_messages(self, sid: str) -> list[dict]:
            return [
                {"role": "user", "content": "run the scan", "timestamp": 1},
                {
                    "role": "tool",
                    "content": "scan complete, 0 findings",
                    "tool_name": "run_shell",
                    "tool_call_id": "call_abc",
                    "timestamp": 2,
                },
                {"role": "assistant", "content": "Scan finished.", "timestamp": 3},
            ]

        def close(self) -> None:
            pass

    monkeypatch.setattr(session_service, "SessionDB", FakeSessionDB)

    payload = session_service.get_session_detail_with_messages("sess-1", user_id="admin-uid")

    assert payload is not None
    tool_messages = [m for m in payload["messages"] if m["role"] == "tool"]
    assert len(tool_messages) == 1
    assert tool_messages[0]["tool_call_id"] == "call_abc"
    assert tool_messages[0]["tool_name"] == "run_shell"
    assert tool_messages[0]["content"] == "scan complete, 0 findings"


def test_latest_descendant_returns_resume_target(test_client, auth_headers, monkeypatch) -> None:
    from aisoc.backend.services import session_service

    monkeypatch.setattr(
        session_service,
        "get_latest_descendant",
        lambda session_id, *, user_id: {
            "requested_session_id": session_id,
            "session_id": "sess-child",
            "path": [session_id, "sess-child"],
            "changed": True,
        },
    )
    resp = test_client.get(
        "/api/sessions/root/latest-descendant", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["session_id"] == "sess-child"
