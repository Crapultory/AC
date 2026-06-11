"""Global routing rule routes for Aegis backend."""

from __future__ import annotations

from fastapi import APIRouter, status

from aegis.backend.models import (
    GlobalRoutingRuleDeleteResponse,
    GlobalRoutingRuleListResponse,
    GlobalRoutingRuleResponse,
    GlobalRoutingRuleUpsertRequest,
)
from aegis.backend.services.routing_service import RoutingService


def build_routing_router(service: RoutingService | None = None) -> APIRouter:
    router = APIRouter(prefix="/api/routing", tags=["routing"])
    routing_service = service or RoutingService()

    @router.get("/global", response_model=GlobalRoutingRuleListResponse)
    async def list_global_rules() -> GlobalRoutingRuleListResponse:
        return GlobalRoutingRuleListResponse(rules=routing_service.list_global_rules())

    @router.get("/global/{rule_id}", response_model=GlobalRoutingRuleResponse)
    async def get_global_rule(rule_id: str) -> GlobalRoutingRuleResponse:
        return routing_service.get_global_rule(rule_id)

    @router.post(
        "/global",
        response_model=GlobalRoutingRuleResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_global_rule(
        body: GlobalRoutingRuleUpsertRequest,
    ) -> GlobalRoutingRuleResponse:
        return routing_service.create_global_rule(body)

    @router.put("/global/{rule_id}", response_model=GlobalRoutingRuleResponse)
    async def update_global_rule(
        rule_id: str,
        body: GlobalRoutingRuleUpsertRequest,
    ) -> GlobalRoutingRuleResponse:
        return routing_service.update_global_rule(rule_id, body)

    @router.delete(
        "/global/{rule_id}",
        response_model=GlobalRoutingRuleDeleteResponse,
    )
    async def delete_global_rule(rule_id: str) -> GlobalRoutingRuleDeleteResponse:
        routing_service.delete_global_rule(rule_id)
        return GlobalRoutingRuleDeleteResponse(deleted=True, id=rule_id)

    return router
