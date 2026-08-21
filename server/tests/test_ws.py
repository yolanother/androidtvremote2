# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Tests for the /api/ws event stream. Covers the snapshot-then-deltas contract that lets
# the UI avoid polling entirely, the ping/pong keepalive, the refusal to accept any other
# client frame, and the eviction rule that drops a WebSocket client which stops draining
# instead of letting it apply backpressure to the TV connections.
"""Tests for the /api/ws event stream."""

from __future__ import annotations

from typing import Any

HOST = "192.168.1.23"


def test_snapshot_arrives_first(app_client: Any) -> None:
    """A client receives full state on connect, so it never has to poll."""
    with app_client.websocket_connect("/api/ws") as socket:
        frame = socket.receive_json()
    assert frame["type"] == "snapshot"
    assert frame["devices"] == []
    assert frame["discovered"] == []


def test_the_snapshot_includes_existing_devices(app_client: Any) -> None:
    """Devices registered before the client connected are in its snapshot."""
    app_client.post("/api/devices", json={"host": HOST})
    with app_client.websocket_connect("/api/ws") as socket:
        frame = socket.receive_json()
    assert [d["id"] for d in frame["devices"]] == ["aabbccddeeff"]


def test_registering_a_device_streams_a_delta(app_client: Any) -> None:
    """``device.added`` reaches a connected client without it asking."""
    with app_client.websocket_connect("/api/ws") as socket:
        assert socket.receive_json()["type"] == "snapshot"
        app_client.post("/api/devices", json={"host": HOST})

        types = []
        for _ in range(3):
            frame = socket.receive_json()
            types.append(frame["type"])
            if frame["type"] == "device.added":
                assert frame["device"]["id"] == "aabbccddeeff"
                break
        assert "device.added" in types


def test_removing_a_device_streams_the_id(app_client: Any) -> None:
    """``device.removed`` carries only the id, per the contract."""
    device_id = app_client.post("/api/devices", json={"host": HOST}).json()["id"]
    with app_client.websocket_connect("/api/ws") as socket:
        socket.receive_json()
        app_client.delete(f"/api/devices/{device_id}")

        while True:
            frame = socket.receive_json()
            if frame["type"] == "device.removed":
                assert frame["device_id"] == device_id
                return


def test_ping_gets_a_pong(app_client: Any) -> None:
    """The only accepted client frame is a ping."""
    with app_client.websocket_connect("/api/ws") as socket:
        socket.receive_json()
        socket.send_json({"type": "ping"})
        assert socket.receive_json() == {"type": "pong"}


def test_any_other_client_frame_is_ignored(app_client: Any) -> None:
    """Control goes over REST so it has real status codes; the socket ignores commands."""
    with app_client.websocket_connect("/api/ws") as socket:
        socket.receive_json()
        socket.send_json({"type": "send_key", "key": "DPAD_UP"})
        socket.send_json({"type": "ping"})
        assert socket.receive_json() == {"type": "pong"}


def test_a_client_that_stops_draining_is_dropped(app_client: Any) -> None:
    """A stalled browser tab must not wedge the TV connections.

    The per-client queue is bounded; once it overflows the client is evicted and its
    socket closed, rather than the event bus blocking on it.
    """
    from starlette.websockets import WebSocketDisconnect

    manager = app_client.app.state.devices
    with app_client.websocket_connect("/api/ws") as socket:
        socket.receive_json()
        for index in range(manager.event_bus._maxsize * 4):
            manager.event_bus.publish({"type": "device.state", "n": index})

        # Asserted before draining the socket: if eviction ever regresses this fails here
        # rather than blocking forever on a receive that will never arrive.
        assert manager.event_bus.subscriber_count == 0

        try:
            for _ in range(manager.event_bus._maxsize * 4 + 2):
                socket.receive_json()
        except WebSocketDisconnect:
            pass
        else:  # pragma: no cover - only reached if eviction silently stopped working
            raise AssertionError("the stalled client was never dropped")
