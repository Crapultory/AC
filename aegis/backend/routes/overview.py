"""Overview routes for Aegis backend."""

from __future__ import annotations

from fastapi import APIRouter, Request

from aegis.backend.auth import require_authenticated_user
from aegis.backend.config import AegisSettings
from aegis.backend.models import OverviewAgentListResponse, OverviewStatsResponse
from aegis.backend.services.agent_service import AgentService
from aegis.backend.services.delegate_security_service import DelegateSecurityService
from aegis.backend.services.user_service import UserService


def build_overview_router(
    settings: AegisSettings,
    user_service: UserService,
    agent_service: AgentService | None = None,
    delegate_security_service: DelegateSecurityService | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/overview", tags=["overview"])

    def _service() -> AgentService:
        return agent_service or AgentService()

    def _delegate_security_service() -> DelegateSecurityService:
        return delegate_security_service or DelegateSecurityService()

    def _ensure_authenticated(request: Request) -> None:
        require_authenticated_user(request, settings, user_service)

    @router.get("/agents", response_model=OverviewAgentListResponse)
    async def list_overview_agents(request: Request) -> OverviewAgentListResponse:
        _ensure_authenticated(request)
        return OverviewAgentListResponse(agents=_service().list_overview_agents())

    @router.get("/stats", response_model=OverviewStatsResponse)
    async def get_overview_stats(request: Request) -> OverviewStatsResponse:
        _ensure_authenticated(request)
        return _delegate_security_service().get_overview_stats()

    return router
