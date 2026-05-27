"""Overview service adapters."""

from __future__ import annotations

from typing import Any


def get_status() -> dict[str, Any]:
    return {
        "status": "IDLE",
        "model": "",
        "provider": "",
        "profile": "",
        "uptime_seconds": 0,
        "last_activity": 0,
    }
