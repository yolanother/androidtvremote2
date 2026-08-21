# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# FastAPI dependency providers for the Android TV Remote appliance. Exposes the
# DeviceManager that the app factory attached to application state, the resolved Settings,
# and the authentication dependency applied to every /api router. These are the only
# supported way for a router, the MCP server, or any other surface to reach the manager,
# so all of them go through one object rather than constructing their own.
"""FastAPI dependency providers for the Android TV Remote appliance."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, Query, Request, WebSocket

from . import auth
from .config import Settings, get_settings
from .devices import DeviceManager


def get_device_manager(request: Request) -> DeviceManager:
    """Return the process-wide DeviceManager.

    :param request: The incoming request, carrying application state.
    :returns: The manager created by the app factory's lifespan.
    """
    manager: DeviceManager = request.app.state.devices
    return manager


def get_manager_from_app(app: object) -> DeviceManager:
    """Return the DeviceManager attached to an application, outside a request.

    Used by the WebSocket handler and the MCP server, neither of which has a ``Request``.

    :param app: The FastAPI application.
    :returns: The manager created by the app factory's lifespan.
    """
    manager: DeviceManager = app.state.devices  # type: ignore[attr-defined]
    return manager


def get_app_settings(request: Request) -> Settings:
    """Return the settings the app was created with.

    :param request: The incoming request, carrying application state.
    :returns: The resolved settings.
    """
    settings: Settings = getattr(request.app.state, "settings", None) or get_settings()
    return settings


def require_token(
    settings: Annotated[Settings, Depends(get_app_settings)],
    authorization: Annotated[str | None, Header()] = None,
    token: Annotated[str | None, Query()] = None,
) -> None:
    """Authenticate a request when ``REMOTE_API_TOKEN`` is configured.

    :param settings: The resolved settings.
    :param authorization: ``Authorization`` header, if the client sent one.
    :param token: ``?token=`` query parameter, for clients that cannot set headers.
    :raises Unauthorized: If a token is configured and the request did not present it.
    """
    auth.verify(settings, authorization, token)


def authenticate_websocket(websocket: WebSocket) -> None:
    """Authenticate a WebSocket handshake.

    A browser's ``WebSocket`` constructor cannot set headers, so the query form is the one
    that matters here; the header is still accepted for non-browser clients.

    :param websocket: The incoming WebSocket connection.
    :raises Unauthorized: If a token is configured and the handshake did not present it.
    """
    settings: Settings = getattr(websocket.app.state, "settings", None) or get_settings()
    auth.verify(
        settings,
        websocket.headers.get("authorization"),
        websocket.query_params.get(auth.TOKEN_QUERY_PARAM),
    )


#: Convenience alias for routers that need the manager.
ManagerDep = Annotated[DeviceManager, Depends(get_device_manager)]
