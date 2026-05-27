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


def test_started_outside_today_is_excluded_from_today_stats_and_today_trend(
    monkeypatch, tmp_path
) -> None:
    now_ts = datetime(2026, 5, 27, 12, 0, 0).timestamp()
    db_path = tmp_path / "state.db"
    _seed_sessions(db_path, now_ts)

    db = SessionDB(db_path=db_path)
    try:
        db.create_session("s_open_prev_day", "cli", model="gpt-5")
        db.update_token_counts("s_open_prev_day", input_tokens=999, output_tokens=777)
        with db._lock:
            db._conn.execute(
                "UPDATE sessions SET started_at = ?, ended_at = NULL WHERE id = ?",
                (now_ts - 36 * 3600, "s_open_prev_day"),
            )
    finally:
        db.close()

    monkeypatch.setattr(overview_service, "SessionDB", lambda: SessionDB(db_path=db_path))
    monkeypatch.setattr(overview_service.time, "time", lambda: now_ts)
    monkeypatch.setattr(overview_service.cron_service, "list_jobs", lambda profile="all": [])
    monkeypatch.setattr(overview_service.memory_service, "read_soul", lambda: {"content": ""})
    monkeypatch.setattr(
        overview_service.memory_service,
        "read_user_preferences",
        lambda: {"content": ""},
    )
    monkeypatch.setattr(
        overview_service,
        "load_config",
        lambda: {"memory": {"memory_char_limit": 2200, "user_char_limit": 1375}},
    )

    stats = overview_service.get_stats()
    trend = overview_service.get_token_trend(days=7)

    assert stats["today_input_tokens"] == 300
    assert stats["today_output_tokens"] == 150
    assert stats["today_tokens"] == 450
    assert trend[-1]["input_tokens"] == 300
    assert trend[-1]["output_tokens"] == 150
    assert trend[-1]["total_tokens"] == 450


def test_list_security_events_returns_minimum_shape(monkeypatch, tmp_path) -> None:
    now_ts = datetime(2026, 5, 27, 12, 0, 0).timestamp()
    db_path = tmp_path / "state.db"
    db = SessionDB(db_path=db_path)
    try:
        db.create_session("cron_alpha001_run_1", "cron", model="gpt-5")
        db.update_token_counts("cron_alpha001_run_1", input_tokens=90, output_tokens=30)
        db.end_session("cron_alpha001_run_1", "done")
        db.append_message(
            "cron_alpha001_run_1",
            "assistant",
            content="High risk observed for CVE-2026-1234 from 10.0.0.7",
        )
        with db._lock:
            db._conn.execute(
                "UPDATE sessions SET started_at = ?, ended_at = ?, title = ? WHERE id = ?",
                (now_ts - 400, now_ts - 200, "Daily vuln scan", "cron_alpha001_run_1"),
            )
    finally:
        db.close()

    monkeypatch.setattr(overview_service, "SessionDB", lambda: SessionDB(db_path=db_path))
    rows = overview_service.list_security_events(limit=15)

    assert isinstance(rows, list)
    assert len(rows) == 1
    assert {
        "session_id",
        "type_label",
        "icon",
        "time",
        "duration",
        "tokens",
        "status",
        "risk_level",
        "summary",
        "entities",
        "verdict",
    }.issubset(rows[0].keys())


def test_list_keywords_and_keyword_sessions_return_minimum_shape(monkeypatch, tmp_path) -> None:
    now_ts = datetime(2026, 5, 27, 12, 0, 0).timestamp()
    db_path = tmp_path / "state.db"
    db = SessionDB(db_path=db_path)
    try:
        db.create_session("s_kw_1", "cli", model="gpt-5")
        db.update_token_counts("s_kw_1", input_tokens=20, output_tokens=10)
        db.append_message("s_kw_1", "user", content="apollo network review checklist")

        db.create_session("s_kw_2", "api", model="gpt-5")
        db.update_token_counts("s_kw_2", input_tokens=15, output_tokens=5)
        db.append_message("s_kw_2", "user", content="apollo baseline hardening report")

        with db._lock:
            db._conn.execute(
                "UPDATE sessions SET started_at = ?, title = ?, message_count = 4 WHERE id = ?",
                (now_ts - 3000, "Apollo security review", "s_kw_1"),
            )
            db._conn.execute(
                "UPDATE sessions SET started_at = ?, title = ?, message_count = 4 WHERE id = ?",
                (now_ts - 2000, "Weekly apollo sync", "s_kw_2"),
            )
    finally:
        db.close()

    monkeypatch.setattr(overview_service, "SessionDB", lambda: SessionDB(db_path=db_path))
    monkeypatch.setattr(overview_service.time, "time", lambda: now_ts)

    keywords = overview_service.list_keywords()
    assert isinstance(keywords, list)
    assert keywords
    assert set(keywords[0].keys()) == {"word", "count", "lang"}

    sessions = overview_service.list_keyword_sessions("apollo")
    assert isinstance(sessions, list)
    assert sessions
    assert {
        "session_id",
        "title",
        "source",
        "started_at",
        "messages",
        "tokens",
    } == set(sessions[0].keys())


def test_get_cron_token_distribution_returns_totals_and_jobs_shape(monkeypatch, tmp_path) -> None:
    now_ts = datetime(2026, 5, 27, 12, 0, 0).timestamp()
    db_path = tmp_path / "state.db"
    db = SessionDB(db_path=db_path)
    try:
        db.create_session("cron_alpha001_run_1", "cron", model="gpt-5")
        db.update_token_counts("cron_alpha001_run_1", input_tokens=100, output_tokens=50)
        db.end_session("cron_alpha001_run_1", "done")

        db.create_session("s_non_cron_1", "cli", model="gpt-5")
        db.update_token_counts("s_non_cron_1", input_tokens=20, output_tokens=10)
        db.end_session("s_non_cron_1", "done")

        with db._lock:
            db._conn.execute(
                "UPDATE sessions SET started_at = ? WHERE id = ?",
                (now_ts - 1200, "cron_alpha001_run_1"),
            )
            db._conn.execute(
                "UPDATE sessions SET started_at = ? WHERE id = ?",
                (now_ts - 1400, "s_non_cron_1"),
            )
    finally:
        db.close()

    monkeypatch.setattr(overview_service, "SessionDB", lambda: SessionDB(db_path=db_path))
    monkeypatch.setattr(overview_service.time, "time", lambda: now_ts)
    monkeypatch.setattr(
        overview_service.cron_service,
        "list_jobs",
        lambda profile="all": [{"id": "alpha001", "name": "Alpha Job", "enabled": True}],
    )

    payload = overview_service.get_cron_token_distribution(period="today")

    assert set(payload.keys()) == {
        "period",
        "total_cron_tokens",
        "non_cron_tokens",
        "grand_total",
        "cron_percent",
        "jobs",
    }
    assert payload["period"] == "today"
    assert isinstance(payload["jobs"], list)
    assert payload["jobs"]
    assert set(payload["jobs"][0].keys()) == {
        "job_id",
        "name",
        "runs",
        "input_tokens",
        "output_tokens",
        "io_tokens",
        "cache_read",
        "cache_write",
        "percent_of_cron",
        "percent_of_total",
    }
