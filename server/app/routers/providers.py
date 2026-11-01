# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# REST endpoints for optional Android TV Remote providers. Exposes discovery health,
# persistent provider enablement and device-scoped catalogs, guide, browsing, profiles,
# observed playback and typed commands through the shared provider registry. All routes
# inherit the appliance's existing API authentication and error envelope.
"""Generic, selected-TV optional provider HTTP API."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request

from ..providers.models import Command, CommandResult, Integration, ProviderEnableRequest, ProviderStatus
from ..providers.registry import ProviderRegistry

router = APIRouter(tags=["providers"])


def get_provider_registry(request: Request) -> ProviderRegistry:
    """Return the application's lifecycle-owned provider facade."""
    return request.app.state.providers


ProviderDep = Annotated[ProviderRegistry, Depends(get_provider_registry)]


@router.get("/providers", response_model=list[ProviderStatus])
async def list_providers(providers: ProviderDep) -> list[ProviderStatus]:
    """List discovered provider health without credentials or private configuration."""
    return providers.list_providers()


@router.patch("/providers/{provider_id}", response_model=ProviderStatus)
async def set_provider_enabled(
    provider_id: str, body: ProviderEnableRequest, providers: ProviderDep,
) -> ProviderStatus:
    """Persist enablement and immediately stop using a disabled provider."""
    return await providers.set_enabled(provider_id, body.enabled)


@router.get("/devices/{device_id}/integrations", response_model=Integration)
async def get_integration(device_id: str, providers: ProviderDep) -> Integration:
    """Describe optional capabilities for this TV, including the no-provider state."""
    return providers.integration(device_id)


@router.get("/devices/{device_id}/catalog")
async def get_catalog(device_id: str, providers: ProviderDep) -> Any:
    """Return this TV/profile's validated app and service inventory."""
    return await providers.data(device_id, "catalog")


@router.get("/devices/{device_id}/browse")
async def browse(
    device_id: str, providers: ProviderDep,
    query: str | None = Query(default=None, max_length=1000),
    mode: str | None = Query(default=None, pattern="^(continue|search|all|new)$"),
    cursor: str | None = Query(default=None, max_length=2000),
) -> Any:
    """Return one bounded provider title page filtered for the selected TV/profile."""
    params = {key: value for key, value in {"query": query, "mode": mode, "cursor": cursor}.items() if value is not None}
    return await providers.data(device_id, "browse", params=params)


@router.get("/devices/{device_id}/titles/{title_id}")
async def title_detail(device_id: str, title_id: str, providers: ProviderDep) -> Any:
    """Return safe metadata and supported open/resume actions for one title."""
    return await providers.data(device_id, "titles", item_id=title_id)


@router.get("/devices/{device_id}/guide")
async def get_guide(
    device_id: str, providers: ProviderDep,
    from_time: str = Query(alias="from", max_length=100),
    to_time: str = Query(alias="to", max_length=100),
) -> Any:
    """Return authoritative channel intervals within an increasing <=24-hour window."""
    return await providers.data(device_id, "guide", params={"from": from_time, "to": to_time})


@router.get("/devices/{device_id}/profiles")
async def get_profiles(device_id: str, providers: ProviderDep) -> Any:
    """Return safe launcher profile choices, excluding streaming account administration."""
    return await providers.data(device_id, "profiles")


@router.get("/devices/{device_id}/playback")
async def get_playback(device_id: str, providers: ProviderDep) -> Any:
    """Return fresh observed provider playback, or null without inventing metadata."""
    return await providers.data(device_id, "playback")


@router.post("/devices/{device_id}/provider/commands", response_model=CommandResult)
async def provider_command(device_id: str, body: Command, providers: ProviderDep) -> CommandResult:
    """Run an allowlisted UUID-deduplicated command after per-TV state guards."""
    return await providers.command(device_id, body)
