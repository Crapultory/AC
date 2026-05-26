"""System routes for AISOC backend."""

from __future__ import annotations

from fastapi import APIRouter

from aisoc.backend.config import AisocSettings
from aisoc.backend.models import HealthResponse, SystemBootstrapResponse


def build_system_router(settings: AisocSettings) -> APIRouter:
    router = APIRouter(tags=["system"])

    @router.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @router.get("/api/system/bootstrap", response_model=SystemBootstrapResponse)
    async def bootstrap() -> SystemBootstrapResponse:
        return SystemBootstrapResponse(
            embedded_chat=settings.embedded_chat,
            auth_scheme="bearer-token",
        )

    return router

