"""Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the repository root.

Pydantic models forming the wire contract of the Android TV Remote appliance. Defines the
Device, DeviceState, DiscoveredDevice, KeyDescriptor and AppDescriptor entities plus every
request body accepted by the REST API, and mirrors docs/design/api-contract.md exactly.
These models are shared verbatim by the REST routers, the WebSocket event stream, and the
MCP tool layer so that all three surfaces expose identical JSON.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ConnectionStatus = Literal[
    "connected", "connecting", "disconnected", "unreachable", "unpaired", "disabled"
]
KeyCategory = Literal[
    "navigation", "transport", "volume", "power", "channel", "input", "numeric", "system"
]
KeyDirection = Literal["SHORT", "START_LONG", "END_LONG"]
VolumeAction = Literal["up", "down", "mute", "unmute", "toggle_mute"]
PairingStatus = Literal["code_required", "paired", "failed", "timeout"]


class VolumeInfo(BaseModel):
    """Volume readout reported by the TV over the remote protocol."""

    level: int | None = Field(default=None, description="Current volume step, or null if unknown.")
    max: int | None = Field(default=None, description="Highest volume step the TV accepts.")
    muted: bool = Field(default=False, description="Whether the TV is currently muted.")


class DeviceState(BaseModel):
    """Live, non-persisted view of a device: connection health and last-known TV state."""

    connection: ConnectionStatus = Field(description="Current connection lifecycle stage.")
    is_on: bool | None = Field(default=None, description="Screen power state, null until reported.")
    current_app: str | None = Field(default=None, description="Foreground app package or URL.")
    volume: VolumeInfo | None = Field(default=None, description="Volume readout, null until reported.")
    last_seen: datetime | None = Field(default=None, description="When the TV last answered.")
    error: str | None = Field(default=None, description="Reason for an unreachable/unpaired state.")


class Device(BaseModel):
    """A registered Android TV.

    ``id`` is derived from the MAC address rather than the IP so that a DHCP lease change
    never orphans a pairing.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(description="MAC address, lowercased with colons stripped.")
    name: str = Field(description="Operator-assigned display name.")
    host: str = Field(description="Current IP address or hostname; mutable.")
    mac: str = Field(description="Colon-separated MAC address.")
    mdns_name: str | None = Field(default=None, description="Full mDNS service instance name.")
    model: str | None = Field(default=None, description="Model string the TV reports.")
    paired: bool = Field(description="Whether a valid certificate is stored for this device.")
    enabled: bool = Field(default=True, description="Whether the manager holds a connection open.")
    created_at: datetime = Field(description="When the device was first registered.")
    state: DeviceState = Field(description="Live connection and TV state.")


class DiscoveredDevice(BaseModel):
    """A TV seen by the mDNS browser, which may or may not already be registered."""

    mdns_name: str = Field(description="Full mDNS service instance name.")
    display_name: str = Field(description="Human-friendly name parsed from the service name.")
    addresses: list[str] = Field(default_factory=list, description="Every resolved address.")
    host: str = Field(description="Preferred IPv4 address for connecting.")
    registered: bool = Field(default=False, description="True if this TV is already registered.")
    device_id: str | None = Field(default=None, description="Registered device id, when known.")
    last_seen: datetime = Field(description="When the browser last saw this service.")


class KeyDescriptor(BaseModel):
    """One sendable key, in both its short form and its full Android keycode."""

    key: str = Field(description="Short form, e.g. DPAD_UP.")
    keycode: str = Field(description="Full Android keycode, e.g. KEYCODE_DPAD_UP.")
    label: str = Field(description="Human-readable label for UI rendering.")
    category: KeyCategory = Field(description="Grouping used to lay out the key catalog.")


class AppDescriptor(BaseModel):
    """A launchable app. ``launch`` is passed verbatim to the TV."""

    id: str = Field(description="Stable slug used by the UI and MCP tools.")
    name: str = Field(description="Display name.")
    package: str | None = Field(default=None, description="Android package id, when known.")
    deep_link: str | None = Field(default=None, description="Base deep-link URL, when known.")
    launch: str = Field(description="Package id or URL sent to send_launch_app_command.")
    icon: str | None = Field(default=None, description="Icon slug resolved by the frontend.")


class RegisterDeviceRequest(BaseModel):
    """Body for ``POST /api/devices``."""

    host: str = Field(description="IP address or hostname of the TV to register.")
    name: str | None = Field(default=None, description="Display name; defaults to the TV's own.")


class UpdateDeviceRequest(BaseModel):
    """Body for ``PATCH /api/devices/{id}``. Omitted fields are left unchanged."""

    name: str | None = Field(default=None, description="New display name.")
    host: str | None = Field(default=None, description="New IP address or hostname.")
    enabled: bool | None = Field(default=None, description="Whether to hold a connection open.")


class CompletePairingRequest(BaseModel):
    """Body for ``POST /api/devices/{id}/pair/complete``."""

    code: str = Field(min_length=1, description="Pairing code displayed on the TV screen.")


class SendKeyRequest(BaseModel):
    """Body for ``POST /api/devices/{id}/keys``."""

    key: str = Field(description="Short form or full keycode.")
    direction: KeyDirection = Field(default="SHORT", description="Press semantics.")
    repeat: int = Field(default=1, ge=1, le=10, description="How many times to send the key.")


class SendTextRequest(BaseModel):
    """Body for ``POST /api/devices/{id}/text``."""

    text: str = Field(description="Text typed into the focused field on the TV.")


class LaunchAppRequest(BaseModel):
    """Body for ``POST /api/devices/{id}/launch``."""

    app: str = Field(description="Package id or deep-link URL to launch.")


class SetPowerRequest(BaseModel):
    """Body for ``POST /api/devices/{id}/power``.

    ``on`` is nullable on purpose: an explicit boolean makes the call idempotent, which is
    what lets Home Assistant retry safely, while ``null`` means "toggle regardless".
    """

    on: bool | None = Field(default=None, description="Desired power state, or null to toggle.")


class SetVolumeRequest(BaseModel):
    """Body for ``POST /api/devices/{id}/volume``. Supply exactly one of the two fields."""

    action: VolumeAction | None = Field(default=None, description="Step or mute action.")
    level: int | None = Field(default=None, ge=0, description="Absolute volume level to reach.")

    @model_validator(mode="after")
    def _exactly_one(self) -> SetVolumeRequest:
        """Reject bodies that set neither or both of ``action`` and ``level``.

        :raises ValueError: If the caller did not supply exactly one field.
        :returns: The validated model.
        """
        if (self.action is None) == (self.level is None):
            raise ValueError("supply exactly one of 'action' or 'level'")
        return self


class StartPairingResponse(BaseModel):
    """Response from ``POST /api/devices/{id}/pair``."""

    status: Literal["code_required"] = Field(default="code_required")


class HealthResponse(BaseModel):
    """Response from the always-unauthenticated ``GET /healthz``."""

    status: Literal["ok"] = Field(default="ok")
    devices: int = Field(description="Number of registered devices.")
    connected: int = Field(description="Number of devices with a live connection.")
    version: str = Field(description="Application version.")
