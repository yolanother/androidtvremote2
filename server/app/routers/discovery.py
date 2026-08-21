# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Discovery routes for the Android TV Remote appliance. Serves the mDNS browser's cache of
# Android TVs seen on the LAN and accepts an out-of-band rescan request. Reading the cache
# never touches the network: the old Flask build slept three seconds inside the request
# handler to do this, which made the device list feel broken and blocked a worker thread.
"""Discovery routes for the Android TV Remote appliance."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from ..deps import ManagerDep
from ..models import DiscoveredDevice

router = APIRouter(prefix="/discovery", tags=["discovery"])


@router.get(
    "",
    response_model=list[DiscoveredDevice],
    summary="List TVs seen on the network",
    description=(
        "Returns the background browser's current cache immediately. Entries already in the "
        "registry are flagged with registered and device_id."
    ),
)
async def list_discovered(manager: ManagerDep) -> list[DiscoveredDevice]:
    """Return the discovery cache.

    :param manager: The device manager.
    :returns: Every TV currently known to the browser.
    """
    return manager.list_discovered()


@router.post(
    "/scan",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Kick an mDNS rescan",
    description="Returns immediately; refreshed results arrive over the /api/ws stream.",
)
async def rescan(manager: ManagerDep) -> Response:
    """Trigger an out-of-band rescan.

    :param manager: The device manager.
    :returns: An empty 202 response.
    """
    await manager.rescan()
    return Response(status_code=status.HTTP_202_ACCEPTED)
