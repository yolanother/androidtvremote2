# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# DeviceManager: the single facade every surface of the Android TV Remote appliance goes
# through. It owns the SQLite registry, one long-lived AndroidTVRemote connection per
# enabled and paired device, the pairing state machine, the mDNS discovery cache, and the
# event bus that feeds the WebSocket stream. It is where the four pairing-loss bugs are
# fixed: certificates are per-device and written under the mounted data directory, the
# device identity is the MAC address rather than the mutable IP, connections are held open
# and supervised by the library's keep_reconnecting(), and control commands reuse the held
# connection instead of dialling the TV on every keypress.
"""DeviceManager: the single facade every surface of the appliance goes through."""

from __future__ import annotations

import asyncio
import logging
import shutil
import sqlite3
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .apps import resolve_app
from .config import Settings
from .errors import (
    DeviceExists,
    DeviceNotFound,
    InvalidPairingCode,
    NotPaired,
    PairingNotStarted,
    Unreachable,
)
from .events import Event, EventBus
from .keys import resolve_key
from .models import Device, DeviceState, DiscoveredDevice, VolumeInfo
from .storage import DeviceRecord, Registry, read_legacy_seeds
from .vendored import AndroidTVRemote, CannotConnect, ConnectionClosed, InvalidAuth

LOGGER = logging.getLogger(__name__)

#: Seconds a pairing session may stay open before it is torn down.
PAIRING_TIMEOUT = 120.0

#: Upper bound on the number of volume steps one absolute set_volume call may issue.
MAX_VOLUME_STEPS = 100

#: mDNS service type Android TV devices advertise the remote protocol on.
SERVICE_TYPE = "_androidtvremote2._tcp.local."


class _Connection:
    """Bookkeeping for one device's held connection and live state."""

    def __init__(self, state: DeviceState) -> None:
        """Initialize with the device's starting state and no remote."""
        #: The live AndroidTVRemote, or ``None`` when nothing is held.
        self.remote: Any = None
        #: Latest known state of the TV.
        self.state = state
        #: Pairing handshake in flight, if any.
        self.pairing: Any = None
        #: Task that tears the pairing session down when it times out.
        self.pairing_timer: asyncio.Task[None] | None = None


class DeviceManager:
    """Owns every registered TV: its registration, its certificates, and its connection.

    :param settings: Resolved appliance configuration.
    :param remote_factory: Callable producing an ``AndroidTVRemote``-compatible object.
        Overridden in tests so the manager can be exercised without a TV on the network.
    :param legacy_seed_path: Location of the old build's ``paired_tvs.json``. Its entries
        become discovery seeds; defaults to the path used by the Flask build.
    """

    def __init__(
        self,
        settings: Settings,
        remote_factory: Callable[..., Any] = AndroidTVRemote,
        legacy_seed_path: Path | None = None,
    ) -> None:
        """Initialize the manager without touching the database or the network."""
        self.settings = settings
        self.event_bus = EventBus()
        #: Seconds a pairing session stays open; lowered by tests.
        self.pairing_timeout = PAIRING_TIMEOUT

        self._remote_factory = remote_factory
        self._registry = Registry(settings.database_path)
        self._legacy_seed_path = (
            legacy_seed_path
            if legacy_seed_path is not None
            else Path(__file__).resolve().parents[2] / "src" / "api" / "paired_tvs.json"
        )
        self._records: dict[str, DeviceRecord] = {}
        self._connections: dict[str, _Connection] = {}
        self._discovered: dict[str, DiscoveredDevice] = {}
        self._browser: Any = None
        self._started = False
        #: Fire-and-forget work started from protocol callbacks. Awaited by stop() so no
        #: database write is still in flight when the connection is closed.
        self._background: set[asyncio.Task[Any]] = set()

    # -- lifecycle -------------------------------------------------------------------

    async def start(self) -> None:
        """Open the registry, restore every device, and start discovery.

        Enabled and paired devices get a connection attempt and a reconnect supervisor.
        A TV that is off or unplugged does not fail startup; it is simply marked
        ``unreachable`` and the library's backoff takes over.
        """
        if self._started:
            return
        await asyncio.to_thread(self._registry.open)
        self.settings.certs_dir.mkdir(parents=True, exist_ok=True)
        for record in await asyncio.to_thread(self._registry.list):
            self._records[record.id] = record
            self._connections[record.id] = _Connection(_initial_state(record))
        self._seed_discovery_from_legacy_file()
        self._started = True

        await asyncio.gather(
            *(
                self._open_connection(record.id)
                for record in self._records.values()
                if record.enabled and record.paired
            )
        )
        await self._start_discovery()

    async def stop(self) -> None:
        """Tear down every connection, the discovery browser, and the registry."""
        if not self._started:
            return
        self._started = False
        await self._stop_discovery()
        for device_id in list(self._connections):
            self._close_connection(device_id)
            self._cancel_pairing(device_id)
        await self.drain()
        await asyncio.to_thread(self._registry.close)

    async def drain(self) -> None:
        """Wait for work scheduled from protocol callbacks to finish.

        Callbacks arrive on the library's own task and cannot await, so anything they
        trigger that touches the database is scheduled in the background. Shutdown drains
        that work before closing the SQLite connection, and anything that needs to observe
        a callback's persisted effect can await this too.
        """
        while self._background:
            await asyncio.gather(*list(self._background), return_exceptions=True)

    # -- registry ---------------------------------------------------------------------

    def list_devices(self) -> list[Device]:
        """Return every registered device with its live state.

        :returns: All devices, oldest registration first.
        """
        return [self._to_device(record) for record in self._records.values()]

    def get_device(self, device_id: str) -> Device:
        """Return one registered device with its live state.

        :param device_id: MAC-derived device identifier.
        :returns: The device.
        :raises DeviceNotFound: If no such device is registered.
        """
        return self._to_device(self._record(device_id))

    def get_state(self, device_id: str) -> DeviceState:
        """Return the live state of one device.

        :param device_id: MAC-derived device identifier.
        :returns: The device's current state.
        :raises DeviceNotFound: If no such device is registered.
        """
        self._record(device_id)
        return self._connections[device_id].state

    async def add_device(self, host: str, name: str | None = None) -> Device:
        """Register a TV by address, deriving its permanent identity from its MAC.

        A keypair is generated into a staging directory first, because the certificate is
        needed to ask the TV for its name and MAC, and the MAC is what names the final
        certificate directory. The staging directory is then moved into place, so nothing
        is ever written to the process working directory.

        :param host: IP address or hostname of the TV.
        :param name: Display name; defaults to the name the TV reports.
        :returns: The newly registered device.
        :raises Unreachable: If the TV did not answer.
        :raises DeviceExists: If that MAC is already registered; the existing device is
            attached as ``details["device"]``.
        """
        staging = self.settings.certs_dir / f".pending-{uuid.uuid4().hex}"
        staging.mkdir(parents=True, exist_ok=True)
        try:
            remote = self._remote_factory(
                self.settings.client_name,
                str(staging / "cert.pem"),
                str(staging / "key.pem"),
                host,
            )
            await remote.async_generate_cert_if_missing()
            try:
                reported_name, mac = await remote.async_get_name_and_mac()
            except (CannotConnect, ConnectionClosed, OSError) as exc:
                raise Unreachable(f"Could not reach a TV at {host}") from exc

            device_id = mac.lower().replace(":", "")
            if device_id in self._records:
                raise DeviceExists(
                    f"A device with MAC {mac} is already registered",
                    details={"device": self.get_device(device_id).model_dump(mode="json")},
                )

            certs = self.settings.certs_dir / device_id
            if certs.exists():
                # Certificates from an earlier registration of this same TV. They may
                # still be paired, so they win over the staging pair we just generated.
                LOGGER.info("Reusing existing certificates for %s", device_id)
            else:
                staging.replace(certs)

            record = DeviceRecord(
                id=device_id,
                name=name or reported_name,
                host=host,
                mac=mac.lower(),
                mdns_name=self._mdns_name_for(host),
                model=_model_of(remote),
                paired=False,
                enabled=True,
                created_at=datetime.now(timezone.utc),
            )
            try:
                await asyncio.to_thread(self._registry.insert, record)
            except sqlite3.IntegrityError as exc:
                raise DeviceExists(f"A device with MAC {mac} is already registered") from exc

            self._records[device_id] = record
            self._connections[device_id] = _Connection(_initial_state(record))
            self._refresh_discovery_registration()
            device = self._to_device(record)
            self.event_bus.publish({"type": "device.added", "device": _dump(device)})
            self.event_bus.publish({"type": "discovery", "devices": _dump_all(self.list_discovered())})
            return device
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    async def update_device(
        self,
        device_id: str,
        *,
        name: str | None = None,
        host: str | None = None,
        enabled: bool | None = None,
    ) -> Device:
        """Change a device's name, address, or enabled flag.

        Changing ``host`` reconnects at the new address without touching the certificate,
        which is what makes a DHCP lease change survivable.

        :param device_id: MAC-derived device identifier.
        :param name: New display name, or ``None`` to leave unchanged.
        :param host: New address, or ``None`` to leave unchanged.
        :param enabled: New enabled flag, or ``None`` to leave unchanged.
        :returns: The updated device.
        :raises DeviceNotFound: If no such device is registered.
        """
        record = self._record(device_id)
        moved = host is not None and host != record.host
        toggled = enabled is not None and enabled != record.enabled

        record = await asyncio.to_thread(
            self._registry.update, device_id, name=name, host=host, enabled=enabled
        )
        self._records[device_id] = record

        if toggled and not record.enabled:
            self._close_connection(device_id)
            self._set_state(device_id, connection="disabled", error=None)
        elif (moved or toggled) and record.enabled and record.paired:
            self._close_connection(device_id)
            await self._open_connection(device_id)

        device = self._to_device(record)
        self.event_bus.publish({"type": "device.updated", "device": _dump(device)})
        return device

    async def remove_device(self, device_id: str) -> None:
        """Delete a device: its registration, its certificates, and its connection.

        :param device_id: MAC-derived device identifier.
        :raises DeviceNotFound: If no such device is registered.
        """
        self._record(device_id)
        self._cancel_pairing(device_id)
        self._close_connection(device_id)
        await asyncio.to_thread(self._registry.delete, device_id)
        shutil.rmtree(self.settings.certs_dir / device_id, ignore_errors=True)
        self._records.pop(device_id, None)
        self._connections.pop(device_id, None)
        self._refresh_discovery_registration()
        self.event_bus.publish({"type": "device.removed", "device_id": device_id})

    # -- pairing ----------------------------------------------------------------------

    async def start_pairing(self, device_id: str) -> None:
        """Begin the pairing handshake so the TV displays its code.

        The held connection is dropped first: pairing runs over a separate port and a
        stale command connection only gets in the way.

        :param device_id: MAC-derived device identifier.
        :raises DeviceNotFound: If no such device is registered.
        :raises Unreachable: If the TV did not answer.
        """
        record = self._record(device_id)
        self._cancel_pairing(device_id)
        self._close_connection(device_id)

        certfile, keyfile = self.settings.cert_paths(device_id)
        certfile.parent.mkdir(parents=True, exist_ok=True)
        remote = self._remote_factory(
            self.settings.client_name, str(certfile), str(keyfile), record.host
        )
        await remote.async_generate_cert_if_missing()
        try:
            await remote.async_start_pairing()
        except (CannotConnect, ConnectionClosed, OSError) as exc:
            raise Unreachable(f"Could not reach a TV at {record.host}") from exc

        connection = self._connections[device_id]
        connection.pairing = remote
        connection.pairing_timer = asyncio.create_task(self._expire_pairing(device_id))
        self._set_state(device_id, connection="unpaired", error=None)
        self.event_bus.publish(
            {"type": "pairing", "device_id": device_id, "status": "code_required", "error": None}
        )

    async def finish_pairing(self, device_id: str, code: str) -> Device:
        """Complete the pairing handshake with the code shown on the TV.

        :param device_id: MAC-derived device identifier.
        :param code: Pairing code the user read off the screen.
        :returns: The now-paired device.
        :raises DeviceNotFound: If no such device is registered.
        :raises PairingNotStarted: If no pairing session is open, including one that timed out.
        :raises InvalidPairingCode: If the TV rejected the code or the user cancelled.
        """
        self._record(device_id)
        connection = self._connections[device_id]
        remote = connection.pairing
        if remote is None:
            raise PairingNotStarted("No pairing session is open for this device")

        try:
            await remote.async_finish_pairing(code)
        except (InvalidAuth, ConnectionClosed) as exc:
            self.event_bus.publish(
                {
                    "type": "pairing",
                    "device_id": device_id,
                    "status": "failed",
                    "error": "The TV rejected the pairing code",
                }
            )
            raise InvalidPairingCode("The TV rejected the pairing code") from exc
        finally:
            self._cancel_pairing(device_id)

        record = await asyncio.to_thread(self._registry.update, device_id, paired=True)
        self._records[device_id] = record
        self.event_bus.publish(
            {"type": "pairing", "device_id": device_id, "status": "paired", "error": None}
        )
        if record.enabled:
            await self._open_connection(device_id)
        device = self._to_device(self._records[device_id])
        self.event_bus.publish({"type": "device.updated", "device": _dump(device)})
        return device

    async def unpair(self, device_id: str) -> Device:
        """Drop the pairing: disconnect and delete the device's certificates.

        :param device_id: MAC-derived device identifier.
        :returns: The device, now unpaired.
        :raises DeviceNotFound: If no such device is registered.
        """
        self._record(device_id)
        self._cancel_pairing(device_id)
        self._close_connection(device_id)
        shutil.rmtree(self.settings.certs_dir / device_id, ignore_errors=True)
        record = await asyncio.to_thread(self._registry.update, device_id, paired=False)
        self._records[device_id] = record
        self._set_state(device_id, connection="unpaired", error="This device is not paired")
        device = self._to_device(record)
        self.event_bus.publish({"type": "device.updated", "device": _dump(device)})
        return device

    # -- connections ------------------------------------------------------------------

    async def connect(self, device_id: str) -> DeviceState:
        """Open the held connection to a device if it is not already up.

        :param device_id: MAC-derived device identifier.
        :returns: The resulting device state.
        :raises DeviceNotFound: If no such device is registered.
        :raises NotPaired: If the device has no stored certificate.
        :raises Unreachable: If the TV did not answer.
        """
        record = self._record(device_id)
        if not record.paired:
            raise NotPaired("This device is not paired")
        state = await self._open_connection(device_id)
        if state.connection != "connected":
            raise Unreachable(state.error or f"Could not reach a TV at {record.host}")
        return state

    async def disconnect(self, device_id: str) -> DeviceState:
        """Close the held connection to a device.

        :param device_id: MAC-derived device identifier.
        :returns: The resulting device state.
        :raises DeviceNotFound: If no such device is registered.
        """
        self._record(device_id)
        self._close_connection(device_id)
        return self._set_state(device_id, connection="disconnected", error=None)

    # -- control ----------------------------------------------------------------------

    async def send_key(
        self, device_id: str, key: str, direction: str = "SHORT", repeat: int = 1
    ) -> None:
        """Send a key press over the held connection.

        :param device_id: MAC-derived device identifier.
        :param key: Short form or full keycode.
        :param direction: ``SHORT``, ``START_LONG``, or ``END_LONG``.
        :param repeat: How many times to send the key.
        :raises DeviceNotFound: If no such device is registered.
        :raises InvalidKey: If the key is not in the catalog.
        :raises NotPaired: If the device has no stored certificate.
        :raises Unreachable: If no connection is currently held.
        """
        keycode = resolve_key(key)
        remote = self._live_remote(device_id)
        self._guard(lambda: [remote.send_key_command(keycode, direction) for _ in range(repeat)])

    async def send_text(self, device_id: str, text: str) -> None:
        """Type text into the focused field on the TV.

        :param device_id: MAC-derived device identifier.
        :param text: Text to type.
        :raises DeviceNotFound: If no such device is registered.
        :raises NotPaired: If the device has no stored certificate.
        :raises Unreachable: If no connection is currently held.
        """
        remote = self._live_remote(device_id)
        self._guard(lambda: remote.send_text(text))

    async def launch_app(self, device_id: str, app: str) -> None:
        """Launch an app or open a deep link on the TV.

        :param device_id: MAC-derived device identifier.
        :param app: Catalog slug, package id, or deep-link URL.
        :raises DeviceNotFound: If no such device is registered.
        :raises NotPaired: If the device has no stored certificate.
        :raises Unreachable: If no connection is currently held.
        """
        target = resolve_app(app)
        remote = self._live_remote(device_id)
        self._guard(lambda: remote.send_launch_app_command(target))

    async def set_power(self, device_id: str, on: bool | None) -> DeviceState:
        """Turn the TV on or off, idempotently.

        The protocol only offers a power toggle, so a blind send would turn a TV that is
        already on back off. Reading ``is_on`` first is what makes this safe for a home
        automation system to retry.

        :param device_id: MAC-derived device identifier.
        :param on: Desired power state, or ``None`` to toggle unconditionally.
        :returns: The device state after the command.
        :raises DeviceNotFound: If no such device is registered.
        :raises NotPaired: If the device has no stored certificate.
        :raises Unreachable: If no connection is currently held.
        """
        remote = self._live_remote(device_id)
        state = self._connections[device_id].state
        if on is None or state.is_on != on:
            self._guard(lambda: remote.send_key_command("KEYCODE_POWER", "SHORT"))
        return self._connections[device_id].state

    async def set_volume(
        self, device_id: str, action: str | None = None, level: int | None = None
    ) -> DeviceState:
        """Step the volume, change the mute state, or drive the volume to a level.

        :param device_id: MAC-derived device identifier.
        :param action: ``up``, ``down``, ``mute``, ``unmute``, or ``toggle_mute``.
        :param level: Absolute level to reach, stepped from the reported level.
        :returns: The device state after the command.
        :raises DeviceNotFound: If no such device is registered.
        :raises NotPaired: If the device has no stored certificate.
        :raises Unreachable: If no connection is held, or the TV has not reported its
            volume yet and an absolute level was requested.
        """
        remote = self._live_remote(device_id)
        volume = self._connections[device_id].state.volume

        if level is not None:
            if volume is None or volume.level is None:
                raise Unreachable("The TV has not reported its volume level yet")
            target = min(level, volume.max) if volume.max else level
            delta = target - volume.level
            keycode = "KEYCODE_VOLUME_UP" if delta > 0 else "KEYCODE_VOLUME_DOWN"
            steps = min(abs(delta), MAX_VOLUME_STEPS)
            self._guard(lambda: [remote.send_key_command(keycode, "SHORT") for _ in range(steps)])
            return self._connections[device_id].state

        muted = volume.muted if volume else False
        if action == "up":
            self._guard(lambda: remote.send_key_command("KEYCODE_VOLUME_UP", "SHORT"))
        elif action == "down":
            self._guard(lambda: remote.send_key_command("KEYCODE_VOLUME_DOWN", "SHORT"))
        elif action == "toggle_mute" or (action == "mute" and not muted) or (action == "unmute" and muted):
            self._guard(lambda: remote.send_key_command("KEYCODE_VOLUME_MUTE", "SHORT"))
        return self._connections[device_id].state

    # -- discovery ---------------------------------------------------------------------

    def list_discovered(self) -> list[DiscoveredDevice]:
        """Return the current discovery cache without blocking.

        The old build slept three seconds inside the request handler; the browser now runs
        continuously in the background and this is a dictionary read.

        :returns: Every TV currently known to the browser or seeded from the legacy file.
        """
        return list(self._discovered.values())

    async def rescan(self) -> None:
        """Kick an out-of-band mDNS rescan. Results arrive over the event bus."""
        if self._browser is not None:
            await self._browser.rescan()

    def subscribe(self) -> AsyncIterator[Event]:
        """Stream appliance events until the subscriber is dropped for falling behind.

        :returns: An async iterator over event frames.
        """

        async def _iterate() -> AsyncIterator[Event]:
            with self.event_bus.subscribe() as queue:
                while True:
                    event = await queue.get()
                    if event is None:
                        return
                    yield event

        return _iterate()

    def snapshot(self) -> Event:
        """Build the full-state frame a WebSocket client receives on connect.

        :returns: A ``snapshot`` event carrying every device and discovery entry.
        """
        return {
            "type": "snapshot",
            "devices": _dump_all(self.list_devices()),
            "discovered": _dump_all(self.list_discovered()),
        }

    # -- internals ---------------------------------------------------------------------

    def _spawn(self, coroutine: Any) -> None:
        """Run work started from a synchronous protocol callback, tracked until it ends.

        The protocol library invokes its callbacks from its own task, so anything that has
        to await — a database write, a reconnect — is scheduled here. The task is held in a
        set so it is neither garbage collected mid-flight nor still running against the
        SQLite connection when :meth:`stop` closes it.

        :param coroutine: The coroutine to run.
        """
        task = asyncio.ensure_future(coroutine)
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    def _record(self, device_id: str) -> DeviceRecord:
        """Look up a registration.

        :param device_id: MAC-derived device identifier.
        :returns: The record.
        :raises DeviceNotFound: If no such device is registered.
        """
        record = self._records.get(device_id)
        if record is None:
            raise DeviceNotFound(f"No device with id {device_id}")
        return record

    def _to_device(self, record: DeviceRecord) -> Device:
        """Combine a stored record with its live state into the API model.

        :param record: The stored registration.
        :returns: The API-facing device.
        """
        return Device(
            id=record.id,
            name=record.name,
            host=record.host,
            mac=record.mac,
            mdns_name=record.mdns_name,
            model=record.model,
            paired=record.paired,
            enabled=record.enabled,
            created_at=record.created_at,
            state=self._connections[record.id].state,
        )

    def _live_remote(self, device_id: str) -> Any:
        """Return the held connection for a device, refusing to open one ad-hoc.

        :param device_id: MAC-derived device identifier.
        :returns: The held remote.
        :raises DeviceNotFound: If no such device is registered.
        :raises NotPaired: If the device has no stored certificate.
        :raises Unreachable: If no connection is currently held.
        """
        record = self._record(device_id)
        if not record.paired:
            raise NotPaired("This device is not paired")
        connection = self._connections[device_id]
        if connection.remote is None or connection.state.connection != "connected":
            raise Unreachable(connection.state.error or f"No live connection to {record.host}")
        return connection.remote

    def _guard(self, action: Callable[[], Any]) -> None:
        """Run a protocol call, translating a dropped connection into ``unreachable``.

        :param action: The protocol call to run.
        :raises Unreachable: If the connection was closed underneath us.
        """
        try:
            action()
        except ConnectionClosed as exc:
            raise Unreachable("The connection to the TV was closed") from exc

    async def _open_connection(self, device_id: str) -> DeviceState:
        """Build a remote, register callbacks, connect, and start the reconnect supervisor.

        Failure here is not an error: the device is marked ``unreachable`` and left for the
        library's own backoff, because a TV that is merely switched off must not stop the
        appliance from starting.

        :param device_id: MAC-derived device identifier.
        :returns: The resulting device state.
        """
        record = self._records[device_id]
        connection = self._connections[device_id]
        if connection.remote is not None and connection.state.connection == "connected":
            return connection.state

        certfile, keyfile = self.settings.cert_paths(device_id)
        remote = self._remote_factory(
            self.settings.client_name, str(certfile), str(keyfile), record.host
        )
        remote.add_is_on_updated_callback(lambda value: self._on_is_on(device_id, value))
        remote.add_current_app_updated_callback(lambda value: self._on_current_app(device_id, value))
        remote.add_volume_info_updated_callback(lambda value: self._on_volume(device_id, value))
        remote.add_is_available_updated_callback(lambda value: self._on_available(device_id, value))

        connection.remote = remote
        self._set_state(device_id, connection="connecting", error=None)
        try:
            await remote.async_connect()
        except InvalidAuth as exc:
            connection.remote = None
            LOGGER.info("Pairing for %s is no longer valid: %s", device_id, exc)
            await self._mark_unpaired(device_id, "The TV no longer recognises this pairing")
            return connection.state
        except (CannotConnect, ConnectionClosed, OSError) as exc:
            connection.remote = None
            LOGGER.info("Could not connect to %s at %s: %s", device_id, record.host, exc)
            return self._set_state(
                device_id, connection="unreachable", error=f"Could not reach a TV at {record.host}"
            )

        # Exactly once per connection: the old build never called this at all, so a TV
        # that dropped off the network stayed dead until someone restarted the service.
        remote.keep_reconnecting(
            invalid_auth_callback=lambda: self._on_invalid_auth(device_id),
        )
        return self._set_state(
            device_id,
            connection="connected",
            error=None,
            is_on=remote.is_on,
            current_app=remote.current_app,
            volume=_volume_of(remote),
            last_seen=datetime.now(timezone.utc),
        )

    def _close_connection(self, device_id: str) -> None:
        """Drop the held connection to a device, if any.

        :param device_id: MAC-derived device identifier.
        """
        connection = self._connections.get(device_id)
        if connection is None or connection.remote is None:
            return
        try:
            connection.remote.disconnect()
        except Exception:  # noqa: BLE001 - teardown must never raise
            LOGGER.debug("Ignoring error while disconnecting %s", device_id, exc_info=True)
        connection.remote = None

    def _cancel_pairing(self, device_id: str) -> None:
        """Tear down any pairing session in flight for a device.

        :param device_id: MAC-derived device identifier.
        """
        connection = self._connections.get(device_id)
        if connection is None:
            return
        if connection.pairing_timer is not None:
            connection.pairing_timer.cancel()
            connection.pairing_timer = None
        if connection.pairing is not None:
            try:
                connection.pairing.disconnect()
            except Exception:  # noqa: BLE001 - teardown must never raise
                LOGGER.debug("Ignoring error while ending pairing for %s", device_id, exc_info=True)
            connection.pairing = None

    async def _expire_pairing(self, device_id: str) -> None:
        """Close a pairing session the user never completed.

        :param device_id: MAC-derived device identifier.
        """
        try:
            await asyncio.sleep(self.pairing_timeout)
        except asyncio.CancelledError:
            return
        connection = self._connections.get(device_id)
        if connection is None or connection.pairing is None:
            return
        connection.pairing_timer = None
        self._cancel_pairing(device_id)
        self._set_state(device_id, connection="unpaired", error="Pairing timed out")
        self.event_bus.publish(
            {"type": "pairing", "device_id": device_id, "status": "timeout", "error": "Pairing timed out"}
        )

    async def _mark_unpaired(self, device_id: str, reason: str) -> None:
        """Record that the TV no longer accepts our certificate.

        :param device_id: MAC-derived device identifier.
        :param reason: Human-readable explanation surfaced to the UI.
        """
        record = await asyncio.to_thread(self._registry.update, device_id, paired=False)
        self._records[device_id] = record
        self._set_state(device_id, connection="unpaired", error=reason)
        self.event_bus.publish(
            {"type": "pairing", "device_id": device_id, "status": "failed", "error": reason}
        )
        self.event_bus.publish({"type": "device.updated", "device": _dump(self._to_device(record))})

    def _on_invalid_auth(self, device_id: str) -> None:
        """Handle the library reporting that the pairing was revoked.

        Called from the reconnect supervisor's task, so the database write is scheduled
        rather than awaited.

        :param device_id: MAC-derived device identifier.
        """
        reason = "The TV no longer recognises this pairing"
        self._close_connection(device_id)
        # Flip the visible state straight away so the UI can prompt for a re-pair; the
        # matching database write has to be scheduled because callbacks cannot await.
        self._set_state(device_id, connection="unpaired", error=reason)
        self._spawn(self._mark_unpaired(device_id, reason))

    def _set_state(self, device_id: str, **fields: Any) -> DeviceState:
        """Replace fields of a device's live state and publish the change.

        :param device_id: MAC-derived device identifier.
        :param fields: State fields to overwrite.
        :returns: The updated state.
        """
        connection = self._connections[device_id]
        connection.state = connection.state.model_copy(update=fields)
        self.event_bus.publish(
            {
                "type": "device.state",
                "device_id": device_id,
                "state": connection.state.model_dump(mode="json"),
            }
        )
        return connection.state

    def _on_is_on(self, device_id: str, value: bool) -> None:
        """Record the TV's screen power state.

        :param device_id: MAC-derived device identifier.
        :param value: Whether the screen is on.
        """
        self._set_state(device_id, is_on=value, last_seen=datetime.now(timezone.utc))

    def _on_current_app(self, device_id: str, value: str) -> None:
        """Record the TV's foreground app.

        :param device_id: MAC-derived device identifier.
        :param value: Package id or URL of the foreground app.
        """
        self._set_state(device_id, current_app=value or None, last_seen=datetime.now(timezone.utc))

    def _on_volume(self, device_id: str, value: dict[str, Any]) -> None:
        """Record the TV's volume readout.

        :param device_id: MAC-derived device identifier.
        :param value: ``level``/``max``/``muted`` mapping from the protocol.
        """
        self._set_state(
            device_id,
            volume=VolumeInfo(
                level=value.get("level"), max=value.get("max"), muted=bool(value.get("muted"))
            ),
            last_seen=datetime.now(timezone.utc),
        )

    def _on_available(self, device_id: str, value: bool) -> None:
        """Record the TV becoming reachable or unreachable.

        :param device_id: MAC-derived device identifier.
        :param value: Whether the TV is currently answering.
        """
        record = self._records.get(device_id)
        if value:
            self._set_state(
                device_id, connection="connected", error=None, last_seen=datetime.now(timezone.utc)
            )
        else:
            host = record.host if record else "the TV"
            self._set_state(device_id, connection="unreachable", error=f"Lost the connection to {host}")

    # -- discovery internals -----------------------------------------------------------

    async def _start_discovery(self) -> None:
        """Start the background mDNS browser, unless discovery is turned off."""
        if not self.settings.discovery_enabled:
            LOGGER.info("Discovery is disabled; devices must be added by address")
            return
        from .discovery import DiscoveryBrowser

        self._browser = DiscoveryBrowser(self.settings, self._on_discovered)
        await self._browser.start()

    async def _stop_discovery(self) -> None:
        """Stop the background mDNS browser if it is running."""
        if self._browser is not None:
            await self._browser.stop()
            self._browser = None

    def _on_discovered(self, entry: DiscoveredDevice) -> None:
        """Merge one browser result into the cache, updating a moved device's address.

        When a registered TV turns up at a new address the registry row is updated in
        place and the connection is reopened, so the pairing survives a DHCP change.

        :param entry: The freshly resolved service.
        """
        self._discovered[entry.mdns_name] = entry
        self._refresh_discovery_registration()
        self.event_bus.publish({"type": "discovery", "devices": _dump_all(self.list_discovered())})

        for record in self._records.values():
            if record.mdns_name is None and (
                record.host in entry.addresses or record.host == entry.host
            ):
                # First sighting of a TV that was registered by address. Binding the
                # service name now is what lets a later address change be recognised as
                # THIS device moving rather than as a new TV appearing.
                self._spawn(self._bind_mdns_name(record.id, entry.mdns_name))
                break
            if record.mdns_name == entry.mdns_name and record.host != entry.host:
                LOGGER.info("%s moved from %s to %s", record.id, record.host, entry.host)
                self._spawn(self.update_device(record.id, host=entry.host))
                break

    async def _bind_mdns_name(self, device_id: str, mdns_name: str) -> None:
        """Remember which mDNS service belongs to a device registered by address.

        :param device_id: MAC-derived device identifier.
        :param mdns_name: Full service instance name the device advertises.
        """
        record = await asyncio.to_thread(self._registry.update, device_id, mdns_name=mdns_name)
        self._records[device_id] = record
        self.event_bus.publish({"type": "device.updated", "device": _dump(self._to_device(record))})

    def _refresh_discovery_registration(self) -> None:
        """Re-evaluate which discovery entries correspond to a registered device.

        mDNS does not advertise the TV's MAC address, so a discovery entry is matched to a
        registration by address. That is weaker than the MAC identity used everywhere else
        and is only ever a display hint.
        """
        by_host = {record.host: record.id for record in self._records.values()}
        by_mdns = {record.mdns_name: record.id for record in self._records.values() if record.mdns_name}
        for name, entry in self._discovered.items():
            device_id = by_mdns.get(name)
            if device_id is None:
                device_id = next((by_host[a] for a in entry.addresses if a in by_host), None)
            self._discovered[name] = entry.model_copy(
                update={"registered": device_id is not None, "device_id": device_id}
            )

    def _mdns_name_for(self, host: str) -> str | None:
        """Find the mDNS service name currently advertised at an address.

        :param host: Address the device was registered at.
        :returns: The service instance name, or ``None`` if the TV has not been seen.
        """
        for entry in self._discovered.values():
            if host in entry.addresses or entry.host == host:
                return entry.mdns_name
        return None

    def _seed_discovery_from_legacy_file(self) -> None:
        """Surface the old Flask build's known TVs so they are not lost in the rebuild.

        The legacy file records only IP and name — no MAC — so its entries cannot become
        registry rows without fabricating the identity this rebuild exists to stop
        fabricating. They are seeded into the discovery cache instead, where the operator
        can register them properly.
        """
        now = datetime.now(timezone.utc)
        for host, name in read_legacy_seeds(self._legacy_seed_path):
            mdns_name = f"{name}.{SERVICE_TYPE}"
            self._discovered.setdefault(
                mdns_name,
                DiscoveredDevice(
                    mdns_name=mdns_name,
                    display_name=name,
                    addresses=[host],
                    host=host,
                    registered=False,
                    device_id=None,
                    last_seen=now,
                ),
            )
        self._refresh_discovery_registration()


def _initial_state(record: DeviceRecord) -> DeviceState:
    """Build the state a device starts in before any connection is attempted.

    :param record: The stored registration.
    :returns: The starting state.
    """
    if not record.enabled:
        return DeviceState(connection="disabled")
    if not record.paired:
        return DeviceState(connection="unpaired", error="This device is not paired")
    return DeviceState(connection="disconnected")


def _volume_of(remote: Any) -> VolumeInfo | None:
    """Read the volume readout off a remote, if it has one yet.

    :param remote: The protocol library's remote object.
    :returns: The volume info, or ``None`` when the TV has not reported it.
    """
    info = remote.volume_info
    if not info:
        return None
    return VolumeInfo(level=info.get("level"), max=info.get("max"), muted=bool(info.get("muted")))


def _model_of(remote: Any) -> str | None:
    """Read the model string off a remote, if it has one yet.

    :param remote: The protocol library's remote object.
    :returns: The model string, or ``None``.
    """
    info = getattr(remote, "device_info", None)
    return info.get("model") if info else None


def _dump(model: Any) -> dict[str, Any]:
    """Serialize a Pydantic model for the event bus.

    :param model: The model to serialize.
    :returns: Its JSON-safe dict form.
    """
    return model.model_dump(mode="json")


def _dump_all(models: list[Any]) -> list[dict[str, Any]]:
    """Serialize a list of Pydantic models for the event bus.

    :param models: The models to serialize.
    :returns: Their JSON-safe dict forms.
    """
    return [model.model_dump(mode="json") for model in models]
