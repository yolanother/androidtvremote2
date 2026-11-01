# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# DNS-SD discovery for optional Android TV Remote data providers. Resolves only the
# project's version-one service advertisement into address/port/base-path endpoints,
# reports removals, and owns all multicast resolution tasks for deterministic shutdown.
"""Discover LAN providers without requiring multicast in a phone browser."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from zeroconf import ServiceStateChange
from zeroconf.asyncio import AsyncServiceBrowser, AsyncServiceInfo, AsyncZeroconf

from ..discovery import preferred_address

SERVICE_TYPE = "_atvr-provider._tcp.local."


class ProviderDiscovery:
    """Resolve version-one provider advertisements into registry endpoints.

    :param on_endpoint: Async callback receiving service name and URL, or None on removal.
    """

    def __init__(self, on_endpoint: Callable[[str, str | None], Awaitable[None]]) -> None:
        """Keep the callback without opening sockets."""
        self._on_endpoint = on_endpoint
        self._zeroconf: AsyncZeroconf | None = None
        self._browser: AsyncServiceBrowser | None = None
        self._tasks: set[asyncio.Task[None]] = set()
        self._generation: dict[str, int] = {}

    async def start(self) -> None:
        """Open a LAN browser for the project's provider service type."""
        self._zeroconf = AsyncZeroconf()
        self._browser = AsyncServiceBrowser(
            self._zeroconf.zeroconf, [SERVICE_TYPE], handlers=[self._changed],
        )

    async def stop(self) -> None:
        """Cancel resolution before closing multicast resources."""
        if self._browser is not None:
            await self._browser.async_cancel()
            self._browser = None
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        if self._zeroconf is not None:
            await self._zeroconf.async_close()
            self._zeroconf = None

    def _changed(
        self, zeroconf: Any, service_type: str, name: str, state_change: ServiceStateChange,
    ) -> None:
        """Schedule a generation-guarded resolve/removal on the appliance loop."""
        generation = self._generation.get(name, 0) + 1
        self._generation[name] = generation
        task = asyncio.create_task(self._resolve(name, generation, state_change))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _resolve(self, name: str, generation: int, state: ServiceStateChange) -> None:
        """Resolve a current advertisement; stale in-flight resolutions are ignored."""
        if state is ServiceStateChange.Removed:
            await self._on_endpoint(name, None)
            return
        if self._zeroconf is None:
            return
        info = AsyncServiceInfo(SERVICE_TYPE, name)
        try:
            if not await info.async_request(self._zeroconf.zeroconf, 3000):
                return
            addresses = info.parsed_addresses()
            version = info.properties.get(b"version", b"")
            path = info.properties.get(b"path", b"").decode("utf-8")
            if version != b"1" or path.rstrip("/") != "/atvr/v1" or not addresses:
                return
            if self._generation.get(name) != generation:
                return
            address = preferred_address(addresses)
            host = f"[{address}]" if ":" in address else address
            await self._on_endpoint(name, f"http://{host}:{info.port}/atvr/v1")
        except (OSError, UnicodeError, ValueError):
            return
