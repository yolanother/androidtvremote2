# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Tests for the mDNS discovery layer. Covers the address-selection rules that decide which
# of a TV's advertised addresses is actually connectable, the service-name parsing that
# produces a display name, and the DeviceManager side of discovery: entries are matched
# against the registry, a known TV appearing at a new address updates the registration in
# place instead of orphaning the pairing, and DISCOVERY_ENABLED=false starts no browser.
"""Tests for the mDNS discovery layer."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.config import Settings
from app.devices import DeviceManager
from app.discovery import display_name_of, entry_from_info, preferred_address

SHIELD = "SHIELD._androidtvremote2._tcp.local."
BRAVIA = "BRAVIA 4K GB._androidtvremote2._tcp.local."


def test_display_name_strips_the_service_type() -> None:
    """The UI shows ``SHIELD``, not the full service instance name."""
    assert display_name_of(SHIELD) == "SHIELD"
    assert display_name_of(BRAVIA) == "BRAVIA 4K GB"


def test_routable_ipv4_wins_over_link_local_ipv6() -> None:
    """Android TVs advertise link-local IPv6 that a container cannot connect to.

    The old build's cached discovery output shows exactly this: the real IPv4 buried in a
    list next to ``fe80::`` addresses.
    """
    assert (
        preferred_address(
            [
                "fde0:8f7d:ef57:3d1:303e:3921:3268:dd8f",
                "192.168.1.19",
                "fe80::c41c:a9ad:8c41:9a82",
            ]
        )
        == "192.168.1.19"
    )


def test_link_local_is_the_last_resort() -> None:
    """With nothing routable advertised, the link-local address is still returned."""
    assert preferred_address(["fe80::c41c:a9ad:8c41:9a82"]) == "fe80::c41c:a9ad:8c41:9a82"


def test_entry_from_info_needs_at_least_one_address() -> None:
    """A service that resolves to nothing is not reported."""
    assert entry_from_info(SHIELD, []) is None
    entry = entry_from_info(SHIELD, ["192.168.1.140"])
    assert entry is not None
    assert entry.host == "192.168.1.140"
    assert entry.addresses == ["192.168.1.140"]
    assert entry.registered is False


async def test_discovery_is_not_started_when_disabled(
    settings: Settings, fake_remote: Any, no_legacy_seeds: Path
) -> None:
    """``DISCOVERY_ENABLED=false`` opens no multicast socket at all.

    On a Docker bridge network the browser can never see anything, and the old build's
    silent empty list was indistinguishable from "no TVs on the network".
    """
    manager = DeviceManager(settings, remote_factory=fake_remote, legacy_seed_path=no_legacy_seeds)
    await manager.start()
    try:
        assert manager.settings.discovery_enabled is False
        assert manager._browser is None
    finally:
        await manager.stop()


async def test_a_discovered_entry_is_matched_to_its_registration(
    settings: Settings, fake_remote: Any, no_legacy_seeds: Path
) -> None:
    """A discovery entry at a registered device's address is flagged as registered."""
    manager = DeviceManager(settings, remote_factory=fake_remote, legacy_seed_path=no_legacy_seeds)
    await manager.start()
    try:
        device = await manager.add_device("192.168.1.23")
        entry = entry_from_info(BRAVIA, ["192.168.1.23"])
        assert entry is not None
        manager._on_discovered(entry)

        found = next(e for e in manager.list_discovered() if e.mdns_name == BRAVIA)
        assert found.registered is True
        assert found.device_id == device.id
    finally:
        await manager.stop()


async def test_a_known_tv_at_a_new_address_updates_the_registration(
    settings: Settings, fake_remote: Any, no_legacy_seeds: Path
) -> None:
    """Seeing a registered TV's service at a new address moves the device, not the identity.

    This is the DHCP-lease-change path: the mDNS service name is stable, so the manager
    updates ``host`` in place and reconnects, and the certificate keyed by the unchanged
    device id keeps working.
    """
    manager = DeviceManager(settings, remote_factory=fake_remote, legacy_seed_path=no_legacy_seeds)
    await manager.start()
    try:
        device = await manager.add_device("192.168.1.23")
        assert manager.get_device(device.id).mdns_name is None

        # First sighting over mDNS binds the service name to the existing registration.
        first = entry_from_info(BRAVIA, ["192.168.1.23"])
        assert first is not None
        manager._on_discovered(first)
        await manager.drain()
        assert manager.get_device(device.id).mdns_name == BRAVIA

        moved = entry_from_info(BRAVIA, ["192.168.1.99"])
        assert moved is not None
        manager._on_discovered(moved)
        await manager.drain()

        assert manager.get_device(device.id).host == "192.168.1.99"
        assert manager.get_device(device.id).id == device.id
    finally:
        await manager.stop()
