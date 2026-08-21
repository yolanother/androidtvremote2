# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Application factory for the Android TV Remote appliance. Builds the FastAPI app that
# serves all four consumer surfaces on one port: the built SPA at /, the REST API and its
# OpenAPI docs under /api, the WebSocket event stream at /api/ws, and the MCP server at
# /mcp when that module is present. It owns the lifespan that starts and stops the
# DeviceManager, the exception handlers that render every failure in the contract's error
# envelope, CORS, and the Content-Security-Policy that lets the embed view be framed by a
# home panel.
"""Application factory for the Android TV Remote appliance."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import Settings, get_settings
from .deps import ManagerDep, require_token
from .devices import DeviceManager
from .errors import RemoteError
from .models import HealthResponse
from .routers import catalog, devices, discovery, ws
from .vendored import AndroidTVRemote

LOGGER = logging.getLogger(__name__)

#: Directory the built SPA is expected in, relative to the repository root.
SPA_DIR = Path(__file__).resolve().parents[2] / "web" / "dist"


def create_app(
    settings: Settings | None = None,
    remote_factory: Callable[..., Any] = AndroidTVRemote,
    legacy_seed_path: Path | None = None,
) -> FastAPI:
    """Build the appliance's FastAPI application.

    :param settings: Configuration to use; defaults to the environment-derived singleton.
    :param remote_factory: Factory producing ``AndroidTVRemote``-compatible objects.
        Overridden by tests so the app can run without a TV on the network.
    :param legacy_seed_path: Location of the old build's ``paired_tvs.json``.
    :returns: The configured application, ready for uvicorn.
    """
    resolved = settings or get_settings()
    # Built here rather than inside the lifespan because mount_mcp() needs the manager at
    # mount time, before startup. Construction touches neither disk nor network; start()
    # is what opens the database and the connections.
    manager = DeviceManager(
        resolved, remote_factory=remote_factory, legacy_seed_path=legacy_seed_path
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """Run the DeviceManager for the life of the process."""
        await manager.start()
        try:
            yield
        finally:
            await manager.stop()

    app = FastAPI(
        title="Android TV Remote",
        version=__version__,
        description=(
            "Pair with and control Android TV and Google TV devices on the local network. "
            "Devices are identified by MAC address, so a DHCP lease change never breaks a "
            "pairing, and each device keeps its own certificate on the mounted data volume."
        ),
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = resolved
    app.state.devices = manager

    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def content_security_policy(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """Apply the configured ``frame-ancestors`` policy so /embed can be framed.

        :param request: The incoming request.
        :param call_next: The rest of the middleware chain.
        :returns: The response, with the CSP header attached.
        """
        response = await call_next(request)
        response.headers.setdefault(
            "content-security-policy", f"frame-ancestors {resolved.frame_ancestors}"
        )
        return response

    _install_error_handlers(app)

    api = APIRouter(prefix="/api", dependencies=[Depends(require_token)])
    api.include_router(devices.router)
    api.include_router(discovery.router)
    api.include_router(catalog.router)
    app.include_router(api)
    # The WebSocket authenticates inside the handler: a failed HTTP dependency cannot
    # close a WebSocket handshake with a meaningful code.
    app.include_router(ws.router, prefix="/api")

    @app.get(
        "/healthz",
        response_model=HealthResponse,
        tags=["health"],
        summary="Liveness and device summary",
        description="Never authenticated, so a container health check works with a token set.",
    )
    async def healthz(manager: ManagerDep) -> HealthResponse:
        """Report liveness and how many devices are connected.

        :param manager: The device manager.
        :returns: The health summary.
        """
        all_devices = manager.list_devices()
        return HealthResponse(
            devices=len(all_devices),
            connected=sum(1 for d in all_devices if d.state.connection == "connected"),
            version=__version__,
        )

    _mount_mcp(app, manager)
    _mount_spa(app)
    return app


def _install_error_handlers(app: FastAPI) -> None:
    """Render every failure in the contract's error envelope.

    :param app: The application to install handlers on.
    """

    @app.exception_handler(RemoteError)
    async def handle_remote_error(request: Request, exc: RemoteError) -> JSONResponse:
        """Translate a domain error into its documented status and envelope.

        :param request: The failing request.
        :param exc: The domain error raised.
        :returns: The error envelope with the exception's HTTP status.
        """
        return JSONResponse(status_code=exc.status, content=exc.to_dict())

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Translate a malformed body into the same envelope every other failure uses.

        The contract's code table does not cover request validation, and FastAPI's default
        422 body has a different shape; a client that parses ``error.code`` would break on
        it. ``invalid_request`` keeps one envelope across the whole API.

        :param request: The failing request.
        :param exc: The validation error raised.
        :returns: A 400 error envelope describing the first problem.
        """
        problems = exc.errors()
        message = "The request body is not valid"
        if problems:
            location = ".".join(str(part) for part in problems[0].get("loc", ())[1:])
            detail = problems[0].get("msg", message)
            message = f"{location}: {detail}" if location else detail
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "invalid_request", "message": message}},
        )


def _mount_mcp(app: FastAPI, manager: DeviceManager) -> None:
    """Mount the MCP server at /mcp when that module is present.

    ``app/mcp_server.py`` belongs to a separate workstream, so it is imported optionally
    and the appliance runs with or without it. Mounting goes through that module's own
    ``mount_mcp`` helper rather than ``app.mount("/mcp", ...)``: a mounted sub-app never
    receives ASGI lifespan events, so the MCP session manager would never start and the
    first request would fail with "Task group is not initialized". The helper also
    registers both ``/mcp`` and ``/mcp/``, because Starlette's Mount would answer the
    bare path with a 307 that the MCP client does not follow.

    :param app: The application to mount onto.
    :param manager: The device manager the MCP tools drive.
    """
    try:
        from . import mcp_server
    except ImportError:
        LOGGER.info("MCP server module is not present; /mcp will not be served")
        return
    try:
        mcp_server.mount_mcp(app, manager)
    except Exception:  # a broken MCP mount must not stop the remote working
        LOGGER.exception("Could not mount the MCP server; /mcp will not be served")


def _mount_spa(app: FastAPI) -> None:
    """Serve the built SPA at / with a history-API fallback, if it has been built.

    The dev workflow runs Vite separately and the container build may not include the SPA,
    so a missing directory is normal and must not stop the server from starting.

    :param app: The application to mount onto.
    """
    index = SPA_DIR / "index.html"
    if not index.is_file():
        LOGGER.info("No built SPA at %s; serving the API only", SPA_DIR)
        return

    assets = SPA_DIR / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    # The embeddable panel remote is a SECOND Vite entry, not a route inside the SPA.
    # Without this the catch-all below answers /embed with index.html and a home panel
    # silently gets the full app -- chrome, nav and all -- squeezed into a 240px iframe.
    embed = SPA_DIR / "embed.html"

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        """Serve a static file when one matches, otherwise the right HTML entry point.

        :param path: Requested path below the site root.
        :returns: The matching static file, ``embed.html`` for the embed route, or
            ``index.html`` for any other client-side route.
        """
        candidate = (SPA_DIR / path).resolve()
        if path and SPA_DIR in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        if embed.is_file() and (path == "embed" or path.startswith("embed/")):
            return FileResponse(embed)
        return FileResponse(index)


#: Module-level ASGI instance. The container entrypoint is ``uvicorn app.main:app``, which
#: imports a bound application rather than calling the factory.
app = create_app()
