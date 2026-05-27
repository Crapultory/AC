"""Overview routes for AISOC backend."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from aisoc.backend.services import overview_service


def build_overview_router() -> APIRouter:
    router = APIRouter(prefix="/api/overview", tags=["overview"])

    @router.get("/status")
    async def status():
        return overview_service.get_status()

    @router.get("/stats")
    async def stats():
        return overview_service.get_stats()

    @router.get("/token-trend")
    async def token_trend(days: int = 7):
        if days not in {7, 30}:
            raise HTTPException(status_code=422, detail="days must be 7 or 30")
        return overview_service.get_token_trend(days=days)

    @router.get("/cronjobs")
    async def cronjobs():
        return overview_service.get_cronjobs()

    @router.get("/cronjobs/{job_id}/history")
    async def cronjob_history(job_id: str):
        payload = overview_service.get_cronjob_history(job_id)
        if payload is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return payload

    @router.get("/sessions/{session_id}/detail")
    async def session_detail(session_id: str):
        payload = overview_service.get_session_detail(session_id)
        if not payload:
            raise HTTPException(status_code=404, detail="Session not found")
        return payload

    return router
