# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Shared pytest fixtures for the Android TV Remote appliance server test suite. Puts the
# server package and the vendored protocol library on sys.path, points every test at an
# isolated temporary DATA_DIR so no test can touch the real NFS volume, and supplies the
# FakeRemote double that stands in for AndroidTVRemote so the manager, REST, and
# WebSocket layers can be exercised without a TV on the network.
"""Shared pytest fixtures for the Android TV Remote appliance server test suite."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

SERVER_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVER_DIR.parent
# server/ goes first so `app` resolves to the FastAPI package; src/ is appended rather
# than prepended because the legacy src/app.py would otherwise shadow that package.
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.append(str(REPO_ROOT / "src"))

from app.config import Settings  # noqa: E402


class FakeRemote:
    """Stand-in for :class:`androidtvremote2.AndroidTVRemote` used by the whole test suite.

    It records every interaction (which certfile it was handed, whether
    ``keep_reconnecting`` was called, which keys were sent) so tests can assert on the
    behaviours that the old implementation got wrong, and it lets each test script the
    outcome of connecting and pairing.
    """

    #: Every instance ever constructed, in construction order. Reset by the fixture.
    instances: list[FakeRemote] = []
    #: Name/MAC returned by :meth:`async_get_name_and_mac`, keyed by host.
    identities: dict[str, tuple[str, str]] = {}
    #: Exception class to raise from :meth:`async_connect`, or ``None`` to succeed.
    connect_error: type[Exception] | None = None
    #: Exception class to raise from :meth:`async_finish_pairing`, or ``None``.
    finish_pairing_error: type[Exception] | None = None

    def __init__(
        self,
        client_name: str,
        certfile: str,
        keyfile: str,
        host: str,
        api_port: int = 6466,
        pair_port: int = 6467,
        enable_ime: bool = True,
    ) -> None:
        """Record the construction arguments and register the instance."""
        self.client_name = client_name
        self.certfile = certfile
        self.keyfile = keyfile
        self.host = host
        self.api_port = api_port
        self.pair_port = pair_port
        self.enable_ime = enable_ime

        self.is_on: bool | None = None
        self.current_app: str | None = None
        self.volume_info: dict[str, Any] | None = None
        self.device_info: dict[str, str] | None = {"model": "FAKE-TV", "manufacturer": "Fake"}

        self.connected = False
        self.disconnected = False
        self.keep_reconnecting_calls = 0
        self.invalid_auth_callback: Any = None
        self.generated_cert = False
        self.pairing_started = False
        self.pairing_codes: list[str] = []
        self.keys: list[tuple[Any, Any]] = []
        self.texts: list[str] = []
        self.launched: list[str] = []

        self._is_on_cbs: list[Any] = []
        self._current_app_cbs: list[Any] = []
        self._volume_cbs: list[Any] = []
        self._available_cbs: list[Any] = []

        FakeRemote.instances.append(self)

    # -- callback registration -------------------------------------------------

    def add_is_on_updated_callback(self, callback: Any) -> None:
        """Register a callback invoked when the screen power state changes."""
        self._is_on_cbs.append(callback)

    def add_current_app_updated_callback(self, callback: Any) -> None:
        """Register a callback invoked when the foreground app changes."""
        self._current_app_cbs.append(callback)

    def add_volume_info_updated_callback(self, callback: Any) -> None:
        """Register a callback invoked when the volume readout changes."""
        self._volume_cbs.append(callback)

    def add_is_available_updated_callback(self, callback: Any) -> None:
        """Register a callback invoked when the TV becomes reachable or unreachable."""
        self._available_cbs.append(callback)

    # -- test-side drivers -----------------------------------------------------

    def push_is_on(self, value: bool) -> None:
        """Simulate the TV reporting a new screen power state."""
        self.is_on = value
        for callback in self._is_on_cbs:
            callback(value)

    def push_current_app(self, value: str) -> None:
        """Simulate the TV reporting a new foreground app."""
        self.current_app = value
        for callback in self._current_app_cbs:
            callback(value)

    def push_volume(self, level: int, maximum: int, muted: bool) -> None:
        """Simulate the TV reporting a new volume readout."""
        self.volume_info = {"level": level, "max": maximum, "muted": muted}
        for callback in self._volume_cbs:
            callback(self.volume_info)

    def push_available(self, value: bool) -> None:
        """Simulate the TV becoming reachable or unreachable."""
        for callback in self._available_cbs:
            callback(value)

    # -- AndroidTVRemote surface -----------------------------------------------

    async def async_generate_cert_if_missing(self) -> bool:
        """Write placeholder cert/key files if they are missing, like the real library."""
        cert = Path(self.certfile)
        key = Path(self.keyfile)
        if cert.is_file() and key.is_file():
            return False
        cert.parent.mkdir(parents=True, exist_ok=True)
        cert.write_text("FAKE CERT", encoding="utf-8")
        key.write_text("FAKE KEY", encoding="utf-8")
        self.generated_cert = True
        return True

    async def async_get_name_and_mac(self) -> tuple[str, str]:
        """Return the scripted name/MAC for this host.

        :raises Exception: The class-level :attr:`connect_error`, when set.
        """
        if FakeRemote.connect_error is not None:
            raise FakeRemote.connect_error("scripted failure")
        return FakeRemote.identities[self.host]

    async def async_connect(self) -> None:
        """Mark the fake as connected, or raise the scripted connect error."""
        if FakeRemote.connect_error is not None:
            raise FakeRemote.connect_error("scripted failure")
        self.connected = True

    def keep_reconnecting(self, invalid_auth_callback: Any = None) -> None:
        """Record that the reconnect supervisor was started."""
        self.keep_reconnecting_calls += 1
        self.invalid_auth_callback = invalid_auth_callback

    def disconnect(self) -> None:
        """Mark the fake as disconnected."""
        self.connected = False
        self.disconnected = True

    async def async_start_pairing(self) -> None:
        """Record that a pairing handshake was started."""
        if FakeRemote.connect_error is not None:
            raise FakeRemote.connect_error("scripted failure")
        self.pairing_started = True

    async def async_finish_pairing(self, pairing_code: str) -> None:
        """Record the submitted pairing code, or raise the scripted pairing error."""
        self.pairing_codes.append(pairing_code)
        if FakeRemote.finish_pairing_error is not None:
            raise FakeRemote.finish_pairing_error("scripted failure")

    def send_key_command(self, key_code: Any, direction: Any = "SHORT") -> None:
        """Record a key press."""
        self.keys.append((key_code, direction))

    def send_text(self, text: str) -> None:
        """Record typed text."""
        self.texts.append(text)

    def send_launch_app_command(self, app_link_or_app_id: str) -> None:
        """Record an app launch."""
        self.launched.append(app_link_or_app_id)


@pytest.fixture(autouse=True)
def fake_remote() -> Any:
    """Reset :class:`FakeRemote` class state between tests and hand the class to the test.

    :returns: The :class:`FakeRemote` class itself, ready to be used as a remote factory.
    """
    FakeRemote.instances = []
    FakeRemote.identities = {"192.168.1.23": ("Living Room TV", "AA:BB:CC:DD:EE:FF")}
    FakeRemote.connect_error = None
    FakeRemote.finish_pairing_error = None
    yield FakeRemote
    FakeRemote.instances = []


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Build a :class:`Settings` pointed at an isolated temporary data directory.

    :param tmp_path: pytest-supplied unique temporary directory.
    :returns: Settings with ``data_dir`` under ``tmp_path`` and discovery disabled.
    """
    return Settings(
        data_dir=tmp_path / "data",
        discovery_enabled=False,
        remote_api_token=None,
        _env_file=None,
    )


@pytest.fixture
def no_legacy_seeds(tmp_path: Path) -> Path:
    """Path of a legacy ``paired_tvs.json`` that does not exist.

    Tests pass this to DeviceManager so they do not depend on the repository's real
    ``src/api/paired_tvs.json``, which the integrator deletes at final merge.

    :param tmp_path: pytest-supplied unique temporary directory.
    :returns: A path guaranteed not to exist.
    """
    return tmp_path / "no-such-paired_tvs.json"


@pytest.fixture
def app_client(settings: Settings, no_legacy_seeds: Path) -> Any:
    """Start the FastAPI app against the fake remote factory and yield a test client.

    The app's lifespan runs, so the DeviceManager is started and stopped exactly as it is
    in production; only the network is faked.

    :param settings: Test settings pointed at a temporary data directory.
    :param no_legacy_seeds: Path of a legacy seed file that does not exist.
    :returns: A ``TestClient`` bound to the running app.
    """
    from fastapi.testclient import TestClient

    from app.main import create_app

    application = create_app(
        settings=settings, remote_factory=FakeRemote, legacy_seed_path=no_legacy_seeds
    )
    with TestClient(application) as client:
        yield client


@pytest.fixture
def paired_client(app_client: Any) -> Any:
    """A test client with one device already registered and paired.

    :param app_client: The running app's test client.
    :returns: ``(client, device_id)``.
    """
    created = app_client.post("/api/devices", json={"host": "192.168.1.23"})
    device_id = created.json()["id"]
    app_client.post(f"/api/devices/{device_id}/pair")
    app_client.post(f"/api/devices/{device_id}/pair/complete", json={"code": "123456"})
    return app_client, device_id
