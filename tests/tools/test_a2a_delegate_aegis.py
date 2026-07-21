from __future__ import annotations

import sqlite3
from types import SimpleNamespace

import pytest

import tools.a2a_delegate_aegis as a2a_delegate_aegis
from tools.a2a_delegate_aegis import (
    AegisDelegateStore,
    AgentPolicyConflictError,
    AgentPolicyNotFoundError,
    run_aegis_checked_delegate,
)


def test_schema_initialization_preserves_existing_users_table(tmp_path) -> None:
    db_path = tmp_path / "aegis.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE users (uid TEXT PRIMARY KEY, username TEXT NOT NULL)")
        conn.execute("INSERT INTO users (uid, username) VALUES ('u-1', 'alice')")
        conn.commit()

    AegisDelegateStore(db_path)

    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT uid, username FROM users").fetchall() == [("u-1", "alice")]
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
    assert {"users", "policy", "a2a_delegate_audit"} <= tables


def test_policy_crud_normalizes_selectors_and_rejects_conflicts(tmp_path) -> None:
    store = AegisDelegateStore(tmp_path / "aegis.db")

    created = store.create_policy(
        rank_id=10,
        platform=" AEGIS ",
        user_id="",
        agent_name=" responder ",
        status="DENY",
    )
    assert created == {
        "rank_id": 10,
        "platform": "aegis",
        "user_id": "*",
        "agent_name": "responder",
        "status": "deny",
    }
    assert store.get_policy(10) == created

    updated = store.update_policy(
        10,
        rank_id=5,
        platform="*",
        user_id="alice",
        agent_name="responder",
        status="allow",
    )
    assert updated["rank_id"] == 5
    with pytest.raises(AgentPolicyNotFoundError):
        store.get_policy(10)

    store.create_policy(
        rank_id=8,
        platform="*",
        user_id="*",
        agent_name="*",
        status="deny",
    )
    with pytest.raises(AgentPolicyConflictError):
        store.update_policy(
            8,
            rank_id=5,
            platform="*",
            user_id="*",
            agent_name="*",
            status="deny",
        )

    store.delete_policy(5)
    with pytest.raises(AgentPolicyNotFoundError):
        store.delete_policy(5)


def test_lowest_rank_matching_policy_decides_and_no_match_allows(tmp_path) -> None:
    store = AegisDelegateStore(tmp_path / "aegis.db")
    store.create_policy(
        rank_id=20,
        platform="aegis",
        user_id="*",
        agent_name="responder",
        status="deny",
    )
    store.create_policy(
        rank_id=5,
        platform="aegis",
        user_id="alice",
        agent_name="responder",
        status="allow",
    )

    exempt = store.evaluate_policy(platform="AEGIS", user_id="alice", agent_name="responder")
    denied = store.evaluate_policy(platform="aegis", user_id="bob", agent_name="responder")
    unmatched = store.evaluate_policy(platform="slack", user_id="bob", agent_name="other")

    assert exempt.allowed is True
    assert exempt.matched_policy["rank_id"] == 5
    assert denied.allowed is False
    assert denied.matched_policy["rank_id"] == 20
    assert unmatched.allowed is True
    assert unmatched.matched_policy is None


def test_audit_query_supports_combined_filters_and_pagination(tmp_path) -> None:
    store = AegisDelegateStore(tmp_path / "aegis.db")
    common = {
        "platform": "aegis",
        "user_id": "u-1",
        "user_name": "Alice",
        "agent_name": "responder",
        "session_id": "remote-1",
        "is_loop": False,
        "is_delegate_output": True,
    }
    store.record_audit(
        **common,
        goal="Investigate phishing",
        status="succ",
        audit_id="audit-1",
        timestamp="2026-07-21T01:00:00.000000Z",
    )
    store.record_audit(
        **{**common, "user_id": "u-2", "user_name": "Bob"},
        goal="Investigate malware",
        status="fail",
        audit_id="audit-2",
        timestamp="2026-07-21T02:00:00.000000Z",
    )
    store.record_audit(
        **common,
        goal="Investigate phishing attachment",
        status="succ",
        audit_id="audit-3",
        timestamp="2026-07-21T03:00:00.000000Z",
    )

    filtered = store.query_audits(
        page=1,
        page_size=1,
        user_name="ali",
        goal="PHISHING",
        status="succ",
        is_delegate_output=True,
        timestamp_from="2026-07-21T00:00:00.000000Z",
        timestamp_to="2026-07-21T04:00:00.000000Z",
    )

    assert filtered.total == 2
    assert [row["id"] for row in filtered.logs] == ["audit-3"]
    assert filtered.logs[0]["is_loop"] is False
    assert filtered.logs[0]["is_delegate_output"] is True

    second_page = store.query_audits(
        page=2,
        page_size=1,
        user_name="ali",
        goal="phishing",
    )
    assert [row["id"] for row in second_page.logs] == ["audit-1"]


def test_checked_delegate_returns_authorization_and_records_check_audit(
    monkeypatch, tmp_path
) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    parent = SimpleNamespace(
        platform="slack",
        _user_env_platform=None,
        _user_id="u-1",
        _user_name="Alice",
    )

    result = run_aegis_checked_delegate(
        parent_agent=parent,
        goal="Investigate",
        agent_name="responder",
        session_id="remote-1",
        is_loop=False,
        is_delegate_output=True,
    )

    assert result.allowed is True
    assert result.authorization == "allowed"
    assert result.failure_payload is None
    store = AegisDelegateStore(tmp_path / "aegis.db")
    audits = store.query_audits().logs
    assert len(audits) == 1
    assert audits[0]["status"] == "succ"


def test_checked_delegate_store_initialization_error_fails_closed(
    monkeypatch,
) -> None:
    def fail_store_initialization():
        raise OSError("database unavailable")

    monkeypatch.setattr(
        a2a_delegate_aegis,
        "get_aegis_delegate_store",
        fail_store_initialization,
    )

    result = run_aegis_checked_delegate(
        parent_agent=SimpleNamespace(platform="cli"),
        goal="Investigate",
        agent_name="responder",
        session_id=None,
        is_loop=False,
        is_delegate_output=True,
    )

    assert result.allowed is False
    assert result.authorization == "error"
    assert result.failure_payload is not None
    assert "database unavailable" not in result.failure_payload["error"]
