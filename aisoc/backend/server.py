"""AISOC backend server entrypoint."""

from __future__ import annotations

from pathlib import Path
import webbrowser

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from aisoc.backend.auth import verify_bearer_token
from aisoc.backend.config import AisocSettings, is_loopback_host, load_aisoc_settings
from aisoc.backend.routes.auth import build_auth_router
from aisoc.backend.routes.system import build_system_router


PUBLIC_API_PATHS = frozenset(
    {
        "/api/auth/login",
        "/api/auth/session",
        "/api/auth/logout",
        "/health",
        "/api/system/bootstrap",
    }
)


def create_app(settings: AisocSettings | None = None) -> FastAPI:
    """Create the AISOC FastAPI application."""
    active_settings = settings or load_aisoc_settings()
    app = FastAPI(title="AISOC Backend")
    app.state.aisoc_settings = active_settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1",
            "http://localhost",
            "http://127.0.0.1:9120",
            "http://localhost:9120",
        ],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        path = request.url.path
        if path.startswith("/api/") and path not in PUBLIC_API_PATHS:
            try:
                verify_bearer_token(request, active_settings)
            except Exception as exc:
                # Keep middleware response stable and explicit.
                detail = getattr(exc, "detail", "Unauthorized")
                return JSONResponse(status_code=401, content={"detail": detail})
        return await call_next(request)

    app.include_router(build_auth_router(active_settings))
    app.include_router(build_system_router(active_settings))

    if active_settings.dist_dir and active_settings.dist_dir.exists():
        app.mount("/assets", StaticFiles(directory=active_settings.dist_dir / "assets"), name="assets")

    return app


def start_server(
    host: str = "127.0.0.1",
    port: int = 9120,
    open_browser: bool = True,
    allow_public: bool = False,
    embedded_chat: bool = False,
) -> None:
    """Start the AISOC backend server."""
    if not is_loopback_host(host) and not allow_public:
        raise SystemExit(
            "Refusing non-loopback bind without --insecure. "
            "Use --insecure to intentionally expose AISOC on the network."
        )

    dist_dir = Path(__file__).resolve().parent / "web_dist"
    settings = load_aisoc_settings(
        host=host,
        port=port,
        open_browser=open_browser,
        allow_public=allow_public,
        embedded_chat=embedded_chat,
        dist_dir=dist_dir,
    )
    app = create_app(settings)

    if settings.token_source == "generated":
        print("AISOC session token (generated for this process):")
        print(settings.session_token)
    else:
        print("AISOC session token source: AISOC_SESSION_TOKEN")

    if open_browser:
        try:
            webbrowser.open(f"http://{host}:{port}/login")
        except Exception:
            pass

    uvicorn.run(app, host=host, port=port, log_level="warning", proxy_headers=False)
