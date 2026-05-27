"""Overview routes for AISOC backend."""

from __future__ import annotations

from fastapi import APIRouter
from typing import Literal

from aisoc.backend.services import overview_service


def build_overview_router() -> APIRouter:
    router = APIRouter(prefix="/api/overview", tags=["overview"])

    @router.get("/status")
    async def status():
        return overview_service.get_status()

    @router.get("/stats")
    async def stats():
        return overview_service.get_stats()

    @router.get("/token-trend")
    async def token_trend(days: Literal["7", "30"] = "7"):
        return overview_service.get_token_trend(days=int(days))

    return router
