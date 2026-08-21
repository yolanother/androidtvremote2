# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Tests for the DeviceManager facade. These are the regression tests for the four bugs the
# backend rebuild exists to fix: certificates written to the process CWD instead of the
# mounted data directory, one shared certificate reused for every TV, IP address used as
# the device identity, and keep_reconnecting() never being called. They also cover the
# pairing state machine, idempotent power, absolute volume stepping, and the mapping from
# protocol-library failures onto the contract's error codes.
"""Tests for the DeviceManager facade."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from app.config import Settings
from app.devices import DeviceManager
from app.errors import (
    DeviceExists,
    DeviceNotFound,
    InvalidKey,
    InvalidPairingCode,
    NotPaired,
    PairingNotStarted,
    Unreachable,
)
from app.vendored import CannotConnect, InvalidAuth

LIVING_ROOM = "192.168.1.23"
BEDROOM = "192.168.1.19"


async def _manager(settings: Settings, fake_remote: Any, seeds: Path | None = None) -> DeviceManager:
    """Start a DeviceManager wired to the fake remote factory.

    :param settings: Test settings pointed at a temporary data directory.
    :param fake_remote: The FakeRemote class used as the remote factory.
    :param seeds: Legacy ``paired_tvs.json`` path; defaults to one that does not exist so
        tests never depend on the repository's real copy.
    :returns: A started manager. The caller is responsible for stopping it.
    """
    manager = DeviceManager(
        settings,
        remote_factory=fake_remote,
        legacy_seed_path=seeds or settings.data_dir / "no-such-paired_tvs.json",
    )
    await manager.start()
    return manager


async def _registered_and_paired(
    settings: Settings, fake_remote: Any, host: str = LIVING_ROOM, seeds: Path | None = None
) -> Any:
    """Start a manager with one device registered and paired.

    :param settings: Test settings.
    :param fake_remote: The FakeRemote class.
    :param host: Address to register the device at.
    :param seeds: Legacy seed file path, if the test cares.
    :returns: ``(manager, device)``.
    """
    manager = await _manager(settings, fake_remote, seeds)
    device = await manager.add_device(host)
    await manager.start_pairing(device.id)
    device = await manager.finish_pairing(device.id, "123456")
    return manager, device


# --------------------------------------------------------------------------------------
# Bug 1 + 2: certificates are per-device and live under the mounted data directory
# --------------------------------------------------------------------------------------


async def test_certs_are_written_under_data_dir_never_the_cwd(
    settings: Settings, fake_remote: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Registering a device writes its keypair under DATA_DIR, not the working directory.

    The old build passed the bare filenames ``cert.pem``/``key.pem`` to AndroidTVRemote,
    so they landed in the process CWD, which was never a mounted volume — every container
    rebuild destroyed the pairing.
    """
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    monkeypatch.chdir(cwd)

    manager = await _manager(settings, fake_remote)
    try:
        device = await manager.add_device(LIVING_ROOM)
        certfile, keyfile = settings.cert_paths(device.id)
        assert certfile.is_file() and keyfile.is_file()
        assert settings.data_dir in certfile.parents
        assert list(cwd.iterdir()) == []
    finally:
        await manager.stop()


async def test_each_device_gets_its_own_keypair(settings: Settings, fake_remote: Any) -> None:
    """Two registered TVs never share a certificate.

    The old build wrote one shared ``cert.pem``; pairing a second TV overwrote the first
    TV's identity and silently unpaired it.
    """
    fake_remote.identities = {
        LIVING_ROOM: ("Living Room TV", "AA:BB:CC:DD:EE:FF"),
        BEDROOM: ("Bedroom TV", "11:22:33:44:55:66"),
    }
    manager = await _manager(settings, fake_remote)
    try:
        first = await manager.add_device(LIVING_ROOM)
        second = await manager.add_device(BEDROOM)

        first_cert, _ = settings.cert_paths(first.id)
        second_cert, _ = settings.cert_paths(second.id)
        assert first_cert != second_cert
        assert first_cert.is_file() and second_cert.is_file()
        assert first_cert.parent.name == "aabbccddeeff"
        assert second_cert.parent.name == "112233445566"
    finally:
        await manager.stop()


async def test_registering_a_second_time_leaves_no_stray_cert_directories(
    settings: Settings, fake_remote: Any
) -> None:
    """The staging directory used before the MAC is known is always cleaned up."""
    manager = await _manager(settings, fake_remote)
    try:
        device = await manager.add_device(LIVING_ROOM)
        with pytest.raises(DeviceExists):
            await manager.add_device(LIVING_ROOM)
        assert [d.name for d in settings.certs_dir.iterdir()] == [device.id]
    finally:
        await manager.stop()


# --------------------------------------------------------------------------------------
# Bug 3: identity is the MAC address, not the IP
# --------------------------------------------------------------------------------------


async def test_device_id_is_the_mac_not_the_ip(settings: Settings, fake_remote: Any) -> None:
    """The device id is the MAC lowercased with colons stripped."""
    manager = await _manager(settings, fake_remote)
    try:
        device = await manager.add_device(LIVING_ROOM)
        assert device.id == "aabbccddeeff"
        assert device.mac == "aa:bb:cc:dd:ee:ff"
        assert device.host == LIVING_ROOM
        assert device.name == "Living Room TV"
    finally:
        await manager.stop()


async def test_dhcp_ip_change_preserves_pairing(settings: Settings, fake_remote: Any) -> None:
    """Moving a paired TV to a new address keeps its id, its certs, and its pairing.

    Keying devices by IP was the bug that orphaned a pairing whenever the DHCP lease
    changed, even though the certificate itself was still perfectly valid.
    """
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        cert_before, _ = settings.cert_paths(device.id)
        moved = await manager.update_device(device.id, host="192.168.1.99")

        assert moved.id == device.id
        assert moved.host == "192.168.1.99"
        assert moved.paired is True
        assert settings.cert_paths(moved.id)[0] == cert_before
        assert cert_before.is_file()
        assert len(manager.list_devices()) == 1
    finally:
        await manager.stop()


async def test_a_moved_device_reconnects_at_the_new_address(
    settings: Settings, fake_remote: Any
) -> None:
    """After a host change the manager holds a connection to the new address."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        await manager.update_device(device.id, host="192.168.1.99")
        live = [r for r in fake_remote.instances if r.connected]
        assert live and all(r.host == "192.168.1.99" for r in live)
    finally:
        await manager.stop()


async def test_registration_survives_a_manager_restart(
    settings: Settings, fake_remote: Any
) -> None:
    """Everything a restart used to destroy — the row, the certs, the pairing — survives."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    await manager.stop()

    restarted = await _manager(settings, fake_remote)
    try:
        devices = restarted.list_devices()
        assert [d.id for d in devices] == [device.id]
        assert devices[0].paired is True
        assert devices[0].name == "Living Room TV"
        assert settings.cert_paths(device.id)[0].is_file()
    finally:
        await restarted.stop()


# --------------------------------------------------------------------------------------
# Bug 4: keep_reconnecting is actually called
# --------------------------------------------------------------------------------------


async def test_keep_reconnecting_is_called_once_per_connection(
    settings: Settings, fake_remote: Any
) -> None:
    """The manager starts the library's reconnect supervisor exactly once per device."""
    manager, _ = await _registered_and_paired(settings, fake_remote)
    try:
        connected = [r for r in fake_remote.instances if r.connected]
        assert len(connected) == 1
        assert connected[0].keep_reconnecting_calls == 1
        assert connected[0].invalid_auth_callback is not None
    finally:
        await manager.stop()


async def test_restart_reconnects_every_paired_device(
    settings: Settings, fake_remote: Any
) -> None:
    """On startup each enabled+paired device gets a held connection and a supervisor."""
    manager, _ = await _registered_and_paired(settings, fake_remote)
    await manager.stop()
    fake_remote.instances = []

    restarted = await _manager(settings, fake_remote)
    try:
        connected = [r for r in fake_remote.instances if r.connected]
        assert len(connected) == 1
        assert connected[0].keep_reconnecting_calls == 1
        assert restarted.get_state("aabbccddeeff").connection == "connected"
    finally:
        await restarted.stop()


async def test_revoked_pairing_flips_the_device_to_unpaired(
    settings: Settings, fake_remote: Any
) -> None:
    """The invalid-auth callback surfaces a revoked pairing instead of retrying silently."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        remote = next(r for r in fake_remote.instances if r.connected)
        remote.invalid_auth_callback()
        assert manager.get_state(device.id).connection == "unpaired"
        await manager.drain()

        state = manager.get_state(device.id)
        assert state.connection == "unpaired"
        assert state.error
        assert manager.get_device(device.id).paired is False
    finally:
        await manager.stop()


async def test_commands_reuse_the_held_connection(settings: Settings, fake_remote: Any) -> None:
    """Sending keys never constructs a new connection; the old build did it per keypress."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        before = len(fake_remote.instances)
        await manager.send_key(device.id, "DPAD_UP")
        await manager.send_key(device.id, "DPAD_DOWN")
        assert len(fake_remote.instances) == before
    finally:
        await manager.stop()


# --------------------------------------------------------------------------------------
# Pairing state machine
# --------------------------------------------------------------------------------------


async def test_pairing_completes_and_marks_the_device_paired(
    settings: Settings, fake_remote: Any
) -> None:
    """A successful handshake stores the code and flips ``paired`` to true."""
    manager = await _manager(settings, fake_remote)
    try:
        device = await manager.add_device(LIVING_ROOM)
        assert device.paired is False
        await manager.start_pairing(device.id)
        paired = await manager.finish_pairing(device.id, "123456")
        assert paired.paired is True
        assert "123456" in [code for r in fake_remote.instances for code in r.pairing_codes]
    finally:
        await manager.stop()


async def test_completing_without_starting_is_rejected(
    settings: Settings, fake_remote: Any
) -> None:
    """``pair/complete`` before ``pair`` raises PairingNotStarted."""
    manager = await _manager(settings, fake_remote)
    try:
        device = await manager.add_device(LIVING_ROOM)
        with pytest.raises(PairingNotStarted):
            await manager.finish_pairing(device.id, "123456")
    finally:
        await manager.stop()


async def test_a_rejected_code_raises_invalid_pairing_code(
    settings: Settings, fake_remote: Any
) -> None:
    """The library's InvalidAuth becomes the contract's ``invalid_pairing_code``."""
    manager = await _manager(settings, fake_remote)
    try:
        device = await manager.add_device(LIVING_ROOM)
        await manager.start_pairing(device.id)
        fake_remote.finish_pairing_error = InvalidAuth
        with pytest.raises(InvalidPairingCode):
            await manager.finish_pairing(device.id, "000000")
        assert manager.get_device(device.id).paired is False
    finally:
        await manager.stop()


async def test_pairing_session_times_out(settings: Settings, fake_remote: Any) -> None:
    """An unfinished pairing session is torn down and the device returns to unpaired."""
    manager = await _manager(settings, fake_remote)
    manager.pairing_timeout = 0.05
    try:
        device = await manager.add_device(LIVING_ROOM)
        await manager.start_pairing(device.id)
        await asyncio.sleep(0.15)
        with pytest.raises(PairingNotStarted):
            await manager.finish_pairing(device.id, "123456")
        assert manager.get_state(device.id).connection == "unpaired"
    finally:
        await manager.stop()


async def test_unpair_deletes_the_certificates(settings: Settings, fake_remote: Any) -> None:
    """Unpairing removes the keypair and keeps the registration."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        certfile, keyfile = settings.cert_paths(device.id)
        result = await manager.unpair(device.id)
        assert result.paired is False
        assert not certfile.exists() and not keyfile.exists()
        assert manager.get_device(device.id) is not None
    finally:
        await manager.stop()


async def test_remove_device_deletes_everything(settings: Settings, fake_remote: Any) -> None:
    """Removing a device drops the row and its certificate directory."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        certfile, _ = settings.cert_paths(device.id)
        await manager.remove_device(device.id)
        assert manager.list_devices() == []
        assert not certfile.parent.exists()
        with pytest.raises(DeviceNotFound):
            manager.get_device(device.id)
    finally:
        await manager.stop()


# --------------------------------------------------------------------------------------
# Control semantics
# --------------------------------------------------------------------------------------


async def test_power_is_idempotent(settings: Settings, fake_remote: Any) -> None:
    """``set_power`` only sends KEYCODE_POWER when the TV is not already in that state.

    Home Assistant retries commands; a non-idempotent power toggle turns the TV back off.
    """
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        remote = next(r for r in fake_remote.instances if r.connected)
        remote.push_is_on(True)

        await manager.set_power(device.id, True)
        assert remote.keys == []

        await manager.set_power(device.id, False)
        assert [key for key, _ in remote.keys] == ["KEYCODE_POWER"]
    finally:
        await manager.stop()


async def test_power_none_toggles_unconditionally(settings: Settings, fake_remote: Any) -> None:
    """``on=None`` sends the power key regardless of the reported state."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        remote = next(r for r in fake_remote.instances if r.connected)
        remote.push_is_on(True)
        await manager.set_power(device.id, None)
        assert [key for key, _ in remote.keys] == ["KEYCODE_POWER"]
    finally:
        await manager.stop()


async def test_absolute_volume_steps_from_the_reported_level(
    settings: Settings, fake_remote: Any
) -> None:
    """Setting a level issues exactly the number of up/down steps needed to reach it."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        remote = next(r for r in fake_remote.instances if r.connected)
        remote.push_volume(level=10, maximum=100, muted=False)

        await manager.set_volume(device.id, level=14)
        assert [key for key, _ in remote.keys] == ["KEYCODE_VOLUME_UP"] * 4

        remote.keys.clear()
        remote.push_volume(level=14, maximum=100, muted=False)
        await manager.set_volume(device.id, level=12)
        assert [key for key, _ in remote.keys] == ["KEYCODE_VOLUME_DOWN"] * 2

        remote.keys.clear()
        remote.push_volume(level=12, maximum=100, muted=False)
        await manager.set_volume(device.id, level=12)
        assert remote.keys == []
    finally:
        await manager.stop()


async def test_mute_and_unmute_respect_the_reported_mute_state(
    settings: Settings, fake_remote: Any
) -> None:
    """The protocol only has a mute toggle, so mute/unmute must check the current state."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        remote = next(r for r in fake_remote.instances if r.connected)
        remote.push_volume(level=10, maximum=100, muted=False)

        await manager.set_volume(device.id, action="unmute")
        assert remote.keys == []

        await manager.set_volume(device.id, action="mute")
        assert [key for key, _ in remote.keys] == ["KEYCODE_VOLUME_MUTE"]

        remote.keys.clear()
        remote.push_volume(level=10, maximum=100, muted=True)
        await manager.set_volume(device.id, action="toggle_mute")
        assert [key for key, _ in remote.keys] == ["KEYCODE_VOLUME_MUTE"]
    finally:
        await manager.stop()


async def test_repeat_sends_the_key_that_many_times(settings: Settings, fake_remote: Any) -> None:
    """``repeat`` drives volume ramps and fast scrolling."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        remote = next(r for r in fake_remote.instances if r.connected)
        await manager.send_key(device.id, "DPAD_DOWN", repeat=3)
        assert [key for key, _ in remote.keys] == ["KEYCODE_DPAD_DOWN"] * 3
    finally:
        await manager.stop()


async def test_text_and_launch_reach_the_tv(settings: Settings, fake_remote: Any) -> None:
    """Text is typed verbatim and a catalog slug is resolved to its launch target."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        remote = next(r for r in fake_remote.instances if r.connected)
        await manager.send_text(device.id, "stranger things")
        await manager.launch_app(device.id, "netflix")
        assert remote.texts == ["stranger things"]
        assert remote.launched == ["com.netflix.ninja"]
    finally:
        await manager.stop()


# --------------------------------------------------------------------------------------
# Error mapping
# --------------------------------------------------------------------------------------


async def test_unknown_device_raises_device_not_found(
    settings: Settings, fake_remote: Any
) -> None:
    """Any operation on an unregistered id raises DeviceNotFound."""
    manager = await _manager(settings, fake_remote)
    try:
        with pytest.raises(DeviceNotFound):
            manager.get_device("ffffffffffff")
        with pytest.raises(DeviceNotFound):
            await manager.send_key("ffffffffffff", "DPAD_UP")
    finally:
        await manager.stop()


async def test_registering_a_known_mac_raises_device_exists_with_the_device(
    settings: Settings, fake_remote: Any
) -> None:
    """A duplicate registration reports the existing device in ``error.details.device``."""
    manager = await _manager(settings, fake_remote)
    try:
        await manager.add_device(LIVING_ROOM)
        with pytest.raises(DeviceExists) as caught:
            await manager.add_device(LIVING_ROOM)
        assert caught.value.details["device"]["id"] == "aabbccddeeff"
    finally:
        await manager.stop()


async def test_commanding_an_unpaired_device_raises_not_paired(
    settings: Settings, fake_remote: Any
) -> None:
    """Control commands require a stored certificate."""
    manager = await _manager(settings, fake_remote)
    try:
        device = await manager.add_device(LIVING_ROOM)
        with pytest.raises(NotPaired):
            await manager.send_key(device.id, "DPAD_UP")
    finally:
        await manager.stop()


async def test_unknown_key_raises_invalid_key(settings: Settings, fake_remote: Any) -> None:
    """An unrecognized key is rejected before it reaches the TV."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        with pytest.raises(InvalidKey):
            await manager.send_key(device.id, "SELF_DESTRUCT")
    finally:
        await manager.stop()


async def test_registering_an_unreachable_host_raises_unreachable(
    settings: Settings, fake_remote: Any
) -> None:
    """A TV that does not answer during registration surfaces as ``unreachable``."""
    manager = await _manager(settings, fake_remote)
    try:
        fake_remote.connect_error = CannotConnect
        with pytest.raises(Unreachable):
            await manager.add_device("192.168.1.250")
        assert not list(settings.certs_dir.glob("*")) or manager.list_devices() == []
    finally:
        await manager.stop()


async def test_a_device_that_never_connected_reports_unreachable(
    settings: Settings, fake_remote: Any
) -> None:
    """Startup connection failures mark the device unreachable rather than raising."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    await manager.stop()
    fake_remote.connect_error = CannotConnect

    restarted = await _manager(settings, fake_remote)
    try:
        state = restarted.get_state(device.id)
        assert state.connection == "unreachable"
        assert state.error
        with pytest.raises(Unreachable):
            await restarted.send_key(device.id, "DPAD_UP")
    finally:
        await restarted.stop()


# --------------------------------------------------------------------------------------
# Events
# --------------------------------------------------------------------------------------


async def test_device_callbacks_publish_state_events(
    settings: Settings, fake_remote: Any
) -> None:
    """The four protocol callbacks feed the event bus so the UI never has to poll."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        with manager.event_bus.subscribe() as queue:
            remote = next(r for r in fake_remote.instances if r.connected)
            remote.push_is_on(True)
            remote.push_current_app("com.netflix.ninja")
            remote.push_volume(level=12, maximum=100, muted=False)

            seen = [await asyncio.wait_for(queue.get(), 1) for _ in range(3)]

        assert all(event["type"] == "device.state" for event in seen)
        assert all(event["device_id"] == device.id for event in seen)
        state = manager.get_state(device.id)
        assert state.is_on is True
        assert state.current_app == "com.netflix.ninja"
        assert state.volume is not None and state.volume.level == 12
    finally:
        await manager.stop()


async def test_disabling_a_device_drops_its_connection(
    settings: Settings, fake_remote: Any
) -> None:
    """A disabled device is disconnected and reports ``disabled``."""
    manager, device = await _registered_and_paired(settings, fake_remote)
    try:
        remote = next(r for r in fake_remote.instances if r.connected)
        updated = await manager.update_device(device.id, enabled=False)
        assert updated.enabled is False
        assert remote.disconnected is True
        assert manager.get_state(device.id).connection == "disabled"
    finally:
        await manager.stop()


async def test_legacy_paired_tvs_json_becomes_a_discovery_seed(
    settings: Settings, fake_remote: Any, tmp_path: Path
) -> None:
    """The old build's IP-keyed file is surfaced for registration, not turned into a row.

    It records no MAC, so importing it as a registry row would mean inventing an identity —
    the exact bug being fixed. It becomes a discovery entry the operator can register.
    """
    legacy = tmp_path / "paired_tvs.json"
    legacy.write_text('{"192.168.1.23": {"name": "BRAVIA 4K GB"}}', encoding="utf-8")

    manager = DeviceManager(settings, remote_factory=fake_remote, legacy_seed_path=legacy)
    await manager.start()
    try:
        seeds = manager.list_discovered()
        assert [seed.host for seed in seeds] == ["192.168.1.23"]
        assert seeds[0].display_name == "BRAVIA 4K GB"
        assert seeds[0].registered is False
        assert seeds[0].device_id is None
        assert manager.list_devices() == []
    finally:
        await manager.stop()


async def test_a_registered_seed_is_marked_registered(
    settings: Settings, fake_remote: Any, tmp_path: Path
) -> None:
    """Once the seeded TV is registered, the discovery entry points at the device."""
    legacy = tmp_path / "paired_tvs.json"
    legacy.write_text('{"192.168.1.23": {"name": "BRAVIA 4K GB"}}', encoding="utf-8")

    manager = DeviceManager(settings, remote_factory=fake_remote, legacy_seed_path=legacy)
    await manager.start()
    try:
        device = await manager.add_device(LIVING_ROOM)
        seed = manager.list_discovered()[0]
        assert seed.registered is True
        assert seed.device_id == device.id
    finally:
        await manager.stop()


# --------------------------------------------------------------------------------------
# Catalog passthroughs — the MCP tools reach the catalogs through this facade
# --------------------------------------------------------------------------------------


async def test_manager_exposes_the_key_catalog(settings: Settings, fake_remote: Any) -> None:
    """``list_keys`` is a sync passthrough, filterable by category."""
    manager = await _manager(settings, fake_remote)
    try:
        assert any(k.key == "DPAD_UP" for k in manager.list_keys())
        volume = manager.list_keys("volume")
        assert volume and all(k.category == "volume" for k in volume)
        assert manager.list_keys("nonsense") == []
    finally:
        await manager.stop()


async def test_manager_exposes_the_app_catalog(settings: Settings, fake_remote: Any) -> None:
    """``list_apps`` is a sync passthrough over the app catalog."""
    manager = await _manager(settings, fake_remote)
    try:
        assert any(a.id == "netflix" for a in manager.list_apps())
    finally:
        await manager.stop()
