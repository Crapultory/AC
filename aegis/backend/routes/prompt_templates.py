"""Authenticated CRUD routes for per-user reusable prompt templates."""

from __future__ import annotations

from fastapi import APIRouter, Request, status

from aegis.backend.auth import require_authenticated_user
from aegis.backend.config import AegisSettings
from aegis.backend.models import (
    PromptTemplateDeleteResponse,
    PromptTemplateListResponse,
    PromptTemplateRequest,
    PromptTemplateResponse,
)
from aegis.backend.services.prompt_template_service import PromptTemplateService


def build_prompt_templates_router(
    settings: AegisSettings,
    user_service,
    prompt_template_service: PromptTemplateService,
) -> APIRouter:
    router = APIRouter(prefix="/api/prompt-templates", tags=["prompt-templates"])

    def _user_id(request: Request) -> str:
        user, _payload = require_authenticated_user(request, settings, user_service)
        return user.uid

    @router.get("", response_model=PromptTemplateListResponse)
    async def list_templates(request: Request) -> PromptTemplateListResponse:
        return PromptTemplateListResponse(templates=prompt_template_service.list_templates(_user_id(request)))

    @router.post("", response_model=PromptTemplateResponse, status_code=status.HTTP_201_CREATED)
    async def create_template(body: PromptTemplateRequest, request: Request) -> PromptTemplateResponse:
        return prompt_template_service.create_template(_user_id(request), body)

    @router.put("/{template_id}", response_model=PromptTemplateResponse)
    async def update_template(
        template_id: str, body: PromptTemplateRequest, request: Request,
    ) -> PromptTemplateResponse:
        return prompt_template_service.update_template(template_id, _user_id(request), body)

    @router.delete("/{template_id}", response_model=PromptTemplateDeleteResponse)
    async def delete_template(template_id: str, request: Request) -> PromptTemplateDeleteResponse:
        prompt_template_service.delete_template(template_id, _user_id(request))
        return PromptTemplateDeleteResponse(deleted=True, id=template_id)

    return router
