"""AISOC backend API models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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
    pid: int


class SystemBootstrapResponse(BaseModel):
    auth_scheme: str


class SystemRestartResponse(BaseModel):
    accepted: bool
    already_requested: bool
    service: str
    pid: int


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


class CronJobRawUpdate(BaseModel):
    job: dict


class SkillToggleRequest(BaseModel):
    name: str
    enabled: bool


class MemoryWriteRequest(BaseModel):
    content: str


ChatQuickCommandType = Literal["agent", "prompt", "instruct"]


class ChatQuickCommandResponse(BaseModel):
    """One composer shortcut available in the chat module."""

    model_config = ConfigDict(extra="forbid")

    type: ChatQuickCommandType
    name: str
    desc: str
    content: str


class ChatQuickCommandListResponse(BaseModel):
    commands: list[ChatQuickCommandResponse] = Field(default_factory=list)


class DrawerFileResponse(BaseModel):
    """One workspace file prepared for a chat drawer preview."""

    model_config = ConfigDict(extra="forbid")

    title: str
    type: str
    content: str
