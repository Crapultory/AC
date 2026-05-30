"""AISOC backend API models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AuthLoginRequest(BaseModel):
    token: str = Field(default="", description="Token entered by user on login page")


class AuthLoginResponse(BaseModel):
    authenticated: bool


class AuthSessionResponse(BaseModel):
    authenticated: bool
    token_source: str


class AuthLogoutResponse(BaseModel):
    logged_out: bool


class HealthResponse(BaseModel):
    status: str


class SystemBootstrapResponse(BaseModel):
    embedded_chat: bool
    auth_scheme: str


class CronJobCreate(BaseModel):
    name: str = ""
    prompt: str
    schedule: str
    deliver: str = "local"
    skills: list[str] = Field(default_factory=list)
    skill: str | None = None
    enabled_toolsets: list[str] | None = None
    model: str | None = None
    provider: str | None = None
    base_url: str | None = None
    script: str | None = None
    workdir: str | None = None
    no_agent: bool = False


class CronJobUpdate(BaseModel):
    updates: dict


class SkillToggleRequest(BaseModel):
    name: str
    enabled: bool


class MemoryWriteRequest(BaseModel):
    content: str
