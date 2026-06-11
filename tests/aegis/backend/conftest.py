from __future__ import annotations

import importlib
import sys
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient


def _clear_aegis_backend_modules() -> None:
    for module_name in list(sys.modules):
        if module_name == "aegis.backend" or module_name.startswith("aegis.backend."):
            sys.modules.pop(module_name, None)


@pytest.fixture
def load_backend(monkeypatch: pytest.MonkeyPatch):
    def _load(module_name: str):
        _clear_aegis_backend_modules()
        return importlib.import_module(module_name)

    return _load


@pytest.fixture
def client(load_backend, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    server = load_backend("aegis.backend.server")
    app = server.create_app()
    with TestClient(app) as test_client:
        yield test_client
