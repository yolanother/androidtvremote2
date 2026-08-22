# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Tests for the Google Cast media session layer of the Android TV Remote appliance.
# Exercises the pure translation from pychromecast's receiver and media statuses into the
# frozen CastInfo and NowPlaying models, the threading contract that keeps the cast
# thread's callbacks off the event loop, the POST /api/devices/{id}/media transport
# endpoint including its NoMediaSession path, and the guarantee that a Cast channel which
# is unreachable or disabled leaves key sending and the rest of the appliance untouched.
"""Tests for the Google Cast media session layer of the appliance."""

from __future__ import annotations

import asyncio
import threading
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.cast import CastSession, cast_enabled, cast_info_from, now_playing_from
from app.errors import NoMediaSession


# -- doubles ---------------------------------------------------------------------------


def make_cast_status(**overrides: Any) -> SimpleNamespace:
    """Build a stand-in for pychromecast's ``CastStatus`` dataclass.

    :param overrides: Fields to override on the default Netflix-on-BRAVIA shape.
    :returns: An object exposing the attributes :func:`cast_info_from` reads.
    """
    fields: dict[str, Any] = {
        "app_id": "Netflix",
        "display_name": "Netflix",
        "status_text": "Netflix",
        "volume_level": 0.68,
        "volume_muted": False,
        "icon_url": "",
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def make_media_status(**overrides: Any) -> SimpleNamespace:
    """Build a stand-in for pychromecast's ``MediaStatus``.

    :param overrides: Fields to override on the default playing-a-TV-episode shape.
    :returns: An object exposing the attributes :func:`now_playing_from` reads.
    """
    fields: dict[str, Any] = {
        "media_session_id": 1,
        "player_state": "PLAYING",
        "title": "Stranger Things",
        "series_title": "Chapter One: MADMAX",
        "artist": None,
        "album_name": None,
        "season": 4,
        "episode": 1,
        "content_type": "video/mp4",
        "duration": 4680.0,
        "current_time": 132.5,
        "images": [SimpleNamespace(url="https://example.invalid/artwork.jpg")],
        "supports_pause": True,
        "supports_seek": True,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


class FakeMediaController:
    """Records the transport commands a fake session would have sent to the TV."""

    def __init__(self) -> None:
        """Start with no commands recorded."""
        self.calls: list[tuple[str, float | None]] = []

    def play(self) -> None:
        """Record a play command."""
        self.calls.append(("play", None))

    def pause(self) -> None:
        """Record a pause command."""
        self.calls.append(("pause", None))

    def stop(self) -> None:
        """Record a stop command."""
        self.calls.append(("stop", None))

    def seek(self, position: float) -> None:
        """Record a seek command.

        :param position: Target offset in seconds.
        """
        self.calls.append(("seek", position))

    def queue_next(self) -> None:
        """Record a skip-forward command."""
        self.calls.append(("next", None))

    def queue_prev(self) -> None:
        """Record a skip-back command."""
        self.calls.append(("previous", None))


class FakeCastSession(CastSession):
    """A :class:`CastSession` with the network replaced by a recording controller.

    Everything else is the real class, so the transport guard rules, the status-to-model
    translation, and the publish path under test are the production ones rather than a
    reimplementation. Tests drive it with :meth:`push_cast` and :meth:`push_media`, which
    stand in for a status having arrived from pychromecast's socket thread and been
    marshalled back onto the event loop.
    """

    #: Every instance ever constructed, in construction order. Reset by the fixture.
    instances: list[FakeCastSession] = []
    #: Exception class to raise from :meth:`start`, or ``None`` to succeed.
    start_error: type[Exception] | None = None

    def __init__(self, device_id: str, host: str, on_update: Any, *, name: str | None = None) -> None:
        """Build a session whose Cast channel is a recording double."""
        super().__init__(device_id, host, on_update, name=name)
        self.controller = FakeMediaController()
        self._cast = SimpleNamespace(media_controller=self.controller)
        self.started = False
        self.stopped = False
        FakeCastSession.instances.append(self)

    async def start(self) -> None:
        """Mark the fake as started, or raise the scripted start error.

        :raises Exception: The class-level :attr:`start_error`, when set.
        """
        if FakeCastSession.start_error is not None:
            raise FakeCastSession.start_error("scripted cast failure")
        self.started = True

    async def stop(self) -> None:
        """Mark the fake as stopped without touching a socket."""
        self.stopped = True

    def push_cast(self, status: Any, connected: bool = True) -> None:
        """Simulate the receiver reporting a new status.

        :param status: A :func:`make_cast_status` result, or ``None``.
        :param connected: Whether the Cast channel is up.
        """
        self._cast_status = status
        self._connected = connected
        self._publish()

    def push_media(self, status: Any, sampled_at: datetime | None = None) -> None:
        """Simulate the media channel reporting a new status.

        :param status: A :func:`make_media_status` result, or ``None`` for no session.
        :param sampled_at: Instant the position was sampled; defaults to now.
        """
        self._media_status = status
        self._sampled_at = sampled_at or datetime.now(UTC)
        self._connected = True
        if self._cast_status is None:
            self._cast_status = make_cast_status()
        self._publish()


@pytest.fixture(autouse=True)
def fake_cast(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Install :class:`FakeCastSession` as the manager's Cast implementation.

    :param monkeypatch: pytest's patching fixture.
    :returns: The :class:`FakeCastSession` class itself.
    """
    FakeCastSession.instances = []
    FakeCastSession.start_error = None
    monkeypatch.setattr("app.devices.CastSession", FakeCastSession)
    monkeypatch.setenv("CAST_ENABLED", "true")
    yield FakeCastSession
    FakeCastSession.instances = []
    FakeCastSession.start_error = None


# -- translation -----------------------------------------------------------------------


def test_cast_info_maps_receiver_status() -> None:
    """A receiver status becomes a populated CastInfo with available set."""
    info = cast_info_from(make_cast_status(), connected=True)
    assert info.app_id == "Netflix"
    assert info.display_name == "Netflix"
    assert info.status_text == "Netflix"
    assert info.volume_level == pytest.approx(0.68)
    assert info.muted is False
    assert info.available is True


def test_cast_info_without_status_is_unavailable() -> None:
    """No receiver status yet still yields a CastInfo, with everything null."""
    info = cast_info_from(None, connected=False)
    assert info.app_id is None
    assert info.display_name is None
    assert info.available is False


def test_cast_info_clamps_out_of_range_volume() -> None:
    """A volume outside 0..1 is clamped rather than raising inside a thread callback."""
    assert cast_info_from(make_cast_status(volume_level=1.4), True).volume_level == 1.0
    assert cast_info_from(make_cast_status(volume_level=-0.2), True).volume_level == 0.0


def test_now_playing_is_none_without_a_session() -> None:
    """The native-app case: no media session id means no NowPlaying at all."""
    assert now_playing_from(None, datetime.now(UTC)) is None
    assert now_playing_from(make_media_status(media_session_id=None), datetime.now(UTC)) is None


def test_now_playing_maps_media_status() -> None:
    """A live media session becomes a fully populated NowPlaying."""
    sampled = datetime(2026, 8, 21, 22, 4, 2, tzinfo=UTC)
    playing = now_playing_from(make_media_status(), sampled)
    assert playing is not None
    assert playing.title == "Stranger Things"
    assert playing.subtitle == "Chapter One: MADMAX"
    assert playing.season == 4
    assert playing.episode == 1
    assert playing.player_state == "PLAYING"
    assert playing.duration == pytest.approx(4680.0)
    assert playing.position == pytest.approx(132.5)
    assert playing.position_at == sampled
    assert playing.images == ["https://example.invalid/artwork.jpg"]
    assert playing.can_pause is True
    assert playing.can_seek is True


def test_now_playing_falls_back_to_artist_for_music() -> None:
    """Music has no series title, so the artist fills the subtitle slot."""
    playing = now_playing_from(
        make_media_status(series_title=None, artist="Boards of Canada", album_name="Geogaddi"),
        datetime.now(UTC),
    )
    assert playing is not None
    assert playing.subtitle == "Boards of Canada"
    assert playing.album == "Geogaddi"


def test_now_playing_rejects_unknown_player_state() -> None:
    """A player state outside the frozen literal degrades to UNKNOWN, not a crash."""
    playing = now_playing_from(make_media_status(player_state="WEIRD"), datetime.now(UTC))
    assert playing is not None
    assert playing.player_state == "UNKNOWN"


def test_cast_enabled_reads_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """CAST_ENABLED defaults to true and accepts the usual falsey spellings."""
    monkeypatch.delenv("CAST_ENABLED", raising=False)
    assert cast_enabled() is True
    for value in ("0", "false", "FALSE", "no", "off"):
        monkeypatch.setenv("CAST_ENABLED", value)
        assert cast_enabled() is False
    monkeypatch.setenv("CAST_ENABLED", "true")
    assert cast_enabled() is True


# -- state wiring ----------------------------------------------------------------------


def test_cast_state_populates_device_state(paired_client: Any) -> None:
    """A receiver status reaches DeviceState.cast for the matching device."""
    client, device_id = paired_client
    session = FakeCastSession.instances[-1]
    session.push_cast(make_cast_status())

    state = client.get(f"/api/devices/{device_id}/state").json()
    assert state["cast"]["display_name"] == "Netflix"
    assert state["cast"]["available"] is True
    assert state["now_playing"] is None


def test_now_playing_stays_null_for_a_native_app(paired_client: Any) -> None:
    """The common case: app identity populates, media metadata does not."""
    client, device_id = paired_client
    session = FakeCastSession.instances[-1]
    session.push_cast(make_cast_status(app_id="AndroidNativeApp", display_name="Spotify"))

    state = client.get(f"/api/devices/{device_id}/state").json()
    assert state["cast"]["app_id"] == "AndroidNativeApp"
    assert state["now_playing"] is None


def test_now_playing_stamps_position_at(paired_client: Any) -> None:
    """position_at is carried through so a client can extrapolate the playhead."""
    client, device_id = paired_client
    session = FakeCastSession.instances[-1]
    sampled = datetime(2026, 8, 21, 22, 4, 2, tzinfo=UTC)
    session.push_media(make_media_status(), sampled_at=sampled)

    now_playing = client.get(f"/api/devices/{device_id}/state").json()["now_playing"]
    assert now_playing["position"] == pytest.approx(132.5)
    assert now_playing["position_at"].startswith("2026-08-21T22:04:02")


async def test_cast_change_publishes_a_device_state_event(
    settings: Any, no_legacy_seeds: Any, fake_remote: Any
) -> None:
    """Cast updates are pushed onto the event bus rather than polled for.

    Asserted against the manager directly because the push originates on the event loop,
    not from an HTTP request; the WebSocket transport itself is covered by test_ws.py.
    """
    from app.devices import DeviceManager

    manager = DeviceManager(
        settings,
        remote_factory=fake_remote,
        legacy_seed_path=no_legacy_seeds,
        cast_factory=FakeCastSession,
    )
    await manager.start()
    try:
        device = await manager.add_device("192.168.1.23")
        with manager.event_bus.subscribe() as queue:
            FakeCastSession.instances[-1].push_cast(make_cast_status())
            frame = await asyncio.wait_for(queue.get(), timeout=1)
    finally:
        await manager.stop()

    assert frame["type"] == "device.state"
    assert frame["device_id"] == device.id
    assert frame["state"]["cast"]["display_name"] == "Netflix"
    assert frame["state"]["now_playing"] is None


# -- media control ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("action", "expected"),
    [
        ("play", ("play", None)),
        ("pause", ("pause", None)),
        ("stop", ("stop", None)),
        ("next", ("next", None)),
        ("previous", ("previous", None)),
    ],
)
def test_media_actions_reach_the_session(
    paired_client: Any, action: str, expected: tuple[str, float | None]
) -> None:
    """Every transport action is forwarded to the Cast media controller."""
    client, device_id = paired_client
    session = FakeCastSession.instances[-1]
    session.push_media(make_media_status())

    response = client.post(f"/api/devices/{device_id}/media", json={"action": action})
    assert response.status_code == 200
    assert session.controller.calls == [expected]


def test_media_seek_forwards_the_position(paired_client: Any) -> None:
    """A seek carries its target offset through to the controller."""
    client, device_id = paired_client
    session = FakeCastSession.instances[-1]
    session.push_media(make_media_status())

    response = client.post(
        f"/api/devices/{device_id}/media", json={"action": "seek", "position": 130.0}
    )
    assert response.status_code == 200
    assert session.controller.calls == [("seek", 130.0)]


def test_play_pause_pauses_while_playing(paired_client: Any) -> None:
    """play_pause resolves against the reported player state."""
    client, device_id = paired_client
    session = FakeCastSession.instances[-1]
    session.push_media(make_media_status(player_state="PLAYING"))
    client.post(f"/api/devices/{device_id}/media", json={"action": "play_pause"})
    assert session.controller.calls == [("pause", None)]


def test_play_pause_plays_while_paused(paired_client: Any) -> None:
    """The other half of the toggle."""
    client, device_id = paired_client
    session = FakeCastSession.instances[-1]
    session.push_media(make_media_status(player_state="PAUSED"))
    client.post(f"/api/devices/{device_id}/media", json={"action": "play_pause"})
    assert session.controller.calls == [("play", None)]


def test_media_returns_the_device_state(paired_client: Any) -> None:
    """The endpoint answers with DeviceState, as the contract specifies."""
    client, device_id = paired_client
    FakeCastSession.instances[-1].push_media(make_media_status())
    body = client.post(f"/api/devices/{device_id}/media", json={"action": "play"}).json()
    assert body["now_playing"]["title"] == "Stranger Things"
    assert body["connection"] == "connected"


def test_media_without_a_session_is_409(paired_client: Any) -> None:
    """The common native-app case: transport control has nothing to talk to."""
    client, device_id = paired_client
    FakeCastSession.instances[-1].push_cast(make_cast_status(app_id="AndroidNativeApp"))

    response = client.post(f"/api/devices/{device_id}/media", json={"action": "play_pause"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_media_session"


def test_media_honours_can_pause(paired_client: Any) -> None:
    """A session that refuses pause is not sent one."""
    client, device_id = paired_client
    session = FakeCastSession.instances[-1]
    session.push_media(make_media_status(supports_pause=False))

    response = client.post(f"/api/devices/{device_id}/media", json={"action": "pause"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_media_session"
    assert session.controller.calls == []


def test_media_honours_can_seek(paired_client: Any) -> None:
    """A session that refuses seek is not sent one."""
    client, device_id = paired_client
    session = FakeCastSession.instances[-1]
    session.push_media(make_media_status(supports_seek=False))

    response = client.post(
        f"/api/devices/{device_id}/media", json={"action": "seek", "position": 12.0}
    )
    assert response.status_code == 409
    assert session.controller.calls == []


def test_media_seek_requires_a_position(paired_client: Any) -> None:
    """The frozen request model rejects a seek with no target."""
    client, device_id = paired_client
    FakeCastSession.instances[-1].push_media(make_media_status())
    assert client.post(f"/api/devices/{device_id}/media", json={"action": "seek"}).status_code == 400


def test_media_on_unknown_device_is_404(app_client: Any) -> None:
    """A media command for a device that does not exist is a 404, not a 409."""
    response = app_client.post("/api/devices/nosuchdevice/media", json={"action": "play"})
    assert response.status_code == 404


# -- optionality and failure isolation ---------------------------------------------------


def test_cast_failure_does_not_break_key_sending(app_client: Any, fake_remote: Any) -> None:
    """A Cast channel that will not start leaves the remote protocol fully working."""
    FakeCastSession.start_error = RuntimeError
    device_id = app_client.post("/api/devices", json={"host": "192.168.1.23"}).json()["id"]
    app_client.post(f"/api/devices/{device_id}/pair")
    app_client.post(f"/api/devices/{device_id}/pair/complete", json={"code": "123456"})

    response = app_client.post(f"/api/devices/{device_id}/keys", json={"key": "DPAD_UP"})
    assert response.status_code == 202
    assert fake_remote.instances[-1].keys == [("KEYCODE_DPAD_UP", "SHORT")]
    assert app_client.get(f"/api/devices/{device_id}/state").json()["cast"] is None


def test_cast_can_be_disabled_entirely(
    monkeypatch: pytest.MonkeyPatch, settings: Any, no_legacy_seeds: Any, fake_remote: Any
) -> None:
    """With CAST_ENABLED=false no session is opened and the remote still works."""
    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.setenv("CAST_ENABLED", "false")
    application = create_app(
        settings=settings, remote_factory=fake_remote, legacy_seed_path=no_legacy_seeds
    )
    with TestClient(application) as client:
        created = client.post("/api/devices", json={"host": "192.168.1.23"})
        device_id = created.json()["id"]
        client.post(f"/api/devices/{device_id}/pair")
        client.post(f"/api/devices/{device_id}/pair/complete", json={"code": "123456"})

        assert FakeCastSession.instances == []
        assert client.post(f"/api/devices/{device_id}/keys", json={"key": "HOME"}).status_code == 202
        state = client.get(f"/api/devices/{device_id}/state").json()
        assert state["cast"] is None
        assert state["now_playing"] is None
        assert client.post(f"/api/devices/{device_id}/media", json={"action": "play"}).status_code == 409


def test_disabling_a_device_stops_its_cast_session(paired_client: Any) -> None:
    """A disabled device must not hold a Cast connection open."""
    client, device_id = paired_client
    session = FakeCastSession.instances[-1]
    client.patch(f"/api/devices/{device_id}", json={"enabled": False})
    assert session.stopped is True


def test_moving_a_device_reopens_its_cast_session(paired_client: Any) -> None:
    """A DHCP change moves the Cast connection to the new address too."""
    client, device_id = paired_client
    before = len(FakeCastSession.instances)
    client.patch(f"/api/devices/{device_id}", json={"host": "192.168.1.99"})
    assert len(FakeCastSession.instances) == before + 1
    assert FakeCastSession.instances[-1].host == "192.168.1.99"


# -- threading contract ------------------------------------------------------------------


async def test_callbacks_marshal_onto_the_event_loop() -> None:
    """Cast-thread callbacks must reach the update callback on the loop, never inline.

    This is the whole threading contract: pychromecast delivers statuses from its own
    socket thread, and anything that touched appliance state from there would be racing
    the event loop.
    """
    seen: list[tuple[int, Any, Any]] = []
    session = CastSession(
        "aabb",
        "192.168.1.202",
        lambda info, playing: seen.append((threading.get_ident(), info, playing)),
    )
    main_thread = threading.get_ident()

    def from_cast_thread() -> None:
        """Deliver statuses the way pychromecast's socket thread does."""
        assert threading.get_ident() != main_thread
        session.new_cast_status(make_cast_status())
        session.new_media_status(make_media_status())

    await asyncio.to_thread(from_cast_thread)
    for _ in range(4):  # let the scheduled callbacks drain
        await asyncio.sleep(0)

    assert seen, "the cast thread's status never reached the event loop"
    assert all(ident == main_thread for ident, _, _ in seen)
    _, info, playing = seen[-1]
    assert info.display_name == "Netflix"
    assert playing is not None and playing.title == "Stranger Things"


async def test_a_closed_loop_does_not_raise_from_the_cast_thread() -> None:
    """Shutdown races must not surface as an exception on pychromecast's thread."""
    session = CastSession("aabb", "192.168.1.202", lambda info, playing: None)
    dead = asyncio.new_event_loop()
    dead.close()
    session._loop = dead
    session.new_cast_status(make_cast_status())  # must not raise


async def test_control_without_a_session_raises() -> None:
    """CastSession refuses transport commands when nothing is casting."""
    session = CastSession("aabb", "192.168.1.202", lambda info, playing: None)
    with pytest.raises(NoMediaSession):
        await session.control("play")


async def test_a_failing_update_callback_does_not_kill_the_session() -> None:
    """A subscriber that raises must not take the Cast channel down with it."""

    def explode(info: Any, playing: Any) -> None:
        """Fail the way a downstream bug would."""
        raise RuntimeError("downstream bug")

    session = CastSession("aabb", "192.168.1.202", explode)
    session.new_cast_status(make_cast_status())
    for _ in range(4):
        await asyncio.sleep(0)
