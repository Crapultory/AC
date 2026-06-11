from __future__ import annotations

import json
import os
import tempfile
import threading
from collections.abc import Callable, Mapping
from copy import deepcopy
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home


DEFAULT_A2A_PAYLOAD = {"a2a": {}, "global": []}


class AegisStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or (get_hermes_home() / "a2a.json")
        self._lock = threading.RLock()
        self._payload = self._load()

    def read_locked(self) -> dict[str, Any]:
        with self._lock:
            return self._payload

    def mutate_locked(self, mutator: Callable[[dict[str, Any]], Any]) -> Any:
        with self._lock:
            snapshot = deepcopy(self._payload)
            try:
                result = mutator(self._payload)
                self._normalize_payload(self._payload)
                self._write(self._payload)
            except Exception:
                self._payload.clear()
                self._payload.update(snapshot)
                raise
            return result

    def _load(self) -> dict[str, Any]:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            payload = deepcopy(DEFAULT_A2A_PAYLOAD)
            self._write(payload)
            return payload

        with self._path.open() as handle:
            payload = json.load(handle)

        normalized = self._normalize_payload(payload)
        if normalized:
            self._write(payload)
        return payload

    def _normalize_payload(self, payload: Any) -> bool:
        if not isinstance(payload, dict):
            raise ValueError("Aegis store payload must be a JSON object.")

        normalized = False
        if "a2a" not in payload:
            payload["a2a"] = {}
            normalized = True
        if "global" not in payload:
            payload["global"] = []
            normalized = True

        if not isinstance(payload["a2a"], Mapping):
            raise ValueError("Aegis store 'a2a' value must be a JSON object.")
        if not isinstance(payload["global"], list):
            raise ValueError("Aegis store 'global' value must be a JSON array.")

        if not isinstance(payload["a2a"], dict):
            payload["a2a"] = dict(payload["a2a"])
            normalized = True

        return normalized

    def _write(self, payload: Mapping[str, Any]) -> None:
        fd, tmp_path = tempfile.mkstemp(
            dir=str(self._path.parent),
            prefix=".a2a_",
            suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=False)
                handle.write("\n")
            Path(tmp_path).replace(self._path)
        except Exception:
            Path(tmp_path).unlink(missing_ok=True)
            raise


_STORE: AegisStore | None = None


def get_aegis_store() -> AegisStore:
    global _STORE
    if _STORE is None:
        _STORE = AegisStore()
    return _STORE
