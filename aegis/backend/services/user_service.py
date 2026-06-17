from __future__ import annotations

import re
import secrets
import sqlite3
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from aegis.backend.auth import hash_password, verify_password
from aegis.backend.models import (
    AuthRegisterRequest,
    UserCreateRequest,
    UserResponse,
    UserStatus,
)
from aegis.backend.services.user_store import AegisUserStore, get_aegis_user_store


DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin123456"
DEFAULT_ADMIN_EMAIL = "admin@aegis.local"
DEFAULT_ADMIN_UID = "0000000000000001"
_USERNAME_RE = re.compile(r"^[a-z0-9_.-]{3,32}$")


def _utc_timestamp() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _normalize_username(username: str) -> str:
    return str(username or "").strip().lower()


def _normalize_email(email: str) -> str:
    return str(email or "").strip().lower()


class UserService:
    def __init__(self, store: AegisUserStore | None = None) -> None:
        self._store = store or get_aegis_user_store()

    def ensure_bootstrap_admin(self) -> None:
        existing = self._store.get_user_by_username(DEFAULT_ADMIN_USERNAME)
        if existing is not None:
            return

        self._store.create_user(
            {
                "uid": DEFAULT_ADMIN_UID,
                "username": DEFAULT_ADMIN_USERNAME,
                "passwd": hash_password(DEFAULT_ADMIN_PASSWORD),
                "email": DEFAULT_ADMIN_EMAIL,
                "status": "enabled",
                "create_time": _utc_timestamp(),
                "last_login": None,
            }
        )

    def list_users(self) -> list[UserResponse]:
        return [self._build_user_response(user) for user in self._store.list_users()]

    def get_user_by_uid(self, uid: str) -> UserResponse:
        user = self._store.get_user_by_uid(uid)
        if user is None:
            raise HTTPException(status_code=404, detail=f"User '{uid}' not found.")
        return self._build_user_response(user)

    def get_enabled_user_by_uid(self, uid: str) -> UserResponse:
        user = self.get_user_by_uid(uid)
        if user.status != "enabled":
            raise HTTPException(status_code=401, detail="Unauthorized")
        return user

    def register_user(self, body: AuthRegisterRequest) -> None:
        self._create_user(
            username=body.username,
            password=body.password,
            email=body.email,
            status="disabled",
        )

    def create_user(self, body: UserCreateRequest) -> UserResponse:
        stored = self._create_user(
            username=body.username,
            password=body.password,
            email=body.email,
            status=body.status,
        )
        return self._build_user_response(stored)

    def authenticate_user(self, username: str, password: str) -> UserResponse:
        normalized_username = _normalize_username(username)
        stored = self._store.get_user_by_username(normalized_username)
        if stored is None or not verify_password(password, str(stored.get("passwd") or "")):
            raise HTTPException(status_code=401, detail="Invalid username or password.")
        if stored["status"] != "enabled":
            raise HTTPException(status_code=403, detail="User account is disabled.")

        last_login = _utc_timestamp()
        self._store.update_last_login(stored["uid"], last_login)
        refreshed = self._store.get_user_by_uid(stored["uid"])
        assert refreshed is not None
        return self._build_user_response(refreshed)

    def change_password(self, uid: str, old_password: str, new_password: str) -> None:
        stored = self._require_user_row(uid)
        if not verify_password(old_password, str(stored.get("passwd") or "")):
            raise HTTPException(status_code=401, detail="Invalid username or password.")
        self._validate_password(new_password)
        self._store.update_password(uid, hash_password(new_password))

    def reset_password(self, uid: str, new_password: str) -> None:
        self._require_user_row(uid)
        self._validate_password(new_password)
        self._store.update_password(uid, hash_password(new_password))

    def update_status(self, uid: str, status: UserStatus) -> UserResponse:
        user = self._require_user_row(uid)
        if user["username"] == DEFAULT_ADMIN_USERNAME and status != "enabled":
            raise HTTPException(status_code=400, detail="The admin user cannot be disabled.")
        self._store.update_status(uid, status)
        refreshed = self._store.get_user_by_uid(uid)
        assert refreshed is not None
        return self._build_user_response(refreshed)

    def delete_user(self, uid: str) -> None:
        user = self._require_user_row(uid)
        if user["username"] == DEFAULT_ADMIN_USERNAME:
            raise HTTPException(status_code=400, detail="The admin user cannot be deleted.")
        self._store.delete_user(uid)

    def _create_user(
        self,
        *,
        username: str,
        password: str,
        email: str,
        status: UserStatus,
    ) -> dict[str, Any]:
        normalized_username = _normalize_username(username)
        normalized_email = _normalize_email(email)

        self._validate_username(normalized_username)
        self._validate_password(password)
        self._validate_email(normalized_email)

        if self._store.get_user_by_username(normalized_username) is not None:
            raise HTTPException(status_code=409, detail=f"Username '{normalized_username}' already exists.")

        for user in self._store.list_users():
            if user["email"] == normalized_email:
                raise HTTPException(status_code=409, detail=f"Email '{normalized_email}' already exists.")

        record = {
            "uid": self._generate_user_uid(),
            "username": normalized_username,
            "passwd": hash_password(password),
            "email": normalized_email,
            "status": status,
            "create_time": _utc_timestamp(),
            "last_login": None,
        }
        try:
            self._store.create_user(record)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="User already exists.") from exc
        return record

    def _require_user_row(self, uid: str) -> dict[str, Any]:
        user = self._store.get_user_by_uid(uid)
        if user is None:
            raise HTTPException(status_code=404, detail=f"User '{uid}' not found.")
        return user

    def _generate_user_uid(self) -> str:
        while True:
            candidate = secrets.token_hex(8)
            if self._store.get_user_by_uid(candidate) is None:
                return candidate

    @staticmethod
    def _validate_username(username: str) -> None:
        if not _USERNAME_RE.fullmatch(username):
            raise HTTPException(
                status_code=422,
                detail=(
                    "Username must be 3-32 characters and contain only lowercase letters, "
                    "numbers, dots, underscores, or hyphens."
                ),
            )

    @staticmethod
    def _validate_password(password: str) -> None:
        if len(str(password or "")) < 8:
            raise HTTPException(status_code=422, detail="Password must be at least 8 characters long.")

    @staticmethod
    def _validate_email(email: str) -> None:
        if "@" not in email or email.startswith("@") or email.endswith("@"):
            raise HTTPException(status_code=422, detail="A valid email address is required.")

    @staticmethod
    def _build_user_response(payload: dict[str, Any]) -> UserResponse:
        candidate = {
            "uid": payload["uid"],
            "username": payload["username"],
            "email": payload["email"],
            "status": payload["status"],
            "create_time": payload["create_time"],
            "last_login": payload.get("last_login"),
            "is_admin": payload["username"] == DEFAULT_ADMIN_USERNAME,
        }
        try:
            return UserResponse.model_validate(candidate)
        except ValidationError as exc:
            raise HTTPException(status_code=500, detail="Stored user is invalid.") from exc
