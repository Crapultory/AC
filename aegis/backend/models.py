"""Aegis backend API models."""

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

