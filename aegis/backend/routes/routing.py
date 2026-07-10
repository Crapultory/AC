"""Global routing rule routes for Aegis backend."""

from __future__ import annotations

from fastapi import APIRouter, Request, status

from aegis.backend.auth import require_admin_user, require_authenticated_user
from aegis.backend.config import AegisSettings
from aegis.backend.models import (
    GlobalRoutingRuleDeleteResponse,
    GlobalRoutingRuleListResponse,
    GlobalRoutingRuleResponse,
    GlobalRoutingRuleUpsertRequest,
)
from aegis.backend.services.routing_service import RoutingService
from aegis.backend.services.user_service import UserService


def build_routing_router(
    settings: AegisSettings,
    user_service: UserService,
    service: RoutingService | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/routing", tags=["routing"])

    def _service() -> RoutingService:
        return service or RoutingService()

    def _ensure_admin(request: Request) -> None:
        user, _payload = require_authenticated_user(request, settings, user_service)
        require_admin_user(user)

    @router.get("/global", response_model=GlobalRoutingRuleListResponse)
    async def list_global_rules(request: Request) -> GlobalRoutingRuleListResponse:
        _ensure_admin(request)
        return GlobalRoutingRuleListResponse(rules=_service().list_global_rules())

    @router.get("/global/{rule_id}", response_model=GlobalRoutingRuleResponse)
    async def get_global_rule(rule_id: str, request: Request) -> GlobalRoutingRuleResponse:
        _ensure_admin(request)
        return _service().get_global_rule(rule_id)

    @router.post(
        "/global",
        response_model=GlobalRoutingRuleResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_global_rule(
        body: GlobalRoutingRuleUpsertRequest,
        request: Request,
    ) -> GlobalRoutingRuleResponse:
        _ensure_admin(request)
        return _service().create_global_rule(body)

    @router.put("/global/{rule_id}", response_model=GlobalRoutingRuleResponse)
    async def update_global_rule(
        rule_id: str,
        body: GlobalRoutingRuleUpsertRequest,
        request: Request,
    ) -> GlobalRoutingRuleResponse:
        _ensure_admin(request)
        return _service().update_global_rule(rule_id, body)

    @router.delete(
        "/global/{rule_id}",
        response_model=GlobalRoutingRuleDeleteResponse,
    )
    async def delete_global_rule(rule_id: str, request: Request) -> GlobalRoutingRuleDeleteResponse:
        _ensure_admin(request)
        _service().delete_global_rule(rule_id)
        return GlobalRoutingRuleDeleteResponse(deleted=True, id=rule_id)

    return router
