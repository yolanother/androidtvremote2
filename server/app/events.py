# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# In-process publish/subscribe event bus for the Android TV Remote appliance. Fans device,
# state, discovery, and pairing events out from the DeviceManager to every WebSocket
# client and internal subscriber. Publishing is synchronous and never blocks because it is
# called from the protocol library's own callbacks; each subscriber owns a bounded queue
# and a client that stops draining is dropped rather than being allowed to apply
# backpressure to the device connections.
"""In-process publish/subscribe event bus for the Android TV Remote appliance."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

LOGGER = logging.getLogger(__name__)

#: One event frame. Always carries a ``type`` key matching the WebSocket contract.
Event = dict[str, Any]

#: Events a single subscriber may fall behind by before it is dropped.
DEFAULT_QUEUE_SIZE = 256


class EventBus:
    """Fan-out of appliance events to any number of independent subscribers.

    :param maxsize: Maximum number of undelivered events per subscriber before that
        subscriber is dropped.
    """

    def __init__(self, maxsize: int = DEFAULT_QUEUE_SIZE) -> None:
        """Initialize an empty bus."""
        self._maxsize = maxsize
        self._subscribers: set[asyncio.Queue[Event]] = set()

    @property
    def subscriber_count(self) -> int:
        """Number of currently attached subscribers.

        :returns: How many queues the next :meth:`publish` will fan out to.
        """
        return len(self._subscribers)

    @contextmanager
    def subscribe(self) -> Iterator[asyncio.Queue[Event]]:
        """Attach a subscriber for the duration of the ``with`` block.

        :returns: A bounded queue that receives every event published while attached.
        """
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=self._maxsize)
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)

    def publish(self, event: Event) -> None:
        """Deliver an event to every subscriber without blocking.

        Called directly from the protocol library's synchronous callbacks, so it must
        never await. A subscriber whose queue is full is not waited on; it is dropped,
        because one stalled WebSocket client must not stall the device connections or the
        other clients.

        :param event: The event frame to deliver.
        """
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                LOGGER.warning("Dropping event subscriber that fell more than %d events behind", self._maxsize)
                self._subscribers.discard(queue)
