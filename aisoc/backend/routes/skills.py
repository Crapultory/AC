"""Skills routes for AISOC backend."""

from __future__ import annotations

from fastapi import APIRouter

from aisoc.backend.models import SkillToggleRequest
from aisoc.backend.services import skill_service


def build_skills_router() -> APIRouter:
    router = APIRouter(prefix="/api/skills", tags=["skills"])

    @router.get("")
    async def get_skills():
        return skill_service.list_skills()

    @router.put("/toggle")
    async def toggle_skill(body: SkillToggleRequest):
        return skill_service.toggle_skill(body.name, body.enabled)

    @router.post("/reload")
    async def reload_skills():
        return {"ok": True, "reloaded": skill_service.reload_index()}

    return router

