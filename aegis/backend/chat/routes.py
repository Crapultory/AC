"""WebSocket chat routes for the Aegis backend."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, WebSocket, status
from starlette.websockets import WebSocketDisconnect

from aegis.backend.auth import get_current_user_from_token, require_authenticated_user
from aegis.backend.chat.service import ChatSessionManager
from aegis.backend.config import AegisSettings
from aegis.backend.models import ChatQuickCommandListResponse
from aegis.backend.services.agent_service import AgentService
from aegis.backend.services.chat_quick_command_service import (
    ChatQuickCommandService,
    QuickCommandResolutionError,
)
from aegis.backend.services.prompt_template_service import PromptTemplateService
from aegis.backend.services.prompt_template_store import PromptTemplateStore
from aegis.backend.services.system_instruct_service import SystemInstructService
from aegis.backend.services.system_instruct_store import SystemInstructStore
from aegis.backend.services.user_service import UserService


_DRAWER_HTML_DIR = Path(__file__).resolve().parents[2] / "docs"


def _ws_token(websocket: WebSocket) -> str | None:
    token = (websocket.query_params.get("token") or "").strip()
    return token or None


def build_chat_router(
    settings: AegisSettings,
    user_service: UserService,
    manager: ChatSessionManager | None = None,
    agent_service: AgentService | None = None,
    prompt_template_service: PromptTemplateService | None = None,
    system_instruct_service: SystemInstructService | None = None,
    quick_command_service: ChatQuickCommandService | None = None,
) -> APIRouter:
    router = APIRouter(tags=["chat"])
    session_manager = manager or ChatSessionManager()
    resolved_agent_service = agent_service or AgentService()
    resolved_prompt_template_service = prompt_template_service or PromptTemplateService(
        PromptTemplateStore()
    )
    resolved_system_instruct_service = system_instruct_service or SystemInstructService(
        SystemInstructStore()
    )
    resolved_quick_command_service = quick_command_service or ChatQuickCommandService(
        resolved_agent_service,
        resolved_prompt_template_service,
        resolved_system_instruct_service,
    )

    @router.post("/api/chat/attachments", status_code=status.HTTP_201_CREATED)
    async def upload_attachment(request: Request, file: UploadFile = File(...)) -> dict:
        user, _payload = require_authenticated_user(request, settings, user_service)
        attachment = await session_manager.attachments.upload(file, owner_id=user.uid)
        return {"attachment": attachment.public_dict()}

    @router.get("/api/chat/quick-commands", response_model=ChatQuickCommandListResponse)
    async def list_quick_commands(request: Request) -> ChatQuickCommandListResponse:
        """Return the authenticated user's available composer shortcuts."""
        user, _payload = require_authenticated_user(request, settings, user_service)
        return ChatQuickCommandListResponse(
            commands=resolved_quick_command_service.list_commands(user.uid)
        )

    @router.get("/api/chat/drawer-html")
    async def get_drawer_html(path: str, request: Request) -> dict[str, str]:
        """Return a bundled HTML document for the chat drawer test tab.

        This deliberately stays a thin test-only file lookup: the caller supplies
        the document name and receives its filename plus unmodified HTML.
        Authentication remains required because the route is still part of the
        Aegis console API.
        """
        require_authenticated_user(request, settings, user_service)
        try:
            content = (_DRAWER_HTML_DIR / path).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise HTTPException(status_code=404, detail="Drawer HTML document not found.") from exc
        return {"title": Path(path).name, "content": content}

    @router.websocket("/api/chat/ws")
    async def chat_ws(websocket: WebSocket) -> None:
        token = _ws_token(websocket)
        if not token:
            await websocket.close(code=4401)
            return
        current_user = None
        try:
            current_user, _payload = get_current_user_from_token(token, settings, user_service)
        except Exception:
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
                        user_id=current_user.uid if current_user is not None else None,
                        user_name=current_user.username if current_user is not None else None,
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
                    try:
                        resolved_text = resolved_quick_command_service.resolve_text(
                            current_user.uid if current_user is not None else "",
                            str(payload.get("text") or ""),
                        )
                        attachments = session_manager.attachments.resolve(
                            payload.get("attachments"),
                            owner_id=current_user.uid if current_user is not None else "",
                        )
                        actor.handle_message(
                            resolved_text,
                            client_msg_id=str(payload.get("client_msg_id") or "").strip() or None,
                            attachments=attachments,
                        )
                    except QuickCommandResolutionError as exc:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "code": "invalid_quick_command",
                                "message": str(exc),
                                "client_msg_id": str(payload.get("client_msg_id") or "").strip() or None,
                            }
                        )
                    except ValueError as exc:
                        await websocket.send_json(
                            {"type": "error", "code": "invalid_attachment", "message": str(exc)}
                        )
                    continue

                if event_type == "approval.respond":
                    actor.handle_approval_response(str(payload.get("choice") or ""))
                    continue

                if event_type == "clarify.respond":
                    actor.handle_clarify_response(str(payload.get("answer") or ""))
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
