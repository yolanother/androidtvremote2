# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Domain exception hierarchy for the Android TV Remote appliance. Every exception here
# maps to exactly one machine-readable error.code and HTTP status in the frozen API
# contract, so the REST layer, the WebSocket stream, and the MCP tools can all translate
# failures into identical envelopes without duplicating the mapping table.
"""Domain exception hierarchy for the Android TV Remote appliance."""

from __future__ import annotations

from typing import Any


class RemoteError(Exception):
    """Base class for every expected failure in the appliance.

    :param message: Human-readable explanation, surfaced directly to API clients.
    :param details: Optional structured payload attached to the error envelope.
    """

    #: Machine-readable code emitted as ``error.code``.
    code: str = "internal_error"
    #: HTTP status the REST layer responds with.
    status: int = 500

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        """Initialize the error with a message and optional structured details."""
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        """Render the error as the API contract's error envelope.

        :returns: A dict of the form ``{"error": {"code", "message", "details"?}}``.
        """
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            body["details"] = self.details
        return {"error": body}


class DeviceNotFound(RemoteError):
    """Raised when no registered device matches the supplied device id."""

    code = "device_not_found"
    status = 404


class DeviceExists(RemoteError):
    """Raised when registering a TV whose MAC address is already in the registry."""

    code = "device_exists"
    status = 409


class NotPaired(RemoteError):
    """Raised when a control command targets a device that has no stored certificate."""

    code = "not_paired"
    status = 409


class PairingNotStarted(RemoteError):
    """Raised when a pairing code is submitted before a pairing handshake was started."""

    code = "pairing_not_started"
    status = 409


class InvalidPairingCode(RemoteError):
    """Raised when the TV rejects the pairing code the user entered."""

    code = "invalid_pairing_code"
    status = 400


class Unreachable(RemoteError):
    """Raised when the TV cannot be reached over the network."""

    code = "unreachable"
    status = 503


class InvalidKey(RemoteError):
    """Raised when a requested key is not present in the key catalog."""

    code = "invalid_key"
    status = 400


class Unauthorized(RemoteError):
    """Raised when ``REMOTE_API_TOKEN`` is configured and the request omits or fails it."""

    code = "unauthorized"
    status = 401


class NoMediaSession(RemoteError):
    """Raised when a media transport command targets a device with nothing casting.

    This is the common case rather than an exceptional one: Cast publishes a media session
    only for content cast from a phone or browser, so a TV playing a native app has none.
    """

    code = "no_media_session"
    status = 409


class NotFound(RemoteError):
    """Raised when a request targets an API path that matches no route.

    Exists so that an unmatched ``/api`` path returns the JSON error envelope rather than
    falling through to the single-page-app catch-all and answering 200 with the app shell,
    which any status-code-checking client would read as success.
    """

    code = "not_found"
    status = 404
