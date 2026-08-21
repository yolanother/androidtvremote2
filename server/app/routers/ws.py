# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# WebSocket event stream for the Android TV Remote appliance. Sends every newly connected
# client a full snapshot of devices and discovery results, then streams deltas as the
# DeviceManager publishes them, so the UI never polls. The only client frame accepted is a
# ping; control goes over REST where it gets real status codes. A client that stops
# draining its bounded queue is evicted and its socket closed, because a stalled browser
# tab must never apply backpressure to the callbacks driving the TV connections.
"""WebSocket event stream for the Android TV Remote appliance."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ..deps import authenticate_websocket, get_manager_from_app
from ..errors import Unauthorized

LOGGER = logging.getLogger(__name__)

router = APIRouter(tags=["events"])

#: Close code sent to a client evicted for not draining its queue.
WS_TRY_AGAIN_LATER = 1013

#: Close code sent when the handshake fails authentication.
WS_POLICY_VIOLATION = 1008


@router.websocket("/ws")
async def event_stream(websocket: WebSocket) -> None:
    """Serve one client the snapshot-then-deltas event stream.

    :param websocket: The incoming WebSocket connection.
    """
    try:
        authenticate_websocket(websocket)
    except Unauthorized:
        await websocket.close(code=WS_POLICY_VIOLATION, reason="A valid API token is required")
        return

    manager = get_manager_from_app(websocket.app)
    await websocket.accept()

    with manager.event_bus.subscribe() as queue:
        await websocket.send_json(manager.snapshot())
        reader = asyncio.create_task(_read_client_frames(websocket))
        try:
            while True:
                event = await queue.get()
                if event is None:
                    # The bus evicted this subscriber for falling too far behind.
                    LOGGER.info("Closing a WebSocket client that stopped draining its queue")
                    await websocket.close(code=WS_TRY_AGAIN_LATER, reason="Too far behind")
                    return
                await websocket.send_json(event)
        except (WebSocketDisconnect, RuntimeError):
            return
        finally:
            reader.cancel()


async def _read_client_frames(websocket: WebSocket) -> None:
    """Answer pings and ignore everything else the client sends.

    :param websocket: The connected WebSocket.
    """
    try:
        while True:
            frame = await websocket.receive_json()
            is_ping = isinstance(frame, dict) and frame.get("type") == "ping"
            if is_ping and websocket.client_state is WebSocketState.CONNECTED:
                await websocket.send_json({"type": "pong"})
    except (WebSocketDisconnect, RuntimeError, ValueError):
        return
