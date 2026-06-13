"""WebSocket chat routes for the Aegis backend."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect

from aegis.backend.auth import token_matches
from aegis.backend.chat.service import ChatSessionManager
from aegis.backend.config import AegisSettings


def _ws_token(websocket: WebSocket) -> str | None:
    token = (websocket.query_params.get("token") or "").strip()
    return token or None


def build_chat_router(
    settings: AegisSettings,
    manager: ChatSessionManager | None = None,
) -> APIRouter:
    router = APIRouter(tags=["chat"])
    session_manager = manager or ChatSessionManager()

    @router.websocket("/api/chat/ws")
    async def chat_ws(websocket: WebSocket) -> None:
        if not token_matches(_ws_token(websocket), settings):
            await websocket.close(code=4401)
            return

        await websocket.accept()
        actor = None
        try:
            while True:
                payload = await websocket.receive_json()
                if not isinstance(payload, dict):
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "invalid_payload",
                            "message": "Payload must be a JSON object.",
                        }
                    )
                    continue

                event_type = str(payload.get("type") or "").strip()
                if event_type == "session.bind":
                    actor = session_manager.bind(
                        websocket,
                        asyncio.get_running_loop(),
                        session_id=str(payload.get("session_id") or "").strip() or None,
                        title=str(payload.get("title") or "").strip() or None,
                    )
                    await websocket.send_json(
                        actor.build_bound_event(resumed=bool(payload.get("session_id")))
                    )
                    continue

                if actor is None:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "session_not_bound",
                            "message": "Bind a session before sending chat events.",
                        }
                    )
                    continue

                if event_type == "message.send":
                    actor.handle_message(
                        str(payload.get("text") or ""),
                        client_msg_id=str(payload.get("client_msg_id") or "").strip() or None,
                    )
                    continue

                if event_type == "approval.respond":
                    actor.handle_approval_response(str(payload.get("choice") or ""))
                    continue

                if event_type == "session.interrupt":
                    actor.interrupt()
                    continue

                if event_type == "session.resume":
                    for event in actor.resume_state_events():
                        await websocket.send_json(event)
                    continue

                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "unsupported_event",
                        "message": f"Unsupported websocket event: {event_type or '<empty>'}",
                    }
                )
        except WebSocketDisconnect:
            if actor is not None:
                actor.detach_connection(websocket)
    return router
