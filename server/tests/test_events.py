# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Tests for the in-process event bus. Verifies fan-out to every subscriber, that publish
# never blocks or awaits, and that a subscriber which stops draining its bounded queue is
# dropped rather than being allowed to apply backpressure to the device callbacks that
# feed the bus.
"""Tests for the in-process event bus."""

from __future__ import annotations

import asyncio

from app.events import EventBus


async def test_publish_fans_out_to_every_subscriber() -> None:
    """Both subscribers receive the same published event."""
    bus = EventBus()
    with bus.subscribe() as first, bus.subscribe() as second:
        bus.publish({"type": "device.state", "device_id": "aabbccddeeff"})
        assert (await asyncio.wait_for(first.get(), 1))["device_id"] == "aabbccddeeff"
        assert (await asyncio.wait_for(second.get(), 1))["device_id"] == "aabbccddeeff"


async def test_unsubscribed_queue_stops_receiving() -> None:
    """Leaving the subscription context removes the queue from the fan-out set."""
    bus = EventBus()
    with bus.subscribe() as queue:
        pass
    bus.publish({"type": "discovery"})
    assert queue.empty()


async def test_slow_subscriber_is_dropped_not_backpressured() -> None:
    """A subscriber that never drains is dropped once its bounded queue overflows.

    Device callbacks run synchronously inside the protocol; if a stalled WebSocket client
    could block them it would stall every other client too.
    """
    bus = EventBus(maxsize=4)
    with bus.subscribe() as queue:
        for index in range(20):
            bus.publish({"type": "device.state", "n": index})
        assert bus.subscriber_count == 0
        # The evicted queue is drained and left holding only the eviction sentinel, which
        # is how the WebSocket handler learns to close the socket.
        assert queue.qsize() == 1
        assert await queue.get() is None


async def test_publish_is_synchronous() -> None:
    """``publish`` is a plain function so protocol callbacks can call it directly."""
    bus = EventBus()
    with bus.subscribe() as queue:
        result = bus.publish({"type": "ping"})
        assert result is None
        assert queue.qsize() == 1
