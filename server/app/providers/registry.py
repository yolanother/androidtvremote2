# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Lifecycle-owned registry of optional Android TV Remote providers. Validates provider
# snapshots, associates canonical IDs only with enabled paired TVs, proxies bounded
# device/profile-scoped data and guarded commands, and fans provider changes onto the
# existing event bus. Provider observations stay separate from Cast/remote state; failed
# discovery, missing metadata and provider outages never stop ordinary TV controls.
"""Device-scoped optional provider orchestration and command guards."""

from __future__ import annotations

import asyncio
import json
import logging
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from pydantic import TypeAdapter, ValidationError
from websockets.asyncio.client import connect

from ..config import Settings
from ..devices import DeviceManager
from ..errors import InvalidRequest, NotPaired, ProviderUnavailable
from .client import MAX_RESPONSE_BYTES, ProviderClient, provider_url, segment
from .discovery import ProviderDiscovery
from .models import (
    MEDIA_ACTIONS,
    Browse,
    Catalog,
    Command,
    CommandResult,
    Guide,
    Integration,
    Manifest,
    Playback,
    Profiles,
    ProviderDevice,
    ProviderModel,
    ProviderStatus,
    Title,
)

LOGGER = logging.getLogger(__name__)
PLAYBACK_MAX_AGE = timedelta(seconds=30)
MAX_COMMAND_CACHE = 1000
DEVICE_LIST = TypeAdapter(list[ProviderDevice])


class _ProviderConnect(connect):
    """Provider WebSocket connector that refuses all HTTP upgrade redirects."""

    def process_redirect(self, exc: Exception) -> Exception:
        """Return the failed handshake rather than following a provider-supplied URL."""
        return exc


@dataclass
class _Endpoint:
    """One origin's validated snapshot and its lifecycle-owned event stream."""

    base: str
    manifest: Manifest | None = None
    devices: dict[str, ProviderDevice] = field(default_factory=dict)
    available: bool = False
    enabled: bool = True
    error: str | None = None
    last_seen: datetime | None = None
    stream: asyncio.Task[None] | None = None
    epoch: str | None = None
    sequence: int = -1


class ProviderRegistry:
    """Optional network integrations bound to the appliance's paired televisions.

    :param settings: Provider URLs, request limits and LAN discovery preference.
    :param devices: Existing device manager and shared event bus.
    :param transport: Optional fake HTTP transport; disables real event networking.
    """

    def __init__(
        self, settings: Settings, devices: DeviceManager,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        """Construct the registry without disk or network activity."""
        self.settings = settings
        self.devices = devices
        self._transport = transport
        self._client: ProviderClient | None = None
        self._endpoints: dict[str, _Endpoint] = {}
        self._manual: set[str] = set()
        self._services: dict[str, str] = {}
        self._discovery: ProviderDiscovery | None = None
        self._tasks: set[asyncio.Task[None]] = set()
        self._refresh_lock = asyncio.Lock()
        self._command_locks: dict[str, asyncio.Lock] = {}
        self._commands: OrderedDict[tuple[str, str], tuple[str, CommandResult]] = OrderedDict()
        self._integrations: dict[str, Integration] = {}
        self._statuses: dict[str, ProviderStatus] = {}
        self._started = False

    async def start(self) -> None:
        """Discover providers and begin bounded refresh/event tasks; failures are optional."""
        if self._started:
            return
        self._started = True
        self._client = ProviderClient(self.settings.provider_timeout, self._transport)
        for raw in self.settings.provider_urls.split(","):
            if not raw.strip():
                continue
            try:
                base = provider_url(raw)
            except ValueError:
                LOGGER.warning("Ignoring invalid optional provider URL")
                continue
            self._manual.add(base)
            self._endpoints[base] = _Endpoint(base)
        await self.refresh()
        self._spawn(self._poll())
        self._spawn(self._watch_devices())
        if self.settings.discovery_enabled and self._transport is None:
            self._discovery = ProviderDiscovery(self._discovered)
            try:
                await self._discovery.start()
            except Exception:
                LOGGER.warning("Optional provider multicast discovery unavailable", exc_info=True)
                await self._discovery.stop()
                self._discovery = None

    async def stop(self) -> None:
        """Stop discovery, polls and event sockets before closing the HTTP pool."""
        self._started = False
        if self._discovery is not None:
            await self._discovery.stop()
            self._discovery = None
        tasks = list(self._tasks)
        tasks.extend(e.stream for e in self._endpoints.values() if e.stream is not None)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        for endpoint in self._endpoints.values():
            endpoint.stream = None
        if self._client is not None:
            await self._client.close()
            self._client = None

    async def refresh(self) -> None:
        """Refresh metadata and invalidate bound resources, including expired playback.

        HTTP-only providers may change catalog/playback without changing their device
        inventory. A small device-scoped invalidation also makes that fallback reactive.
        """
        if self._client is None:
            return
        async with self._refresh_lock:
            await asyncio.gather(*(self._refresh_endpoint(e) for e in list(self._endpoints.values())))
            self._publish_all(force_available=True)

    def list_providers(self) -> list[ProviderStatus]:
        """Return discovered provider health without URLs or credentials."""
        return [self._status(endpoint) for endpoint in self._endpoints.values()]

    async def set_enabled(self, provider_id: str, enabled: bool) -> ProviderStatus:
        """Persist provider enablement and immediately recompute affected TV ownership.

        :raises ProviderUnavailable: If the provider ID is absent or ambiguous.
        """
        endpoints = [e for e in self._endpoints.values() if self._status(e).id == provider_id]
        if len(endpoints) != 1:
            raise ProviderUnavailable("Provider identity is missing or ambiguous")
        endpoint = endpoints[0]
        await self.devices.set_setting(f"provider.{provider_id}.enabled", "1" if enabled else "0")
        endpoint.enabled = enabled
        if not enabled and endpoint.stream is not None:
            endpoint.stream.cancel()
            await asyncio.gather(endpoint.stream, return_exceptions=True)
            endpoint.stream = None
        await self.refresh()
        return self._status(endpoint)

    def integration(self, device_id: str) -> Integration:
        """Describe the sole online provider for a paired TV, or an explicit fallback."""
        device = self.devices.get_device(device_id)
        if not device.paired:
            return Integration(device_id=device_id, error="TV is not paired")
        if not device.enabled:
            return Integration(device_id=device_id, error="TV is disabled")
        candidates = self._candidates(device_id)
        if len(candidates) != 1:
            reason = "Multiple providers claim this TV" if candidates else "No compatible provider available"
            return Integration(device_id=device_id, error=reason)
        endpoint, reported = candidates[0]
        assert endpoint.manifest is not None
        return Integration(
            device_id=device_id, available=True, provider_id=endpoint.manifest.id,
            provider_name=endpoint.manifest.name, capabilities=reported.capabilities,
            profile_id=reported.profile_id, profile_revision=reported.profile_revision,
        )

    async def data(
        self, device_id: str, resource: str, *, params: dict[str, str] | None = None,
        item_id: str | None = None,
    ) -> dict[str, Any] | None:
        """Read a validated TV-scoped catalog, guide, browse/profile page or playback.

        :param device_id: Canonical selected TV ID.
        :param resource: A locally allowlisted resource name.
        :param params: Resource-specific query parameters.
        :param item_id: Opaque title identity for detail requests.
        :returns: A validated JSON-safe body, or null for unknown/stale playback.
        :raises ProviderUnavailable: If no sole provider or a bounded request fails.
        :raises InvalidRequest: If capability, guide bounds or profile revision is stale.
        """
        models: dict[str, type[ProviderModel]] = {
            "catalog": Catalog, "browse": Browse, "titles": Title, "guide": Guide,
            "profiles": Profiles, "playback": Playback,
        }
        if resource not in models:
            raise InvalidRequest("Unsupported provider resource")
        endpoint, reported = self._owner(device_id)
        capability = "browse" if resource == "titles" else resource
        self._require_capability(reported, capability)
        if resource == "guide":
            self._guide_window(params or {})
        path = f"devices/{segment(device_id)}/{resource}"
        if resource == "titles":
            if item_id is None:
                raise InvalidRequest("Title identity is required")
            try:
                path += f"/{segment(item_id)}"
            except ValueError as exc:
                raise InvalidRequest(str(exc)) from exc
        raw = await self._request(endpoint, path, params=params)
        # An association/profile can change while awaiting upstream I/O.
        current_endpoint, current = self._owner(device_id)
        if current_endpoint is not endpoint or self._profile(current) != self._profile(reported):
            raise InvalidRequest("TV profile changed while loading provider data", status=409)
        if resource == "playback" and raw is None:
            return None
        try:
            model = models[resource].model_validate(raw)
        except ValidationError as exc:
            self._failed(endpoint, "Provider returned invalid resource data")
            raise ProviderUnavailable("Provider returned invalid resource data") from exc
        if hasattr(model, "profile_revision") and model.profile_revision != reported.profile_revision:
            raise InvalidRequest("Provider response belongs to an outdated profile", status=409)
        if isinstance(model, Playback) and not self._fresh_playback(device_id, model):
            return None
        return model.model_dump(mode="json")

    async def command(self, device_id: str, command: Command) -> CommandResult:
        """Execute one guarded allowlisted command, deduplicating concurrent UUID retries.

        :param device_id: Canonical selected TV ID.
        :param command: Typed command carrying expected profile/session when relevant.
        :returns: Provider acknowledgement, never fabricated playback state.
        :raises NotPaired: If the TV is no longer paired.
        :raises InvalidRequest: For unsupported, conflicting, stale or unavailable actions.
        """
        lock = self._command_locks.setdefault(device_id, asyncio.Lock())
        async with lock:
            await self.refresh()
            endpoint, reported = self._owner(device_id, command=True)
            action = command.action
            capability = {
                "launch": "catalog", "open": "browse", "resume": "browse", "tune": "tune",
                "channel_step": "channel_step", "set_profile": "profiles",
            }.get(action, "playback")
            self._require_capability(reported, capability)
            if "profile_id" in command.model_fields_set and command.profile_id != reported.profile_id:
                raise InvalidRequest("TV profile has changed", status=409)
            if command.profile_revision is not None and command.profile_revision != reported.profile_revision:
                raise InvalidRequest("TV profile has changed", status=409)
            # Expected identity protects this appliance's browser context. It is not
            # part of the external provider v1 command protocol.
            body = command.model_dump(mode="json", exclude_none=True, exclude={"profile_id"})
            body["profile_revision"] = reported.profile_revision
            assert endpoint.manifest is not None
            fingerprint = json.dumps([endpoint.manifest.id, reported.profile_id, body], sort_keys=True)
            key = (device_id, str(command.command_id))
            cached = self._commands.get(key)
            if cached is not None:
                if cached[0] != fingerprint:
                    raise InvalidRequest("Command UUID was reused with a different action or profile", status=409)
                return cached[1]
            if action in MEDIA_ACTIONS:
                playback = await self.data(device_id, "playback")
                if playback is None or playback["session_id"] != command.session_id:
                    raise InvalidRequest("Playback session has changed or expired", status=409)
                if action not in playback["actions"]:
                    raise InvalidRequest("Playback action is unsupported")
                if action == "seek" and playback["duration"] is not None and command.position > playback["duration"]:
                    raise InvalidRequest("Seek position exceeds session duration")
            if action == "launch":
                catalog = await self.data(device_id, "catalog")
                if not any(
                    i["available"] and i["action"]["item_id"] == command.item_id
                    for i in catalog["items"]
                ):
                    raise InvalidRequest("App or service is not available on this TV")
            if action in {"open", "resume"}:
                title = await self.data(device_id, "titles", item_id=command.item_id)
                if not title["available"] or action not in title["actions"]:
                    raise InvalidRequest("Title action is unavailable on this TV")
            if action == "set_profile":
                profiles = await self.data(device_id, "profiles")
                if not any(p["id"] == command.item_id for p in profiles["items"]):
                    raise InvalidRequest("Profile is unavailable on this TV")
            # Recheck immediately before forwarding; a concurrent unpair must take effect.
            current_endpoint, current = self._owner(device_id, command=True)
            if current_endpoint is not endpoint or self._profile(current) != self._profile(reported):
                raise InvalidRequest("Provider association or profile changed", status=409)
            raw = await self._request(endpoint, f"devices/{segment(device_id)}/commands", body=body)
            try:
                result = CommandResult.model_validate(raw)
                if result.command_id != command.command_id:
                    raise ValueError("Acknowledgement refers to another command")
            except (ValidationError, ValueError) as exc:
                raise ProviderUnavailable("Provider returned an invalid command acknowledgement") from exc
            self._commands[key] = (fingerprint, result)
            if len(self._commands) > MAX_COMMAND_CACHE:
                self._commands.popitem(last=False)
            # Keep the acknowledgement under its original deduplication context,
            # even if the TV switched profiles while POST was in flight. Never
            # present it as an accepted action for the new profile, or resend its
            # UUID there when both profiles happen to use the same revision value.
            current_endpoint, current = self._owner(device_id, command=True)
            changed_profile = self._profile(current) != self._profile(reported)
            expected_switch = action == "set_profile" and current.profile_id == command.item_id
            if current_endpoint is not endpoint or (changed_profile and not expected_switch):
                raise InvalidRequest("TV profile changed while executing provider command", status=409)
            return result

    def _spawn(self, coroutine: Any) -> None:
        """Own a background coroutine for the registry's lifetime."""
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _poll(self) -> None:
        """Refresh as an event-stream fallback and expire silent observations."""
        while self._started:
            await asyncio.sleep(self.settings.provider_poll_interval)
            await self.refresh()

    async def _watch_devices(self) -> None:
        """Recompute association when registration, pairing or foreground state changes."""
        with self.devices.event_bus.subscribe() as queue:
            while self._started:
                event = await queue.get()
                if event is None:
                    return
                if event.get("type") in {"device.added", "device.updated", "device.removed", "device.state", "pairing"}:
                    self._publish_all()

    async def _refresh_endpoint(self, endpoint: _Endpoint) -> None:
        """Validate a complete origin snapshot without allowing a failure to escape refresh."""
        if not endpoint.enabled:
            endpoint.available, endpoint.devices, endpoint.error = False, {}, None
            return
        try:
            manifest = Manifest.model_validate(await self._request(endpoint, "manifest"))
            enabled = await self.devices.get_setting(f"provider.{manifest.id}.enabled") != "0"
            endpoint.manifest, endpoint.enabled = manifest, enabled
            if not enabled:
                endpoint.available, endpoint.devices, endpoint.error = False, {}, None
                return
            reported = DEVICE_LIST.validate_python(await self._request(endpoint, "devices"))
            if len(reported) > 1000 or len({d.id for d in reported}) != len(reported):
                raise ValueError("invalid provider device inventory")
            endpoint.devices = {device.id: device for device in reported}
            endpoint.available, endpoint.error = True, None
            endpoint.last_seen = datetime.now(UTC)
            if self._transport is None and (endpoint.stream is None or endpoint.stream.done()):
                endpoint.stream = asyncio.create_task(self._stream(endpoint))
        except (ProviderUnavailable, ValidationError, ValueError) as exc:
            self._failed(endpoint, "Provider snapshot is unavailable or invalid")
            LOGGER.debug("Optional provider refresh failed: %s", type(exc).__name__)

    async def _request(self, endpoint: _Endpoint, path: str, **kwargs: Any) -> Any:
        """Make one bounded request and invalidate failed endpoints immediately."""
        if self._client is None:
            raise ProviderUnavailable("Provider registry is stopped")
        try:
            return await self._client.request(endpoint.base, path, **kwargs)
        except ProviderUnavailable:
            self._failed(endpoint, "Provider request failed")
            raise

    def _failed(self, endpoint: _Endpoint, message: str) -> None:
        """Mark an origin unavailable and notify clients without changing core TV state."""
        endpoint.available = False
        endpoint.devices = {}
        endpoint.error = message
        self._publish_all()

    def _candidates(self, device_id: str) -> list[tuple[_Endpoint, ProviderDevice]]:
        """Return all online, enabled provider claims for exactly this canonical TV ID."""
        return [
            (endpoint, endpoint.devices[device_id])
            for endpoint in self._endpoints.values()
            if endpoint.available and endpoint.enabled and device_id in endpoint.devices
            and endpoint.devices[device_id].online
        ]

    def _owner(self, device_id: str, *, command: bool = False) -> tuple[_Endpoint, ProviderDevice]:
        """Resolve one paired TV without falling back to a name, IP or arbitrary owner."""
        device = self.devices.get_device(device_id)
        if not device.paired:
            raise NotPaired("Pair this TV before using its provider")
        integration = self.integration(device_id)
        if not integration.available:
            raise ProviderUnavailable(integration.error or "Provider unavailable")
        return self._candidates(device_id)[0]

    @staticmethod
    def _profile(device: ProviderDevice) -> tuple[str | None, str]:
        """Identify profile context by identity and revision; revisions aren't globally unique."""
        return device.profile_id, device.profile_revision

    @staticmethod
    def _require_capability(device: ProviderDevice, capability: str) -> None:
        """Refuse operations the selected TV did not advertise."""
        if capability not in device.capabilities:
            raise InvalidRequest(f"This TV does not support {capability}")

    @staticmethod
    def _guide_window(params: dict[str, str]) -> None:
        """Require an explicit timezone-aware increasing guide window of at most 24h."""
        try:
            start = datetime.fromisoformat(params["from"])
            end = datetime.fromisoformat(params["to"])
            if start.tzinfo is None or end.tzinfo is None or not timedelta(0) < end - start <= timedelta(days=1):
                raise ValueError("invalid window")
        except (KeyError, ValueError) as exc:
            raise InvalidRequest("Guide requires timezone-aware from < to within 24 hours") from exc

    def _fresh_playback(self, device_id: str, playback: Playback) -> bool:
        """Accept only active, recent, foreground-compatible sessions; preserve Cast separately."""
        age = datetime.now(UTC) - playback.observed_at
        foreground = self.devices.get_device(device_id).state.current_app
        compatible = not foreground or foreground == "AndroidNativeApp" or not playback.package or foreground == playback.package
        return (
            playback.player_state in {"PLAYING", "PAUSED", "BUFFERING"}
            and timedelta(seconds=-5) <= age <= PLAYBACK_MAX_AGE and compatible
        )

    def _status(self, endpoint: _Endpoint) -> ProviderStatus:
        """Build a credential-free status for an endpoint, including unresolved failures."""
        return ProviderStatus(
            id=endpoint.manifest.id if endpoint.manifest else f"unresolved-{list(self._endpoints).index(endpoint.base)}",
            name=endpoint.manifest.name if endpoint.manifest else "Discovered provider",
            enabled=endpoint.enabled, available=endpoint.available and endpoint.enabled,
            error=endpoint.error, last_seen=endpoint.last_seen,
        )

    def _publish_all(self, *, force_device: str | None = None, force_available: bool = False) -> None:
        """Publish only changed metadata, with forced invalidation for provider events."""
        for endpoint in self._endpoints.values():
            status = self._status(endpoint)
            # last_seen is health metadata, not a reason to wake every browser on each poll.
            previous = self._statuses.get(endpoint.base)
            if previous is None or status.model_dump(exclude={"last_seen"}) != previous.model_dump(exclude={"last_seen"}):
                self.devices.event_bus.publish({"type": "provider.updated", "provider": status.model_dump(mode="json")})
            self._statuses[endpoint.base] = status
        for device in self.devices.list_devices():
            integration = self.integration(device.id)
            previous = self._integrations.get(device.id)
            changed = previous != integration or force_device == device.id
            if force_available and integration.available:
                changed = True
            if (self._endpoints or (previous is not None and previous.available)) and changed:
                self.devices.event_bus.publish({
                    "type": "integration.updated", "device_id": device.id,
                    "integration": integration.model_dump(mode="json"),
                })
            self._integrations[device.id] = integration
        existing = {device.id for device in self.devices.list_devices()}
        self._integrations = {key: value for key, value in self._integrations.items() if key in existing}

    async def _discovered(self, service: str, url: str | None) -> None:
        """Add/remove a DNS-SD origin, retaining manual and other-service references."""
        previous = self._services.pop(service, None)
        if url is not None:
            try:
                base = provider_url(url)
            except ValueError:
                return
            self._services[service] = base
            self._endpoints.setdefault(base, _Endpoint(base))
        if previous and previous not in self._manual and previous not in self._services.values():
            endpoint = self._endpoints.pop(previous, None)
            self._statuses.pop(previous, None)
            if endpoint is not None and endpoint.stream is not None:
                endpoint.stream.cancel()
                await asyncio.gather(endpoint.stream, return_exceptions=True)
        await self.refresh()

    async def _stream(self, endpoint: _Endpoint) -> None:
        """Consume sequenced provider events; refresh after every connection/restart."""
        parsed = urlsplit(endpoint.base)
        url = urlunsplit(("wss" if parsed.scheme == "https" else "ws", parsed.netloc, f"{parsed.path}/events", "", ""))
        while self._started and endpoint.enabled and self._endpoints.get(endpoint.base) is endpoint:
            try:
                async with _ProviderConnect(
                    url, open_timeout=self.settings.provider_timeout, close_timeout=1,
                    max_size=MAX_RESPONSE_BYTES, ping_interval=15, ping_timeout=15, proxy=None,
                ) as socket:
                    # An HTTP snapshot is authoritative even when the stream's first
                    # event is delayed; no replay assumption spans connection epochs.
                    await self.refresh()
                    async for raw in socket:
                        try:
                            event = json.loads(raw)
                            epoch, sequence = event["epoch"], event["sequence"]
                            if not isinstance(epoch, str) or not epoch or type(sequence) is not int or sequence < 0:
                                raise ValueError("invalid event sequence")
                            if epoch == endpoint.epoch and sequence <= endpoint.sequence:
                                continue
                            endpoint.epoch, endpoint.sequence = epoch, sequence
                            await self.refresh()
                            device_id = event.get("device_id")
                            if device_id in endpoint.devices:
                                self._publish_all(force_device=device_id)
                        except (ValueError, KeyError, TypeError):
                            raise ProviderUnavailable("Provider sent invalid event data")
            except asyncio.CancelledError:
                raise
            except Exception:
                LOGGER.debug("Provider event transport failed", exc_info=True)
                # Event transport is an enhancement over bounded HTTP snapshots; its
                # loss must not disable a provider whose catalog/commands still work.
                endpoint.error = "Live events unavailable; refreshing snapshots"
                self._publish_all()
                await asyncio.sleep(self.settings.provider_poll_interval)
