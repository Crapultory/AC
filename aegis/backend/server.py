"""Aegis backend server entrypoint."""

from __future__ import annotations

import webbrowser

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
import uvicorn

from aegis.backend.auth import verify_bearer_token
from aegis.backend.config import AegisSettings, is_loopback_host, load_aegis_settings
from aegis.backend.routes.agents import build_agents_router
from aegis.backend.routes.auth import build_auth_router
from aegis.backend.routes.routing import build_routing_router
from aegis.backend.routes.system import build_system_router


PUBLIC_API_PATHS = frozenset(
    {
        "/api/auth/login",
        "/api/auth/session",
        "/api/auth/logout",
        "/health",
        "/api/system/bootstrap",
    }
)


def _format_browser_host(host: str) -> str:
    """Return a host string safe to embed in an HTTP URL."""
    if ":" in host and not host.startswith("["):
        return f"[{host}]"
    return host


def _install_docs_bearer_auth(app: FastAPI) -> None:
    """Add Swagger/OpenAPI bearer auth so docs can call protected APIs."""

    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema

        schema = get_openapi(
            title=app.title,
            version="0.1.0",
            description=(
                "Aegis backend API. Use the `Authorize` button in Swagger UI "
                "and provide `Bearer <token>` automatically via the token field."
            ),
            routes=app.routes,
        )

        components = schema.setdefault("components", {})
        security_schemes = components.setdefault("securitySchemes", {})
        security_schemes["bearerAuth"] = {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "Token",
            "description": (
                "Paste Aegis session token. Swagger will send "
                "`Authorization: Bearer <token>`."
            ),
        }
        schema["security"] = [{"bearerAuth": []}]

        app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = custom_openapi


def create_app(settings: AegisSettings | None = None) -> FastAPI:
    """Create the Aegis FastAPI application."""
    active_settings = settings or load_aegis_settings()
    app = FastAPI(title="Aegis Backend")
    app.state.aegis_settings = active_settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1",
            "http://localhost",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:9130",
            "http://localhost:3000",
            "http://localhost:9130",
        ],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        path = request.url.path
        if request.method != "OPTIONS" and path.startswith("/api/") and path not in PUBLIC_API_PATHS:
            try:
                verify_bearer_token(request, active_settings)
            except Exception as exc:
                detail = getattr(exc, "detail", "Unauthorized")
                return JSONResponse(status_code=401, content={"detail": detail})
        return await call_next(request)

    app.include_router(build_auth_router(active_settings))
    app.include_router(build_agents_router())
    app.include_router(build_routing_router())
    app.include_router(build_system_router(active_settings))
    _install_docs_bearer_auth(app)
    return app


def start_server(
    host: str = "127.0.0.1",
    port: int = 9130,
    open_browser: bool = True,
    allow_public: bool = False,
) -> None:
    """Start the Aegis backend server."""
    if not is_loopback_host(host) and not allow_public:
        raise SystemExit(
            "Refusing non-loopback bind without --insecure. "
            "Use --insecure to intentionally expose Aegis on the network."
        )

    settings = load_aegis_settings(
        host=host,
        port=port,
        open_browser=open_browser,
        allow_public=allow_public,
    )
    app = create_app(settings)

    if settings.token_source == "generated":
        print("Aegis session token (generated for this process):")
        print(settings.session_token)
    else:
        print("Aegis session token source: AEGIS_SESSION_TOKEN")

    if open_browser:
        try:
            webbrowser.open(f"http://{_format_browser_host(host)}:{port}/docs")
        except Exception:
            pass

    uvicorn.run(app, host=host, port=port, log_level="warning", proxy_headers=False)
