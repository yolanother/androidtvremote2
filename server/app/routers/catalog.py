# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Catalog routes for the Android TV Remote appliance. Serves the static key catalog that
# tells a client which keys exist, what to label them, and how to group them in a UI, and
# the app catalog of one-tap launch targets. Both are read-only and identical for every
# device, so the web UI, the embed view, the tray app, and the MCP tools all render from
# the same source rather than each hard-coding their own list.
"""Catalog routes for the Android TV Remote appliance."""

from __future__ import annotations

from fastapi import APIRouter

from ..apps import APPS
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
