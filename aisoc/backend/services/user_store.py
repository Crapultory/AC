from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    passwd TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('enabled', 'disabled')),
    create_time TEXT NOT NULL,
    last_login TEXT,
    display_name TEXT
);
"""

_USER_COLUMNS = "uid, username, passwd, email, status, create_time, last_login, display_name"


class AisocUserStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or (get_hermes_home() / "aisoc.db")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        return conn

    def _initialize(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(SCHEMA_SQL)
            try:
                conn.execute("ALTER TABLE users ADD COLUMN display_name TEXT")
            except sqlite3.OperationalError:
                pass
            conn.commit()

    def list_users(self) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT {_USER_COLUMNS} FROM users ORDER BY username ASC"
            ).fetchall()
        return [dict(row) for row in rows]

    def get_user_by_uid(self, uid: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT {_USER_COLUMNS} FROM users WHERE uid = ?",
                (uid,),
            ).fetchone()
        return dict(row) if row is not None else None

    def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT {_USER_COLUMNS} FROM users WHERE username = ?",
                (username,),
            ).fetchone()
        return dict(row) if row is not None else None

    def create_user(self, record: dict[str, Any]) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO users (uid, username, passwd, email, status, create_time, last_login, display_name) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    record["uid"],
                    record["username"],
                    record["passwd"],
                    record["email"],
                    record["status"],
                    record["create_time"],
                    record.get("last_login"),
                    record.get("display_name") or record["username"],
                ),
            )
            conn.commit()

    def update_password(self, uid: str, passwd: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("UPDATE users SET passwd = ? WHERE uid = ?", (passwd, uid))
            conn.commit()

    def update_status(self, uid: str, status: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("UPDATE users SET status = ? WHERE uid = ?", (status, uid))
            conn.commit()

    def update_last_login(self, uid: str, last_login: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("UPDATE users SET last_login = ? WHERE uid = ?", (last_login, uid))
            conn.commit()

    def update_display_name(self, uid: str, display_name: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "UPDATE users SET display_name = ? WHERE uid = ?", (display_name, uid)
            )
            conn.commit()

    def delete_user(self, uid: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM users WHERE uid = ?", (uid,))
            conn.commit()


_STORE: AisocUserStore | None = None
_STORE_LOCK = threading.Lock()


def get_aisoc_user_store() -> AisocUserStore:
    global _STORE
    if _STORE is None:
        with _STORE_LOCK:
            if _STORE is None:
                _STORE = AisocUserStore()
    return _STORE
