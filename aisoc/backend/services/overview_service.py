"""Overview service adapters."""

from __future__ import annotations

from datetime import date, datetime, time as dt_time, timedelta
from typing import Any
import time

from hermes_state import SessionDB
from hermes_cli.config import load_config
from hermes_cli.profiles import get_active_profile_name

from aisoc.backend.services import cron_service, memory_service


_STATUS_RECENT_WINDOW_SECONDS = 6 * 3600
_ACTIVE_SESSION_WINDOW_SECONDS = 24 * 3600
_DEFAULT_MEMORY_LIMIT = 2200
_DEFAULT_USER_LIMIT = 1375


def _today_start_ts(now_ts: float) -> float:
    now_dt = datetime.fromtimestamp(now_ts)
    return now_dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


def _query_one(db: SessionDB, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any]:
    with db._lock:
        row = db._conn.execute(sql, params).fetchone()
    return dict(row) if row else {}


def _query_all(db: SessionDB, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with db._lock:
        rows = db._conn.execute(sql, params).fetchall()
    return [dict(row) for row in rows]


def _memory_totals() -> tuple[int, int]:
    used = 0
    for reader in (memory_service.read_soul, memory_service.read_user_preferences):
        try:
            payload = reader()
        except Exception:
            continue
        used += len((payload or {}).get("content") or "")

    memory_total = _DEFAULT_MEMORY_LIMIT
    user_total = _DEFAULT_USER_LIMIT
    try:
        config = load_config()
        mem_cfg = (config or {}).get("memory") or {}
        memory_total = int(mem_cfg.get("memory_char_limit", _DEFAULT_MEMORY_LIMIT))
        user_total = int(mem_cfg.get("user_char_limit", _DEFAULT_USER_LIMIT))
    except Exception:
        pass
    return used, max(memory_total + user_total, 0)


def get_status() -> dict[str, Any]:
    now_ts = time.time()
    db = SessionDB()
    try:
        summary = _query_one(
            db,
            """
            SELECT
              COUNT(*) AS total_sessions,
              COALESCE(MAX(COALESCE(
                (SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id),
                s.started_at
              )), 0) AS last_activity,
              COALESCE(MIN(s.started_at), 0) AS first_seen
            FROM sessions s
            """,
        )
        latest = _query_one(
            db,
            """
            SELECT s.model, s.billing_provider
            FROM sessions s
            ORDER BY COALESCE(
                (SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id = s.id),
                s.started_at
            ) DESC, s.started_at DESC
            LIMIT 1
            """,
        )
    finally:
        db.close()

    total_sessions = int(summary.get("total_sessions") or 0)
    last_activity = float(summary.get("last_activity") or 0)
    first_seen = float(summary.get("first_seen") or 0)
    if total_sessions == 0:
        uptime_seconds = 0
    else:
        uptime_seconds = int(max(now_ts - first_seen, 0))

    status = "ONLINE" if last_activity and (now_ts - last_activity) < _STATUS_RECENT_WINDOW_SECONDS else "IDLE"
    try:
        profile = get_active_profile_name()
    except Exception:
        profile = "default"

    return {
        "status": status,
        "model": str(latest.get("model") or ""),
        "provider": str(latest.get("billing_provider") or ""),
        "profile": profile,
        "uptime_seconds": uptime_seconds,
        "last_activity": last_activity,
    }


def get_stats() -> dict[str, Any]:
    now_ts = time.time()
    today_start = _today_start_ts(now_ts)
    day_ago = now_ts - _ACTIVE_SESSION_WINDOW_SECONDS

    db = SessionDB()
    try:
        summary = _query_one(
            db,
            """
            SELECT
              COUNT(*) AS total_sessions,
              SUM(CASE WHEN s.started_at > ? AND s.ended_at IS NULL THEN 1 ELSE 0 END) AS active_sessions,
              SUM(CASE WHEN s.started_at >= ? THEN COALESCE(s.input_tokens, 0) ELSE 0 END) AS today_input_tokens,
              SUM(CASE WHEN s.started_at >= ? THEN COALESCE(s.output_tokens, 0) ELSE 0 END) AS today_output_tokens
            FROM sessions s
            """,
            (day_ago, today_start, today_start),
        )
        source_rows = _query_all(
            db,
            """
            SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS count
            FROM sessions
            GROUP BY COALESCE(source, 'unknown')
            ORDER BY source ASC
            """,
        )
    finally:
        db.close()

    jobs: list[dict[str, Any]]
    try:
        jobs = cron_service.list_jobs(profile="all")
    except Exception:
        jobs = []
    cron_total = len(jobs)
    cron_enabled = sum(1 for job in jobs if job.get("enabled", True))

    memory_used_chars, memory_total_chars = _memory_totals()
    memory_percent = round(memory_used_chars / memory_total_chars * 100, 1) if memory_total_chars > 0 else 0

    today_input_tokens = int(summary.get("today_input_tokens") or 0)
    today_output_tokens = int(summary.get("today_output_tokens") or 0)
    source_distribution = {str(row.get("source") or "unknown"): int(row.get("count") or 0) for row in source_rows}

    return {
        "total_sessions": int(summary.get("total_sessions") or 0),
        "active_sessions": int(summary.get("active_sessions") or 0),
        "today_tokens": today_input_tokens + today_output_tokens,
        "today_input_tokens": today_input_tokens,
        "today_output_tokens": today_output_tokens,
        "cron_jobs_total": cron_total,
        "cron_jobs_enabled": cron_enabled,
        "memory_used_chars": memory_used_chars,
        "memory_total_chars": memory_total_chars,
        "memory_percent": memory_percent,
        "source_distribution": source_distribution,
    }


def get_token_trend(days: int) -> list[dict[str, Any]]:
    now_ts = time.time()
    today = datetime.fromtimestamp(now_ts).date()
    start_day = today - timedelta(days=days - 1)
    start_ts = datetime.combine(start_day, dt_time.min).timestamp()
    end_ts = datetime.combine(today + timedelta(days=1), dt_time.min).timestamp()

    db = SessionDB()
    try:
        trend_rows = _query_all(
            db,
            """
            SELECT
              date(s.started_at, 'unixepoch', 'localtime') AS day,
              SUM(COALESCE(s.input_tokens, 0)) AS input_tokens,
              SUM(COALESCE(s.output_tokens, 0)) AS output_tokens,
              COUNT(*) AS sessions
            FROM sessions s
            WHERE s.started_at >= ? AND s.started_at < ?
            GROUP BY day
            """,
            (start_ts, end_ts),
        )
    finally:
        db.close()

    day_map = {str(row.get("day") or ""): row for row in trend_rows}
    results: list[dict[str, Any]] = []
    for i in range(days):
        current_day: date = start_day + timedelta(days=i)
        day_key = current_day.isoformat()
        row = day_map.get(day_key, {})
        input_tokens = int(row.get("input_tokens") or 0)
        output_tokens = int(row.get("output_tokens") or 0)
        sessions = int(row.get("sessions") or 0)
        results.append(
            {
                "date": current_day.strftime("%m-%d"),
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "sessions": sessions,
            }
        )
    return results
