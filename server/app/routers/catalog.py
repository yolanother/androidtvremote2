# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Catalog routes for the Android TV Remote appliance. Serves the static key catalog that
# tells a client which keys exist, what to label them, and how to group them in a UI, the
# app catalog of one-tap launch targets, and the app icon endpoint that resolves any
# Android package id to real artwork through the cached Play Store lookup and its glyph
# and wordmark fallbacks. The two catalogs are read-only and identical for every device,
# so the web UI, the embed view, the tray app, and the MCP tools all render from the same
# source rather than each hard-coding their own list.
"""Catalog routes for the Android TV Remote appliance."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request, Response

from ..apps import APPS
from ..icons import IconServiceDep
from ..keys import keys_in_category
from ..models import AppDescriptor, KeyDescriptor

router = APIRouter(tags=["catalog"])


@router.get(
    "/keys",
    response_model=list[KeyDescriptor],
    summary="List every sendable key",
    description=(
        "Each entry carries the short form accepted by the keys endpoint, the full Android "
        "keycode, a display label, and the category to group it under."
    ),
)
async def list_keys(category: str | None = None) -> list[KeyDescriptor]:
    """Return the key catalog.

    :param category: Optional category to filter by.
    :returns: The matching key descriptors.
    """
    return keys_in_category(category)


@router.get(
    "/apps",
    response_model=list[AppDescriptor],
    summary="List launchable apps",
    description="The launch field is what the launch endpoint sends to the TV.",
)
async def list_apps() -> list[AppDescriptor]:
    """Return the app catalog.

    :returns: Every catalogued app.
    """
    return list(APPS)


@router.get(
    "/icons/{package}",
    response_class=Response,
    summary="Serve an app's icon",
    description=(
        "Resolves the package's artwork from the on-disk cache, then its Play Store listing, "
        "then a bundled brand glyph, then a generated wordmark tile. It always returns an "
        "image rather than a 404, so a launcher never renders a hole. Which rung answered is "
        "reported in X-Icon-Source. Pass refresh=1 to discard the cached copy and re-resolve."
    ),
    responses={
        200: {"content": {"image/png": {}, "image/svg+xml": {}}, "description": "The icon"},
        304: {"description": "The client's cached copy is still current"},
        400: {"description": "The package id is not a valid Android package id"},
    },
)
async def get_icon(
    package: str,
    request: Request,
    icons: IconServiceDep,
    refresh: bool = Query(default=False, description="Discard the cached icon and re-resolve."),
) -> Response:
    """Serve the icon for one Android package.

    :param package: The Android package id, validated before it reaches a URL or a path.
    :param request: The incoming request, read for a conditional ``If-None-Match``.
    :param icons: The application's icon service.
    :param refresh: Whether to bypass and replace the cached copy.
    :returns: The image, or a 304 when the client already holds this exact icon.
    :raises InvalidPackage: If ``package`` is not a well-formed Android package id.
    """
    icon = await icons.resolve(package, refresh=refresh)
    headers = {
        "cache-control": f"public, max-age={icon.max_age}",
        "etag": icon.etag,
        "x-icon-source": icon.source,
        # Cached icons may have been pinned by hand by an operator; never let a browser
        # second-guess the declared type of a file served from our own origin.
        "x-content-type-options": "nosniff",
    }
    supplied = request.headers.get("if-none-match", "")
    if any(tag.strip().removeprefix("W/") == icon.etag for tag in supplied.split(",")):
        return Response(status_code=304, headers=headers)
    return Response(content=icon.data, media_type=icon.media_type, headers=headers)
