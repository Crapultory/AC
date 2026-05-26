"""Chat routes for AISOC backend."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from aisoc.backend.config import AisocSettings


def build_chat_router(settings: AisocSettings) -> APIRouter:
    router = APIRouter(prefix="/api/chat", tags=["chat"])

    @router.get("/status")
    async def chat_status():
        return {"embedded_chat": settings.embedded_chat, "ready": settings.embedded_chat}

    @router.get("/pty")
    async def pty_placeholder():
        raise HTTPException(status_code=501, detail="PTY transport is not wired yet")

    @router.get("/ws")
    async def ws_placeholder():
        raise HTTPException(status_code=501, detail="WS sidecar is not wired yet")

    @router.get("/events")
    async def events_placeholder():
        raise HTTPException(status_code=501, detail="Event stream is not wired yet")

    return router

