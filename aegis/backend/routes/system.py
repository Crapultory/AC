"""System routes for Aegis backend."""

from __future__ import annotations

from fastapi import APIRouter

from aegis.backend.config import AegisSettings
from aegis.backend.models import HealthResponse, SystemBootstrapResponse


def build_system_router(settings: AegisSettings) -> APIRouter:
    router = APIRouter(tags=["system"])

    @router.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @router.get("/api/system/bootstrap", response_model=SystemBootstrapResponse)
    async def bootstrap() -> SystemBootstrapResponse:
        return SystemBootstrapResponse(
            embedded_chat=settings.embedded_chat,
            auth_scheme="jwt-password",
        )

    return router
