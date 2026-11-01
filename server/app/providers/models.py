# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Validated version-1 wire models for optional Android TV Remote providers. Defines
# provider/TV identities, device-scoped browsing and guide data, observed media sessions
# and the fixed command allowlist. Appliance commands additionally carry an optional
# expected profile identity, stripped before forwarding the external v1 payload.
# Unknown response fields are discarded so private
# upstream state cannot accidentally become part of the remote's public API.
"""Versioned provider data and command contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..models import MediaAction, PlayerState

CAPABILITIES = frozenset({"catalog", "browse", "guide", "tune", "channel_step", "playback", "profiles"})
MEDIA_ACTIONS = frozenset({"play", "pause", "play_pause", "stop", "seek", "next", "previous"})
CommandAction = Literal[
    "launch", "open", "resume", "tune", "channel_step", "set_profile",
    "play", "pause", "play_pause", "stop", "seek", "next", "previous",
]


class ProviderModel(BaseModel):
    """A validated upstream response that drops unrecognized/private properties."""

    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)


class Manifest(ProviderModel):
    """A provider's stable identity and supported protocol major version."""

    id: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$", description="Stable provider slug.")
    name: str = Field(min_length=1, max_length=200, description="Human-readable provider name.")
    version: Literal[1] = Field(description="Supported provider protocol major.")

    @field_validator("version", mode="before")
    @classmethod
    def _integer_version(cls, value: object) -> object:
        """Reject boolean/string versions instead of coercing them into version one."""
        if type(value) is not int:
            raise ValueError("version must be an integer")
        return value


class ProviderDevice(ProviderModel):
    """One live launcher registration, identified by the Remote Service certificate."""

    id: str = Field(pattern=r"^[0-9a-f]{12}$", description="Canonical certificate MAC, normalized.")
    name: str = Field(max_length=200, description="Launcher television display name.")
    online: bool = Field(description="Whether the launcher can currently receive commands.")
    capabilities: list[str] = Field(default_factory=list, max_length=32, description="Supported capabilities.")
    profile_id: str | None = Field(default=None, max_length=200, description="Active television profile.")
    profile_revision: str = Field(default="", max_length=200, description="Active profile revision.")

    @field_validator("id")
    @classmethod
    def _real_identity(cls, value: str) -> str:
        """Reject missing-hardware placeholder identities shared by unrelated devices."""
        if value in {"000000000000", "020000000000", "ffffffffffff"}:
            raise ValueError("placeholder television identity")
        return value

    @field_validator("capabilities")
    @classmethod
    def _known_capabilities(cls, value: list[str]) -> list[str]:
        """Ignore future capabilities while exposing only this client's action surface."""
        return sorted(set(value) & CAPABILITIES)


class Integration(ProviderModel):
    """Availability and capabilities of the sole provider associated with one TV."""

    device_id: str = Field(description="Remote appliance's canonical television ID.")
    available: bool = Field(default=False, description="A sole usable provider owns this television.")
    provider_id: str | None = Field(default=None, description="Selected provider identity.")
    provider_name: str | None = Field(default=None, description="Selected provider name.")
    capabilities: list[str] = Field(default_factory=list, description="Capabilities for this TV/profile.")
    profile_id: str | None = Field(default=None, description="Current profile, when known.")
    profile_revision: str = Field(default="", description="Current profile's revision.")
    error: str | None = Field(default=None, description="Why an integration is unavailable.")


class ProviderStatus(ProviderModel):
    """Discovery/connection state of one provider endpoint, without credentials."""

    id: str = Field(description="Provider manifest ID or unresolved endpoint identity.")
    name: str = Field(description="Provider display name.")
    enabled: bool = Field(description="Whether the operator permits this provider.")
    available: bool = Field(description="Whether a valid provider snapshot is reachable.")
    error: str | None = Field(default=None, description="Last bounded connection failure.")
    last_seen: datetime | None = Field(default=None, description="Last valid provider snapshot.")


class LaunchAction(ProviderModel):
    """The catalog's fixed, opaque launch action; no executable code or URLs."""

    type: Literal["launch"] = Field(description="Only catalog launch is allowed.")
    item_id: str = Field(min_length=1, max_length=512, description="Provider-scoped catalog item.")


class CatalogItem(ProviderModel):
    """An installed app or service accessible through a player on this television."""

    id: str = Field(min_length=1, max_length=512, description="Opaque provider-scoped ID.")
    name: str = Field(max_length=300, description="Item display name.")
    kind: Literal["app", "service"] = Field(description="Installed app or playable service.")
    package: str | None = Field(default=None, max_length=300, description="Associated Android package.")
    icon_url: str | None = Field(default=None, max_length=4096, description="Optional artwork URL.")
    available: bool = Field(description="This TV/profile can launch the entry.")
    action: LaunchAction = Field(description="Provider action behind the tile.")


class Catalog(ProviderModel):
    """A bounded television/profile-specific app and service catalog."""

    revision: str = Field(description="Catalog revision.")
    profile_revision: str = Field(description="Profile revision used to filter the catalog.")
    items: list[CatalogItem] = Field(max_length=2000, description="Available and unavailable entries.")


class Title(ProviderModel):
    """Title metadata for search, continue watching and detail views."""

    id: str = Field(min_length=1, max_length=512, description="Opaque provider title ID.")
    title: str = Field(max_length=1000, description="Human-readable title.")
    subtitle: str | None = Field(default=None, max_length=2000, description="Optional descriptive line.")
    image_url: str | None = Field(default=None, max_length=4096, description="Optional artwork URL.")
    available: bool = Field(default=True, description="Whether this television can open the title.")
    actions: list[Literal["open", "resume"]] = Field(default_factory=list, description="Allowed title actions.")


class Browse(ProviderModel):
    """One bounded page of television/profile-filtered titles."""

    revision: str = Field(description="Browse content revision.")
    profile_revision: str = Field(description="Profile revision used for this page.")
    items: list[Title] = Field(max_length=500, description="One page of matching titles.")
    next_cursor: str | None = Field(default=None, max_length=2000, description="Opaque next-page cursor.")


class Programme(ProviderModel):
    """One authoritative programme interval in a provider's channel lineup."""

    id: str = Field(min_length=1, max_length=512, description="Stable programme identity.")
    title_id: str = Field(min_length=1, max_length=512, description="Provider title behind the interval.")
    title: str = Field(max_length=1000, description="Programme title.")
    subtitle: str | None = Field(default=None, max_length=2000, description="Optional episode detail.")
    image_url: str | None = Field(default=None, max_length=4096, description="Optional programme artwork.")
    start: datetime = Field(description="Inclusive UTC programme start.")
    end: datetime = Field(description="Exclusive UTC programme end.")
    available: bool = Field(description="Whether this TV/profile can open the title.")

    @model_validator(mode="after")
    def _valid_interval(self) -> Programme:
        """Require timezone-aware increasing programme boundaries."""
        if self.start.tzinfo is None or self.end.tzinfo is None or self.start >= self.end:
            raise ValueError("programme must have timezone-aware start < end")
        return self


class Channel(ProviderModel):
    """One stable channel and its bounded set of scheduled programmes."""

    id: str = Field(min_length=1, max_length=512, description="Provider channel identity.")
    name: str = Field(max_length=300, description="Channel label.")
    number: int = Field(ge=0, description="Provider lineup order/number.")
    kind: Literal["recommendation", "live"] = Field(description="Recommendation schedule or live EPG.")
    programmes: list[Programme] = Field(max_length=1000, description="Programme intervals.")


class Guide(ProviderModel):
    """An authoritative, bounded guide for one television/profile."""

    revision: str = Field(description="Schedule revision shared with the launcher.")
    profile_revision: str = Field(description="Profile revision used for this lineup.")
    timezone: str = Field(max_length=100, description="TV's IANA timezone.")
    server_time: datetime = Field(description="Provider observation time.")
    channels: list[Channel] = Field(max_length=500, description="Channels in provider order.")


class Profile(ProviderModel):
    """A non-secret profile choice exposed by the television's launcher."""

    id: str = Field(min_length=1, max_length=200, description="Opaque launcher profile identity.")
    name: str = Field(max_length=300, description="Profile label.")
    image_url: str | None = Field(default=None, max_length=4096, description="Optional profile artwork.")


class Profiles(ProviderModel):
    """Current profile and safe picker choices; excludes account administration."""

    items: list[Profile] = Field(max_length=100, description="Selectable profiles.")
    active_id: str | None = Field(default=None, description="Current TV profile identity.")
    revision: str = Field(description="Current profile revision.")


class Playback(ProviderModel):
    """An observed media session, independent of Cast and resume history."""

    session_id: str = Field(min_length=1, max_length=512, description="Opaque observed session identity.")
    package: str | None = Field(default=None, max_length=300, description="Foreground player's Android package.")
    title: str | None = Field(default=None, max_length=1000, description="Observed content title, if provided.")
    subtitle: str | None = Field(default=None, max_length=2000, description="Observed secondary metadata.")
    images: list[str] = Field(default_factory=list, max_length=32, description="Observed artwork URLs.")
    player_state: PlayerState = Field(default="UNKNOWN", description="Observed transport state.")
    position: float | None = Field(default=None, ge=0, description="Playback offset in seconds.")
    duration: float | None = Field(default=None, ge=0, description="Duration in seconds, if known.")
    position_at: datetime | None = Field(default=None, description="Timestamp of position sample.")
    observed_at: datetime = Field(description="When the launcher observed this media state.")
    channel_id: str | None = Field(default=None, max_length=512, description="Confirmed channel, if observable.")
    actions: list[MediaAction] = Field(default_factory=list, max_length=7, description="Supported transport actions.")

    @field_validator("observed_at", "position_at")
    @classmethod
    def _aware_time(cls, value: datetime | None) -> datetime | None:
        """Reject ambiguous timestamps rather than guessing a remote timezone."""
        if value is not None and value.tzinfo is None:
            raise ValueError("playback timestamps must include a timezone")
        return value


class Command(BaseModel):
    """Allowlisted, deduplicated provider action against the currently selected TV."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    command_id: UUID = Field(description="Client-generated UUID for command deduplication.")
    action: CommandAction = Field(description="Allowlisted action to perform.")
    item_id: str | None = Field(default=None, max_length=512, description="Catalog, title or profile ID.")
    channel_id: str | None = Field(default=None, max_length=512, description="Provider channel to tune.")
    direction: Literal["up", "down"] | None = Field(default=None, description="Channel-step direction.")
    session_id: str | None = Field(default=None, max_length=512, description="Expected observed media session.")
    position: float | None = Field(default=None, ge=0, description="Seek offset in seconds.")
    profile_id: str | None = Field(
        default=None, max_length=200,
        description="Optional appliance-only expected profile identity; explicit null is meaningful.",
    )
    profile_revision: str | None = Field(default=None, max_length=200, description="Expected profile revision.")
    schedule_revision: str | None = Field(default=None, max_length=200, description="Expected schedule revision.")

    @model_validator(mode="after")
    def _action_arguments(self) -> Command:
        """Reject incomplete or misleading commands before they reach a provider."""
        if self.action in {"launch", "open", "resume", "set_profile"} and not self.item_id:
            raise ValueError("this action requires item_id")
        if self.action == "tune" and not self.channel_id:
            raise ValueError("tune requires channel_id")
        if self.action == "channel_step" and not self.direction:
            raise ValueError("channel_step requires direction")
        if self.action in MEDIA_ACTIONS and not self.session_id:
            raise ValueError("media commands require session_id")
        if (self.action == "seek") != (self.position is not None):
            raise ValueError("position is required only for seek")
        return self


class CommandResult(ProviderModel):
    """Provider acknowledgement; acceptance does not claim playback was observed."""

    command_id: UUID = Field(description="UUID of the acknowledged command.")
    status: Literal["accepted", "completed", "failed"] = Field(description="Provider command disposition.")
    error: str | None = Field(default=None, max_length=2000, description="Bounded failure description.")


class ProviderEnableRequest(BaseModel):
    """Operator preference for a discovered provider."""

    enabled: bool = Field(description="Whether this provider should integrate.")
