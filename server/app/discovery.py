# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Background mDNS/DNS-SD browser for the Android TV Remote appliance. Continuously watches
# the LAN for _androidtvremote2._tcp.local. services, resolves each one to its addresses,
# and hands the result to the DeviceManager's discovery cache so that GET /api/discovery
# is a dictionary read that returns immediately. The old Flask build blocked a request
# thread on time.sleep(3) to do this, and could see nothing at all from a bridge network;
# this browser runs for the lifetime of the process and is skipped entirely when
# DISCOVERY_ENABLED is false.
"""Background mDNS/DNS-SD browser for the Android TV Remote appliance."""

from __future__ import annotations

import asyncio
import ipaddress
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from zeroconf import ServiceStateChange
from zeroconf.asyncio import AsyncServiceBrowser, AsyncServiceInfo, AsyncZeroconf

from .config import Settings
from .models import DiscoveredDevice

LOGGER = logging.getLogger(__name__)

#: Service type Android TV devices advertise the remote protocol v2 on.
SERVICE_TYPE = "_androidtvremote2._tcp.local."

#: Milliseconds to wait for a service's addresses to resolve.
RESOLVE_TIMEOUT_MS = 3000


class DiscoveryBrowser:
    """Watches the LAN for Android TVs and reports each resolved service.

    :param settings: Resolved appliance configuration.
    :param on_device: Callback invoked with each resolved :class:`DiscoveredDevice`.
        It is called from the event loop and must not block.
    """

    def __init__(self, settings: Settings, on_device: Callable[[DiscoveredDevice], None]) -> None:
        """Initialize the browser without touching the network."""
        self.settings = settings
        self._on_device = on_device
        self._azc: AsyncZeroconf | None = None
        self._browser: AsyncServiceBrowser | None = None
        self._rescan_task: asyncio.Task[None] | None = None
        self._resolving: set[asyncio.Task[None]] = set()
        self._seen: set[str] = set()

    async def start(self) -> None:
        """Open the multicast socket and begin browsing, plus the periodic rescan loop."""
        self._azc = AsyncZeroconf()
        self._browser = AsyncServiceBrowser(
            self._azc.zeroconf, [SERVICE_TYPE], handlers=[self._on_state_change]
        )
        self._rescan_task = asyncio.create_task(self._rescan_loop())
        LOGGER.info("mDNS discovery started for %s", SERVICE_TYPE)

    async def stop(self) -> None:
        """Stop browsing and close the multicast socket."""
        if self._rescan_task is not None:
            self._rescan_task.cancel()
            self._rescan_task = None
        for task in list(self._resolving):
            task.cancel()
        self._resolving.clear()
        if self._browser is not None:
            await self._browser.async_cancel()
            self._browser = None
        if self._azc is not None:
            await self._azc.async_close()
            self._azc = None

    async def rescan(self) -> None:
        """Re-resolve every service seen so far, picking up address changes.

        This is what turns a DHCP lease change into a `host` update: the service name is
        stable, so re-resolving it yields the TV's new address under the same identity.
        """
        await asyncio.gather(*(self._resolve(name) for name in list(self._seen)))

    def _on_state_change(
        self,
        zeroconf: Any,
        service_type: str,
        name: str,
        state_change: ServiceStateChange,
    ) -> None:
        """Handle a service appearing, updating, or going away.

        Called synchronously by zeroconf's own thread, so resolution is scheduled rather
        than awaited here.

        :param zeroconf: The zeroconf instance reporting the change.
        :param service_type: Service type that changed.
        :param name: Full service instance name.
        :param state_change: What happened to the service.
        """
        if state_change is ServiceStateChange.Removed:
            self._seen.discard(name)
            return
        self._seen.add(name)
        task = asyncio.ensure_future(self._resolve(name))
        self._resolving.add(task)
        task.add_done_callback(self._resolving.discard)

    async def _resolve(self, name: str) -> None:
        """Resolve one service to its addresses and report it.

        :param name: Full service instance name.
        """
        if self._azc is None:
            return
        info = AsyncServiceInfo(SERVICE_TYPE, name)
        try:
            if not await info.async_request(self._azc.zeroconf, RESOLVE_TIMEOUT_MS):
                LOGGER.debug("Could not resolve %s", name)
                return
        except Exception:  # a failed resolve must never kill the browser
            LOGGER.debug("Error resolving %s", name, exc_info=True)
            return
        entry = entry_from_info(name, info.parsed_addresses())
        if entry is not None:
            self._on_device(entry)

    async def _rescan_loop(self) -> None:
        """Re-resolve every known service on the configured interval, forever."""
        while True:
            try:
                await asyncio.sleep(self.settings.discovery_interval)
                await self.rescan()
            except asyncio.CancelledError:
                return
            except Exception:  # the loop must outlive one bad rescan
                LOGGER.debug("Rescan failed", exc_info=True)


def entry_from_info(name: str, addresses: list[str]) -> DiscoveredDevice | None:
    """Build a discovery entry from a resolved service.

    :param name: Full service instance name, e.g. ``SHIELD._androidtvremote2._tcp.local.``.
    :param addresses: Every address the service resolved to, IPv4 and IPv6.
    :returns: The entry, or ``None`` when the service resolved to no usable address.
    """
    if not addresses:
        return None
    return DiscoveredDevice(
        mdns_name=name,
        display_name=display_name_of(name),
        addresses=addresses,
        host=preferred_address(addresses),
        registered=False,
        device_id=None,
        last_seen=datetime.now(UTC),
    )


def display_name_of(name: str) -> str:
    """Strip the service type off a service instance name.

    :param name: Full service instance name.
    :returns: Just the instance part, e.g. ``SHIELD``.
    """
    if name.endswith(f".{SERVICE_TYPE}"):
        return name[: -len(f".{SERVICE_TYPE}")]
    return name.removesuffix(".").removesuffix(SERVICE_TYPE.removesuffix("."))


def preferred_address(addresses: list[str]) -> str:
    """Pick the address to connect on, preferring a routable IPv4.

    Android TVs advertise link-local IPv6 alongside their real address, and connecting to
    the link-local one from a container fails; the routable IPv4 is what works.

    :param addresses: Every resolved address.
    :returns: The preferred address, falling back to the first one supplied.
    """
    routable_v4 = [a for a in addresses if _is_v4(a) and not _is_link_local(a)]
    if routable_v4:
        return routable_v4[0]
    routable = [a for a in addresses if not _is_link_local(a)]
    return routable[0] if routable else addresses[0]


def _is_v4(address: str) -> bool:
    """Whether an address is IPv4.

    :param address: Address to classify.
    :returns: ``True`` for a valid IPv4 address.
    """
    try:
        return isinstance(ipaddress.ip_address(address), ipaddress.IPv4Address)
    except ValueError:
        return False


def _is_link_local(address: str) -> bool:
    """Whether an address is link-local and therefore not generally routable.

    :param address: Address to classify.
    :returns: ``True`` for a link-local address.
    """
    try:
        return ipaddress.ip_address(address).is_link_local
    except ValueError:
        return False
