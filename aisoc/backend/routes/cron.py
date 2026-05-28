"""Cron routes for AISOC backend."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from aisoc.backend.models import CronJobCreate, CronJobUpdate
from aisoc.backend.services import cron_service


def build_cron_router() -> APIRouter:
    router = APIRouter(prefix="/api/cron", tags=["cron"])

    @router.get("/jobs")
    async def list_jobs(profile: str = "all"):
        return cron_service.list_jobs(profile=profile)

    @router.get("/jobs/{job_id}")
    async def get_job(job_id: str, profile: str | None = None):
        job = cron_service.get_job(job_id, profile=profile)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job

    @router.get("/jobs/{job_id}/history")
    async def get_job_history(job_id: str):
        payload = cron_service.get_job_history(job_id)
        if payload is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return payload

    @router.post("/jobs")
    async def create_job(body: CronJobCreate, profile: str = "default"):
        return cron_service.create_job(
            profile,
            prompt=body.prompt,
            schedule=body.schedule,
            name=body.name,
            deliver=body.deliver,
        )

    @router.put("/jobs/{job_id}")
    async def update_job(job_id: str, body: CronJobUpdate, profile: str | None = None):
        job = cron_service.update_job(job_id, body.updates, profile=profile)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job

    @router.post("/jobs/{job_id}/pause")
    async def pause_job(job_id: str, profile: str | None = None):
        job = cron_service.pause_job(job_id, profile=profile)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job

    @router.post("/jobs/{job_id}/resume")
    async def resume_job(job_id: str, profile: str | None = None):
        job = cron_service.resume_job(job_id, profile=profile)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job

    @router.post("/jobs/{job_id}/trigger")
    async def trigger_job(job_id: str, profile: str | None = None):
        job = cron_service.trigger_job(job_id, profile=profile)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job

    @router.delete("/jobs/{job_id}")
    async def delete_job(job_id: str, profile: str | None = None):
        if not cron_service.remove_job(job_id, profile=profile):
            raise HTTPException(status_code=404, detail="Job not found")
        return {"ok": True}

    return router
