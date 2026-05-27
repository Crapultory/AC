from __future__ import annotations

from datetime import datetime

from hermes_state import SessionDB

from aisoc.backend.services import overview_service


def _seed_sessions(db_path, now_ts: float) -> None:
    db = SessionDB(db_path=db_path)
    try:
        db.create_session("s_active", "cli", model="gpt-5")
        db.update_token_counts("s_active", input_tokens=100, output_tokens=50)

        db.create_session("s_today_done", "cron", model="gpt-5")
        db.update_token_counts("s_today_done", input_tokens=200, output_tokens=100)
        db.end_session("s_today_done", "done")

        db.create_session("s_old", "api", model="old-model")
        db.update_token_counts("s_old", input_tokens=5, output_tokens=5)
        db.end_session("s_old", "done")

        with db._lock:
            # Active session in last 24h and today.
            db._conn.execute(
                "UPDATE sessions SET started_at = ?, ended_at = NULL, source = ?, model = ?, billing_provider = ? WHERE id = ?",
                (now_ts - 300, "cli", "gpt-5", "openai", "s_active"),
            )
            # Ended session still from today.
            db._conn.execute(
                "UPDATE sessions SET started_at = ?, source = ? WHERE id = ?",
                (now_ts - 1800, "cron", "s_today_done"),
            )
            # Old historical session outside 7-day window.
            db._conn.execute(
                "UPDATE sessions SET started_at = ?, source = ? WHERE id = ?",
                (now_ts - 9 * 86400, "api", "s_old"),
            )
    finally:
        db.close()


def test_get_status_returns_expected_shape(monkeypatch, tmp_path) -> None:
    now_ts = datetime(2026, 5, 27, 12, 0, 0).timestamp()
    db_path = tmp_path / "state.db"
    _seed_sessions(db_path, now_ts)

    monkeypatch.setattr(overview_service, "SessionDB", lambda: SessionDB(db_path=db_path))
    monkeypatch.setattr(overview_service.time, "time", lambda: now_ts)
    monkeypatch.setattr(overview_service, "get_active_profile_name", lambda: "aisoc")

    payload = overview_service.get_status()

    assert set(payload.keys()) == {
        "status",
        "model",
        "provider",
        "profile",
        "uptime_seconds",
        "last_activity",
    }
    assert payload["status"] in {"ONLINE", "IDLE"}
    assert payload["profile"] == "aisoc"


def test_get_stats_returns_expected_fields(monkeypatch, tmp_path) -> None:
    now_ts = datetime(2026, 5, 27, 12, 0, 0).timestamp()
    db_path = tmp_path / "state.db"
    _seed_sessions(db_path, now_ts)

    monkeypatch.setattr(overview_service, "SessionDB", lambda: SessionDB(db_path=db_path))
    monkeypatch.setattr(overview_service.time, "time", lambda: now_ts)
    monkeypatch.setattr(
        overview_service.cron_service,
        "list_jobs",
        lambda profile="all": [
            {"id": "j1", "enabled": True},
            {"id": "j2", "enabled": False},
        ],
    )
    monkeypatch.setattr(
        overview_service.memory_service,
        "read_soul",
        lambda: {"content": "A" * 10},
    )
    monkeypatch.setattr(
        overview_service.memory_service,
        "read_user_preferences",
        lambda: {"content": "B" * 20},
    )
    monkeypatch.setattr(
        overview_service,
        "load_config",
        lambda: {"memory": {"memory_char_limit": 100, "user_char_limit": 50}},
    )

    payload = overview_service.get_stats()

    assert set(payload.keys()) == {
        "total_sessions",
        "active_sessions",
        "today_tokens",
        "today_input_tokens",
        "today_output_tokens",
        "cron_jobs_total",
        "cron_jobs_enabled",
        "memory_used_chars",
        "memory_total_chars",
        "memory_percent",
        "source_distribution",
    }
    assert payload["total_sessions"] == 3
    assert payload["active_sessions"] == 1
    assert payload["today_input_tokens"] == 300
    assert payload["today_output_tokens"] == 150
    assert payload["today_tokens"] == 450
    assert payload["cron_jobs_total"] == 2
    assert payload["cron_jobs_enabled"] == 1
    assert payload["memory_used_chars"] == 30
    assert payload["memory_total_chars"] == 150
    assert payload["source_distribution"] == {"api": 1, "cli": 1, "cron": 1}


def test_get_token_trend_returns_daily_rows(monkeypatch, tmp_path) -> None:
    now_ts = datetime(2026, 5, 27, 12, 0, 0).timestamp()
    db_path = tmp_path / "state.db"
    _seed_sessions(db_path, now_ts)

    monkeypatch.setattr(overview_service, "SessionDB", lambda: SessionDB(db_path=db_path))
    monkeypatch.setattr(overview_service.time, "time", lambda: now_ts)

    rows = overview_service.get_token_trend(days=7)

    assert len(rows) == 7
    assert set(rows[0].keys()) == {
        "date",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "sessions",
    }

    last = rows[-1]
    assert last["input_tokens"] == 300
    assert last["output_tokens"] == 150
    assert last["total_tokens"] == 450
    assert last["sessions"] == 2
