from __future__ import annotations

from urllib.parse import urlencode
import sys
import time

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from aisoc.backend.config import load_aisoc_settings
from aisoc.backend.server import create_app


skip_on_windows = pytest.mark.skipif(
    sys.platform.startswith("win"), reason="PTY bridge is POSIX-only"
)


@pytest.fixture
def chat_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AISOC_SESSION_TOKEN", "test-token")
    settings = load_aisoc_settings(embedded_chat=True)
    app = create_app(settings)
    return TestClient(app), settings.session_token


@skip_on_windows
class TestAisocChatWebSocket:
    def _url(self, token: str, **params: str) -> str:
        q = {"token": token, **params}
        return f"/api/chat/pty?{urlencode(q)}"

    def test_rejects_bad_token(self, chat_client):
        client, _token = chat_client
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect(self._url("wrong")):
                pass
        assert exc.value.code == 4401

    def test_streams_child_stdout_to_client(self, chat_client, monkeypatch):
        client, token = chat_client
        from aisoc.backend.services import tui_embed

        monkeypatch.setattr(
            tui_embed,
            "resolve_chat_argv",
            lambda resume=None, sidecar_url=None: (
                ["/bin/sh", "-c", "printf aisoc-pty-ok"],
                None,
                None,
            ),
        )
        with client.websocket_connect(self._url(token)) as conn:
            buf = b""
            deadline = time.monotonic() + 5.0
            while time.monotonic() < deadline:
                frame = conn.receive_bytes()
                if frame:
                    buf += frame
                if b"aisoc-pty-ok" in buf:
                    break
            assert b"aisoc-pty-ok" in buf

    def test_resume_parameter_is_forwarded(self, chat_client, monkeypatch):
        client, token = chat_client
        from aisoc.backend.services import tui_embed

        captured: dict[str, str | None] = {}

        def fake_resolve(resume=None, sidecar_url=None):
            captured["resume"] = resume
            return (["/bin/sh", "-c", "printf resume-ok"], None, None)

        monkeypatch.setattr(tui_embed, "resolve_chat_argv", fake_resolve)
        with client.websocket_connect(self._url(token, resume="sess-42")) as conn:
            try:
                conn.receive_bytes()
            except Exception:
                pass
        assert captured.get("resume") == "sess-42"

    def test_channel_param_propagates_sidecar_url(self, chat_client, monkeypatch):
        client, token = chat_client
        from aisoc.backend.services import tui_embed

        captured: dict[str, str | None] = {}

        def fake_resolve(resume=None, sidecar_url=None):
            captured["sidecar_url"] = sidecar_url
            return (["/bin/sh", "-c", "printf sidecar-ok"], None, None)

        monkeypatch.setattr(tui_embed, "resolve_chat_argv", fake_resolve)

        with client.websocket_connect(self._url(token, channel="abc-123")) as conn:
            try:
                conn.receive_bytes()
            except Exception:
                pass

        url = captured.get("sidecar_url") or ""
        assert url.startswith("ws://127.0.0.1:9120/api/chat/pub?")
        assert "channel=abc-123" in url
        assert "token=" in url

    def test_pub_broadcasts_to_events_subscribers(self, chat_client):
        client, token = chat_client
        from aisoc.backend.routes import chat as chat_routes

        qs = urlencode({"token": token, "channel": "broadcast-test"})
        pub_path = f"/api/chat/pub?{qs}"
        sub_path = f"/api/chat/events?{qs}"

        with client.websocket_connect(sub_path) as sub:
            deadline = time.monotonic() + 5.0
            while time.monotonic() < deadline:
                if chat_routes._event_channels.get("broadcast-test"):
                    break
                time.sleep(0.01)
            else:
                raise AssertionError("subscriber not registered in time")

            with client.websocket_connect(pub_path) as pub:
                pub.send_text('{"type":"tool.start","payload":{"tool_id":"a1"}}')
                received = sub.receive_text()

        assert "tool.start" in received
        assert '"tool_id":"a1"' in received


def test_chat_status_reflects_embedded_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AISOC_SESSION_TOKEN", "test-token")
    settings = load_aisoc_settings(embedded_chat=True)
    app = create_app(settings)
    client = TestClient(app)

    resp = client.get(
        "/api/chat/status", headers={"Authorization": "Bearer test-token"}
    )
    assert resp.status_code == 200
    assert resp.json()["embedded_chat"] is True
