# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Google Cast channel client for the Android TV Remote appliance. Holds one auto-
# reconnecting Cast connection per enabled television on port 8009, translates the
# receiver's app identity and volume into CastInfo and any live media session into
# NowPlaying, and implements the transport and scrubbing commands behind
# POST /api/devices/{id}/media. pychromecast is thread-based, so every status callback
# arrives on its socket thread and is marshalled back onto the asyncio loop here; every
# outbound command is issued from a worker thread. Cast is strictly optional: a
# television that is off, has no Cast receiver, or is running with CAST_ENABLED=false
# simply reports null cast state and never affects key sending.
"""Google Cast channel client and per-device media session for the appliance."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid as uuidlib
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from .errors import NoMediaSession
from .models import CastInfo, NowPlaying, PlayerState

LOGGER = logging.getLogger(__name__)

#: TCP port every Android TV advertises its Cast receiver on.
CAST_PORT = 8009

#: Seconds pychromecast's socket client waits between reconnect attempts. Deliberately
#: long: a television that is switched off must not be probed continuously.
RETRY_WAIT = 30.0

#: Seconds a single Cast socket operation may take before it is abandoned.
SOCKET_TIMEOUT = 10.0

#: Seconds to wait for pychromecast's socket thread to wind down at shutdown. Bounded so
#: a thread parked in its reconnect backoff cannot stall the container's shutdown.
DISCONNECT_TIMEOUT = 5.0

#: Environment values that turn ``CAST_ENABLED`` off.
_FALSEY = frozenset({"0", "false", "no", "off", ""})

#: Player states the frozen ``PlayerState`` literal accepts; anything else maps to UNKNOWN.
_PLAYER_STATES = frozenset({"PLAYING", "PAUSED", "BUFFERING", "IDLE"})

#: Player states that mean ``play_pause`` should pause rather than resume.
_ACTIVE_STATES = frozenset({"PLAYING", "BUFFERING"})

#: Update callback signature: receiver state and media session, either of which may be null.
CastUpdate = Callable[[CastInfo | None, NowPlaying | None], None]


def cast_enabled() -> bool:
    """Whether the Cast integration should run at all.

    Read from the environment rather than :class:`~app.config.Settings` because that model
    is part of the frozen contract and cannot gain a field.

    :returns: ``True`` unless ``CAST_ENABLED`` is set to a falsey value.
    """
    return os.environ.get("CAST_ENABLED", "true").strip().lower() not in _FALSEY


def cast_info_from(status: Any, connected: bool) -> CastInfo:
    """Translate a pychromecast receiver status into the contract's :class:`CastInfo`.

    Always returns a model rather than ``None`` so that a connected receiver which has not
    yet reported anything is distinguishable from a Cast channel that is down.

    :param status: pychromecast ``CastStatus``, or ``None`` if none has arrived.
    :param connected: Whether the Cast socket is currently up.
    :returns: The receiver state.
    """
    if status is None:
        return CastInfo(available=connected)
    return CastInfo(
        app_id=status.app_id or None,
        display_name=status.display_name or None,
        status_text=status.status_text or None,
        volume_level=_clamp_volume(status.volume_level),
        muted=None if status.volume_muted is None else bool(status.volume_muted),
        available=connected,
    )


def now_playing_from(status: Any, sampled_at: datetime) -> NowPlaying | None:
    """Translate a pychromecast media status into the contract's :class:`NowPlaying`.

    Returns ``None`` whenever there is no media session, which is the common case: Cast
    publishes its media namespace only for content cast from a phone or browser, so a
    television playing one of its own apps has app identity and nothing more.

    :param status: pychromecast ``MediaStatus``, or ``None`` if none has arrived.
    :param sampled_at: Instant ``position`` was read, so a client can extrapolate.
    :returns: The media session, or ``None`` when nothing is casting.
    """
    if status is None or getattr(status, "media_session_id", None) is None:
        return None
    state = status.player_state
    player_state: PlayerState = state if state in _PLAYER_STATES else "UNKNOWN"
    return NowPlaying(
        title=status.title,
        subtitle=status.series_title or status.artist,
        album=status.album_name,
        season=status.season,
        episode=status.episode,
        content_type=status.content_type,
        player_state=player_state,
        duration=status.duration,
        position=status.current_time,
        position_at=sampled_at,
        images=[image.url for image in (status.images or []) if getattr(image, "url", None)],
        can_pause=bool(status.supports_pause),
        can_seek=bool(status.supports_seek),
    )


def _clamp_volume(level: float | None) -> float | None:
    """Force a receiver volume into the contract's 0..1 range.

    The model constrains the field, and a validation error raised while translating a
    status would surface on pychromecast's own thread where nothing can handle it.

    :param level: Volume the receiver reported.
    :returns: The volume clamped to 0..1, or ``None``.
    """
    if level is None:
        return None
    return min(1.0, max(0.0, float(level)))


class CastSession:
    """One television's held Google Cast connection and its media session.

    Mirrors how :class:`~app.devices.DeviceManager` holds an ``AndroidTVRemote``: the
    connection is opened once, kept open, and reconnected by pychromecast's own socket
    thread. Status callbacks arrive on that thread and are handed to the event loop with
    ``call_soon_threadsafe``; outbound commands run in a worker thread. Nothing here ever
    blocks the loop, and every failure is logged rather than raised, because Cast is an
    enrichment and must never interfere with the remote protocol.

    :param device_id: MAC-derived device identifier, used for logging and the stable
        synthetic Cast UUID.
    :param host: IP address or hostname of the television.
    :param on_update: Called on the event loop with the new receiver state and media
        session whenever either changes.
    :param name: Display name passed to pychromecast as the friendly name.
    """

    def __init__(
        self, device_id: str, host: str, on_update: CastUpdate, *, name: str | None = None
    ) -> None:
        """Capture the running loop and the callback without touching the network."""
        self.device_id = device_id
        self.host = host
        self._on_update = on_update
        self._name = name
        self._loop = asyncio.get_event_loop()
        self._cast: Any = None
        self._cast_status: Any = None
        self._media_status: Any = None
        self._sampled_at = datetime.now(UTC)
        self._connected = False

    # -- lifecycle ---------------------------------------------------------------------

    async def start(self) -> None:
        """Open the Cast channel and begin receiving status updates.

        pychromecast's ``Chromecast`` constructor performs no network I/O when the cast
        type is supplied up front, and ``start`` only launches the socket thread, so this
        is safe on the loop. The cast type is hard-coded precisely to skip pychromecast's
        own probe, which otherwise blocks for up to thirty seconds against a TV that is off.

        :raises ImportError: Never; a missing pychromecast is logged and ignored.
        """
        try:
            from pychromecast import Chromecast
            from pychromecast.const import CAST_TYPE_CHROMECAST
            from pychromecast.models import CastInfo as ReceiverInfo
            from pychromecast.models import HostServiceInfo
        except ImportError:  # pragma: no cover - the dependency is declared in pyproject
            LOGGER.warning("pychromecast is not installed; Cast state will stay null")
            return

        self._loop = asyncio.get_running_loop()
        info = ReceiverInfo(
            services={HostServiceInfo(self.host, CAST_PORT)},
            uuid=uuidlib.uuid5(uuidlib.NAMESPACE_DNS, f"{self.device_id}.cast"),
            model_name=None,
            friendly_name=self._name,
            host=self.host,
            port=CAST_PORT,
            cast_type=CAST_TYPE_CHROMECAST,
            manufacturer=None,
        )
        cast = Chromecast(
            cast_info=info, tries=None, retry_wait=RETRY_WAIT, timeout=SOCKET_TIMEOUT
        )
        cast.register_connection_listener(self)
        cast.register_status_listener(self)
        cast.media_controller.register_status_listener(self)
        self._cast = cast
        cast.start()
        LOGGER.debug("Cast channel opened for %s at %s", self.device_id, self.host)

    async def stop(self) -> None:
        """Close the Cast channel, joining pychromecast's socket thread off the loop."""
        cast, self._cast = self._cast, None
        self._connected = False
        if cast is None:
            return
        try:
            await asyncio.to_thread(cast.disconnect, DISCONNECT_TIMEOUT)
        except Exception:  # teardown must never raise
            LOGGER.debug("Ignoring error while closing Cast for %s", self.device_id, exc_info=True)

    # -- control -----------------------------------------------------------------------

    async def control(self, action: str, position: float | None = None) -> None:
        """Run a transport command against the live media session.

        :param action: ``play``, ``pause``, ``play_pause``, ``stop``, ``seek``, ``next``,
            or ``previous``.
        :param position: Target offset in seconds; used only by ``seek``.
        :raises NoMediaSession: If nothing is casting, or the session refuses the action.
        """
        playing = now_playing_from(self._media_status, self._sampled_at)
        if playing is None or self._cast is None:
            raise NoMediaSession("Nothing is casting to this device")

        if action == "play_pause":
            action = "pause" if playing.player_state in _ACTIVE_STATES else "play"
        if action == "pause" and not playing.can_pause:
            raise NoMediaSession("This media session does not support pausing")
        if action == "seek" and not playing.can_seek:
            raise NoMediaSession("This media session does not support seeking")

        controller = self._cast.media_controller
        if action == "seek":
            await asyncio.to_thread(controller.seek, position if position is not None else 0.0)
            return
        commands: dict[str, Callable[[], None]] = {
            "play": controller.play,
            "pause": controller.pause,
            "stop": controller.stop,
            "next": controller.queue_next,
            "previous": controller.queue_prev,
        }
        command = commands.get(action)
        if command is None:
            raise NoMediaSession(f"Unsupported media action {action!r}")
        await asyncio.to_thread(command)

    # -- pychromecast listener protocols (called on the Cast socket thread) -------------

    def new_connection_status(self, status: Any) -> None:
        """Handle the Cast socket connecting or dropping.

        :param status: pychromecast ``ConnectionStatus``.
        """
        self._dispatch(self._apply_connection, status.status == "CONNECTED")

    def new_cast_status(self, status: Any) -> None:
        """Handle a new receiver status: app identity, status text, and volume.

        :param status: pychromecast ``CastStatus``.
        """
        self._dispatch(self._apply_cast_status, status)

    def new_media_status(self, status: Any) -> None:
        """Handle a new media status, stamping the instant the position was sampled.

        The stamp is taken here rather than at publish time so ``position_at`` describes
        when the television actually reported the playhead.

        :param status: pychromecast ``MediaStatus``.
        """
        self._dispatch(self._apply_media_status, status, datetime.now(UTC))

    def load_media_failed(self, item: int, error_code: int) -> None:
        """Note that a media load the appliance did not request has failed.

        :param item: Queue item id pychromecast failed to load.
        :param error_code: Cast error code.
        """
        LOGGER.debug("Cast media load failed for %s: item=%s code=%s", self.device_id, item, error_code)

    # -- internals ---------------------------------------------------------------------

    def _dispatch(self, handler: Callable[..., None], *args: Any) -> None:
        """Hand work from the Cast socket thread to the event loop.

        :param handler: The loop-side handler to run.
        :param args: Arguments to pass to it.
        """
        try:
            self._loop.call_soon_threadsafe(handler, *args)
        except RuntimeError:
            # The loop closed while pychromecast's thread was still running. Shutdown is
            # already under way and there is nobody left to tell.
            LOGGER.debug("Dropped a Cast update for %s after loop shutdown", self.device_id)

    def _apply_connection(self, connected: bool) -> None:
        """Record the Cast socket's connection state and clear stale status on a drop.

        :param connected: Whether the socket is up.
        """
        self._connected = connected
        if not connected:
            self._cast_status = None
            self._media_status = None
        self._publish()

    def _apply_cast_status(self, status: Any) -> None:
        """Record a receiver status and publish.

        :param status: pychromecast ``CastStatus``.
        """
        self._cast_status = status
        self._connected = True
        self._publish()

    def _apply_media_status(self, status: Any, sampled_at: datetime) -> None:
        """Record a media status and publish.

        :param status: pychromecast ``MediaStatus``.
        :param sampled_at: Instant the position was sampled.
        """
        self._media_status = status
        self._sampled_at = sampled_at
        self._connected = True
        self._publish()

    def _publish(self) -> None:
        """Translate the held statuses and hand them to the update callback."""
        try:
            self._on_update(
                cast_info_from(self._cast_status, self._connected),
                now_playing_from(self._media_status, self._sampled_at),
            )
        except Exception:  # a downstream bug must not take the Cast channel down
            LOGGER.debug("Cast update callback failed for %s", self.device_id, exc_info=True)
