"""Overview routes for AISOC backend."""

from __future__ import annotations

from fastapi import APIRouter

from aisoc.backend.services import overview_service


def build_overview_router() -> APIRouter:
    router = APIRouter(prefix="/api/overview", tags=["overview"])

    @router.get("/status")
    async def status():
        return overview_service.get_status()

    return router
