# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# MCP (Model Context Protocol) server for the Android TV Remote appliance, exposed over
# streamable HTTP at /mcp so that LLM agents on the LAN can discover, register, pair with,
# and control Android TV devices. Wraps the DeviceManager facade in agent-facing tools and
# resources, translates every domain failure into a recoverable {"error": {...}} envelope
# instead of raising, drives the human-in-the-loop pairing handshake, and guards the
# endpoint with the same optional REMOTE_API_TOKEN bearer token as the REST API.
"""MCP server exposing Android TV discovery, pairing, and control to LLM agents."""

from __future__ import annotations

import asyncio
import contextlib
import functools
import json
import secrets
from typing import TYPE_CHECKING, Any, Awaitable, Callable, TypeVar
from urllib.parse import parse_qs

from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel
from starlette.applications import Starlette
from starlette.routing import Mount, Route

from .config import get_settings
from .errors import RemoteError, Unauthorized

if TYPE_CHECKING:  # pragma: no cover - imported for typing only.
    from starlette.types import Receive, Scope, Send

    # DeviceManager lands on the backend branch. Importing it only under TYPE_CHECKING
    # keeps this module importable — and testable against a stub — without it.
    from .devices import DeviceManager

#: Server name advertised to MCP clients, per docs/design/api-contract.md.
SERVER_NAME = "androidtv-remote"

#: Every tool the frozen API contract requires. Tests assert the server matches exactly.
CONTRACT_TOOLS = (
    "list_devices",
    "discover_devices",
    "register_device",
    "pair_device",
    "complete_pairing",
    "unpair_device",
    "remove_device",
    "rename_device",
    "get_device_state",
    "send_key",
    "send_keys",
    "send_text",
    "launch_app",
    "set_power",
    "set_volume",
    "list_keys",
    "list_apps",
)

#: Pause between presses in a ``send_keys`` macro. The TV's UI needs a beat to move focus
#: before the next press lands, or a "down, down, select" sequence selects the wrong row.
KEY_SEQUENCE_DELAY = 0.15

#: Error code used for tool arguments this layer rejects before reaching the facade. The
#: contract's error table covers device and network failures but has no validation code;
#: this fills that gap without overloading a code that means something else.
INVALID_REQUEST = "invalid_request"

#: Text returned by ``pair_device``. An agent cannot see the television, so the response
#: has to spell out that a human must read the code off the screen.
PAIRING_INSTRUCTIONS = (
    "The television is now showing a 6-character pairing code on its screen. You cannot "
    "see that screen. Ask the person you are talking to to look at the TV and read the "
    "code back to you, then call complete_pairing with this device_id and the code they "
    "give you. The code expires after about 120 seconds; if it does, call pair_device "
    "again to display a fresh one."
)

_T = TypeVar("_T")


def _envelope(error: RemoteError) -> dict[str, Any]:
    """Render a domain error as the contract's error envelope.

    :param error: The failure to report.
    :returns: ``{"error": {"code", "message", "details"?}}``.
    """
    return error.to_dict()


def _fail(code: str, message: str, **details: Any) -> dict[str, Any]:
    """Build an error envelope for a failure that has no ``RemoteError`` class.

    :param code: Machine-readable error code the agent branches on.
    :param message: Human-readable explanation.
    :param details: Optional structured extras attached to the envelope.
    :returns: An error envelope dict.
    """
    body: dict[str, Any] = {"code": code, "message": message}
    if details:
        body["details"] = details
    return {"error": body}


def _dump(model: BaseModel) -> dict[str, Any]:
    """Serialise a Pydantic contract model to JSON-safe primitives.

    :param model: Any model from :mod:`app.models`.
    :returns: A plain dict with datetimes rendered as RFC 3339 strings.
    """
    return model.model_dump(mode="json")


def _dump_all(models: list[Any]) -> list[dict[str, Any]]:
    """Serialise a list of contract models.

    :param models: Models to serialise.
    :returns: A list of plain dicts.
    """
    return [_dump(model) for model in models]


def _never_raises(
    func: Callable[..., Awaitable[dict[str, Any]]],
) -> Callable[..., Awaitable[dict[str, Any]]]:
    """Turn any exception escaping a tool into a recoverable error envelope.

    An MCP tool that raises surfaces to the agent as a protocol-level tool error, which
    carries no machine-readable code and reads as "the server is broken". Agents recover
    far better from a normal result that happens to contain ``error.code``, so every tool
    is wrapped in this.

    :param func: The tool coroutine to wrap.
    :returns: The same coroutine, with failures converted to envelopes.
    """

    @functools.wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            return await func(*args, **kwargs)
        except RemoteError as error:
            return _envelope(error)
        except Exception as error:  # noqa: BLE001 - deliberately total.
            return _fail("internal_error", f"{type(error).__name__}: {error}")

    return wrapper


def build_mcp_server(manager: DeviceManager) -> MCPServer:
    """Build the MCP server exposing every contract tool and resource.

    This is the transport-independent core: it registers the tools and resources against
    the supplied :class:`DeviceManager` and returns the server object, which callers can
    drive directly (tests do) or wrap in an ASGI app via :func:`build_mcp_app`.

    :param manager: The device facade every tool delegates to.
    :returns: A configured :class:`~mcp.server.mcpserver.MCPServer`.
    """
    server: MCPServer = MCPServer(
        name=SERVER_NAME,
        instructions=(
            "Control Android TV and Google TV devices on this local network. Start with "
            "list_devices to see what is already registered and connected. A device must "
            "be paired before it accepts commands: register_device adds it, then "
            "pair_device and complete_pairing complete a two-step handshake that requires "
            "a human to read a code off the television screen. Once paired, drive the TV "
            "with send_key, send_keys, send_text, launch_app, set_power, and set_volume. "
            "Tools never raise: a failure comes back as {\"error\": {\"code\", \"message\"}}, "
            "so read error.code and recover from it."
        ),
    )

    # -- registry ---------------------------------------------------------------

    @server.tool()
    @_never_raises
    async def list_devices() -> dict[str, Any]:
        """List every Android TV registered with this appliance, with its live state.

        Start here. This is the only tool that tells you which device_id values exist, and
        every other device tool needs one. Each device also carries its current connection
        health, whether the screen is on, which app is in the foreground, and the volume
        level, so you usually do not need a follow-up get_device_state call.

        Returns {"devices": [Device], "count": int}. A device with "paired": false will
        reject control commands until you run pair_device on it. A device whose
        state.connection is "unreachable" is registered and paired but currently switched
        off or off the network.
        """
        devices = manager.list_devices()
        return {"devices": _dump_all(devices), "count": len(devices)}

    @server.tool()
    @_never_raises
    async def discover_devices(rescan: bool = False) -> dict[str, Any]:
        """Find Android TVs on the local network that are broadcasting over mDNS.

        Use this when the user wants to add a TV that is not in list_devices yet, or asks
        what televisions are around. Discovery is passive and continuous, so the default
        call returns the current cache instantly. Pass rescan=true only if the cache looks
        stale or a TV was just powered on; it triggers a fresh sweep first and takes a few
        seconds.

        Returns {"devices": [DiscoveredDevice], "count": int}. Each entry has a "host" you
        can hand straight to register_device, plus "registered" and "device_id" telling
        you whether this appliance already knows the TV. Discovery returns nothing when
        the appliance is not on the same network segment as the TVs; in that case register
        the TV by typing its IP address instead.
        """
        if rescan:
            await manager.rescan()
        discovered = manager.list_discovered()
        return {"devices": _dump_all(discovered), "count": len(discovered)}

    @server.tool()
    @_never_raises
    async def register_device(host: str, name: str | None = None) -> dict[str, Any]:
        """Register an Android TV by its IP address or hostname so it can be controlled.

        This is step one of adding a TV; it does not pair. The appliance contacts the TV,
        reads back its MAC address and reported name, and stores it. The MAC becomes the
        permanent device_id, so the registration survives the TV getting a new IP from
        DHCP later.

        Use the "host" from discover_devices, or an IP the user gives you. Pass name only
        to override what the TV calls itself.

        Returns {"device": Device}. Follow immediately with pair_device — a freshly
        registered device has "paired": false and will refuse every command. Errors:
        "device_exists" if this TV is already registered (error.details.device holds the
        existing record), "unreachable" if nothing answered at that address.
        """
        device = await manager.add_device(host, name)
        return {"device": _dump(device)}

    @server.tool()
    @_never_raises
    async def rename_device(device_id: str, name: str) -> dict[str, Any]:
        """Change the display name of a registered device.

        Cosmetic only: the device_id, the pairing, and the connection are untouched. Use
        it when the user says something like "call that one the bedroom TV".

        Returns {"device": Device} with the new name.
        """
        device = await manager.update_device(device_id, name=name)
        return {"device": _dump(device)}

    @server.tool()
    @_never_raises
    async def remove_device(device_id: str) -> dict[str, Any]:
        """Delete a device from the appliance entirely, including its pairing certificate.

        This is the destructive one and it cannot be undone: re-adding the TV afterwards
        means registering AND pairing it again, which needs a human at the television. If
        the user only wants to revoke the pairing but keep the device in the list, use
        unpair_device instead. Confirm with the user before calling this.

        Returns {"removed": true, "device_id": str}.
        """
        await manager.remove_device(device_id)
        return {"removed": True, "device_id": device_id}

    # -- pairing ----------------------------------------------------------------

    @server.tool()
    @_never_raises
    async def pair_device(device_id: str) -> dict[str, Any]:
        """Start pairing with a registered TV. Requires a human to read the TV screen.

        Call this on any device whose "paired" field is false; until it is paired, every
        control command fails with "not_paired". Calling this makes the television display
        a 6-character code.

        YOU CANNOT SEE THAT CODE. You have no view of the television. As soon as this
        returns, stop and ask the person you are talking to to look at the TV and read the
        code out to you, then call complete_pairing with that code. Do not guess a code,
        and do not call complete_pairing until a human has actually given you one.

        Returns {"status": "code_required", "device_id": str, "instructions": str} — the
        instructions field is the message to act on. The code expires after roughly 120
        seconds; if the user takes too long, just call pair_device again for a fresh one.
        """
        await manager.start_pairing(device_id)
        return {
            "status": "code_required",
            "device_id": device_id,
            "instructions": PAIRING_INSTRUCTIONS,
        }

    @server.tool()
    @_never_raises
    async def complete_pairing(device_id: str, code: str) -> dict[str, Any]:
        """Finish pairing using the code a human read off the television screen.

        Only call this after pair_device, and only with a code an actual person gave you.
        On success the device is paired for good: the certificate is written to disk and
        survives restarts, reboots, and the TV changing IP address.

        Returns {"device": Device} with "paired": true. Errors: "invalid_pairing_code" if
        the TV rejected it — ask the user to read it again, digits are easy to mishear, and
        retry; "pairing_not_started" if the session already expired, in which case call
        pair_device again to show a fresh code.
        """
        device = await manager.finish_pairing(device_id, code)
        return {"device": _dump(device)}

    @server.tool()
    @_never_raises
    async def unpair_device(device_id: str) -> dict[str, Any]:
        """Revoke the pairing for a device but keep it in the registry.

        Deletes the stored certificate, so the TV stops trusting this appliance and
        commands start failing with "not_paired" until it is paired again. Use it when a
        pairing has gone bad and needs redoing, or when the user wants to disconnect a TV
        without forgetting it. To delete the device outright, use remove_device.

        Returns {"device": Device} with "paired": false. Re-pair with pair_device.
        """
        device = await manager.unpair(device_id)
        return {"device": _dump(device)}

    # -- state and control ------------------------------------------------------

    @server.tool()
    @_never_raises
    async def get_device_state(device_id: str) -> dict[str, Any]:
        """Read the live state of one TV: connection, power, foreground app, and volume.

        Use it to check a command landed, or before acting so you do not, for example,
        send a power key to a TV that is already on. State is pushed from the TV
        continuously, so this returns instantly and does not poke the device.

        Returns {"device_id": str, "state": DeviceState}. state.connection is one of
        connected, connecting, disconnected, unreachable, unpaired, or disabled. is_on,
        current_app, and volume are null until the TV has reported them — a TV that has
        never connected has nulls, not falses.
        """
        state = manager.get_state(device_id)
        return {"device_id": device_id, "state": _dump(state)}

    @server.tool()
    @_never_raises
    async def send_key(device_id: str, key: str, repeat: int = 1) -> dict[str, Any]:
        """Press one remote-control key on a TV, optionally several times.

        This is the workhorse for navigating the TV interface: DPAD_UP, DPAD_DOWN,
        DPAD_LEFT, DPAD_RIGHT, DPAD_CENTER to select, BACK, HOME, plus transport keys like
        MEDIA_PLAY_PAUSE. Call list_keys for the full catalog. Either the short name
        (DPAD_UP) or the full Android keycode (KEYCODE_DPAD_UP) is accepted.

        Use repeat (1-10) for runs of the same key, such as scrolling down a long list.
        For a sequence of DIFFERENT keys, use send_keys instead — it paces the presses so
        the TV's focus keeps up.

        Returns {"sent": str, "repeat": int, "device_id": str}. The TV does not report what
        the press did, so follow with get_device_state if you need to confirm an effect.
        Errors: "not_paired" if the device has no certificate, "invalid_key" if the key is
        not in the catalog, "unreachable" if the TV is off.
        """
        await manager.send_key(device_id, key, repeat=repeat)
        return {"sent": key, "repeat": repeat, "device_id": device_id}

    @server.tool()
    @_never_raises
    async def send_keys(device_id: str, keys: list[str]) -> dict[str, Any]:
        """Press a sequence of different keys in order, with a pause between each.

        Use this for multi-step navigation in one call — "open the app list, go down three,
        select" becomes ["HOME", "DPAD_DOWN", "DPAD_DOWN", "DPAD_DOWN", "DPAD_CENTER"].
        The pause between presses lets the TV's focus settle, which is why this is more
        reliable than firing send_key repeatedly yourself.

        You are navigating blind: you cannot see the screen, so long speculative sequences
        usually end up somewhere unintended. Prefer short sequences, and check with
        get_device_state or ask the user what is on screen before continuing.

        Returns {"sent": [str], "device_id": str}. If a press fails partway, the error
        envelope's details carry "sent" (the keys that did land) and "failed_at", so you
        know exactly where the TV's focus stopped.
        """
        if not keys:
            return _fail(INVALID_REQUEST, "'keys' must contain at least one key")
        sent: list[str] = []
        for index, key in enumerate(keys):
            try:
                await manager.send_key(device_id, key)
            except RemoteError as error:
                error.details.update({"sent": sent, "failed_at": key})
                return _envelope(error)
            sent.append(key)
            if index + 1 < len(keys):
                await asyncio.sleep(KEY_SEQUENCE_DELAY)
        return {"sent": sent, "device_id": device_id}

    @server.tool()
    @_never_raises
    async def send_text(device_id: str, text: str) -> dict[str, Any]:
        """Type text into whatever field currently has focus on the TV.

        Use it to fill in a search box or a login field, which is far faster than driving
        the on-screen keyboard with D-pad presses. It only works when a text field is
        already focused — open the search UI first (often the SEARCH key, or navigating to
        the app's search box), then call this.

        The text is typed, not submitted. Follow with send_key "ENTER" or "DPAD_CENTER" to
        commit it.

        Returns {"sent": str, "device_id": str}.
        """
        await manager.send_text(device_id, text)
        return {"sent": text, "device_id": device_id}

    @server.tool()
    @_never_raises
    async def launch_app(device_id: str, app: str) -> dict[str, Any]:
        """Open an app on the TV, or jump straight to a deep link inside one.

        Much more reliable than navigating the home screen with D-pad presses. Pass either
        an Android package id ("com.netflix.ninja") or a deep-link URL
        ("https://www.netflix.com/title/80100172"). Call list_apps for the catalog of known
        apps and the exact "launch" token to use for each.

        Whether an arbitrary package is installed is not something this appliance knows;
        launching a missing app is silently ignored by the TV. Confirm with
        get_device_state, whose current_app reflects the foreground app once the TV
        reports it.

        Returns {"launched": str, "device_id": str}.
        """
        await manager.launch_app(device_id, app)
        return {"launched": app, "device_id": device_id}

    @server.tool()
    @_never_raises
    async def set_power(device_id: str, on: bool) -> dict[str, Any]:
        """Turn the TV screen on or off. Safe to call repeatedly.

        This is idempotent: the appliance reads the current power state and only sends the
        power key if it differs, so asking a TV that is already on to turn on does nothing
        rather than turning it off. Prefer this over send_key "POWER", which blindly
        toggles.

        Returns {"device_id": str, "state": DeviceState} reflecting the state after the
        call. If the TV was fully unreachable the call errors with "unreachable" — most
        Android TVs stay reachable when the screen is off, but a TV cut from mains power
        cannot be woken over the network by this appliance.
        """
        state = await manager.set_power(device_id, on)
        return {"device_id": device_id, "state": _dump(state)}

    @server.tool()
    @_never_raises
    async def set_volume(
        device_id: str, action: str | None = None, level: int | None = None
    ) -> dict[str, Any]:
        """Change the TV's volume, either by stepping/muting or by setting a level.

        Supply exactly one of the two arguments:
        - action: "up", "down", "mute", "unmute", or "toggle_mute" — a single step or a
          mute change. Repeat the call for bigger jumps.
        - level: an absolute volume level; the appliance issues the right number of steps
          from the level the TV currently reports.

        Read the current level from get_device_state (state.volume) before setting an
        absolute one, since the scale differs between televisions — state.volume.max tells
        you the range.

        Returns {"device_id": str, "state": DeviceState} with the volume after the change.
        Errors with "invalid_request" if you supply neither argument or both.
        """
        if (action is None) == (level is None):
            return _fail(INVALID_REQUEST, "supply exactly one of 'action' or 'level'")
        state = await manager.set_volume(device_id, action=action, level=level)
        return {"device_id": device_id, "state": _dump(state)}

    # -- catalog ----------------------------------------------------------------

    @server.tool()
    @_never_raises
    async def list_keys(category: str | None = None) -> dict[str, Any]:
        """List the remote-control keys this appliance can send, for use with send_key.

        Call it when you are unsure of the exact name for a key, rather than guessing —
        a name that is not in this catalog fails with "invalid_key". Filter with category
        to keep the response small: "navigation", "transport", "volume", "power",
        "channel", "input", "numeric", or "system".

        Returns {"keys": [KeyDescriptor], "count": int}. Each entry has the short "key"
        name, the full Android "keycode", a human "label", and its "category"; send_key
        accepts either the short name or the keycode.
        """
        keys = manager.list_keys(category)
        return {"keys": _dump_all(keys), "count": len(keys)}

    @server.tool()
    @_never_raises
    async def list_apps() -> dict[str, Any]:
        """List the streaming apps this appliance knows how to launch, for use with launch_app.

        Call it to turn a name the user said ("put on Netflix") into the exact token
        launch_app needs, and to see which apps have deep links available for jumping
        straight to a title.

        Returns {"apps": [AppDescriptor], "count": int}. Pass each entry's "launch" value
        verbatim to launch_app. "deep_link" is the base URL to append a title id to when
        an app supports it. This catalog is a convenience list, not an inventory of what is
        actually installed on any particular television.
        """
        apps = manager.list_apps()
        return {"apps": _dump_all(apps), "count": len(apps)}

    # -- resources ---------------------------------------------------------------

    def _resource(payload: Callable[[], Any]) -> str:
        """Serialise a resource body, reporting failures as an error envelope.

        :param payload: Zero-argument callable producing the JSON-safe body.
        :returns: A JSON string: either the body, or an error envelope.
        """
        try:
            return json.dumps(payload())
        except RemoteError as error:
            return json.dumps(_envelope(error))
        except Exception as error:  # noqa: BLE001 - resources must not raise either.
            return json.dumps(_fail("internal_error", f"{type(error).__name__}: {error}"))

    @server.resource(
        "androidtv://devices",
        name="devices",
        mime_type="application/json",
        description=(
            "Every Android TV registered with this appliance, as a Device[] array with "
            "live connection, power, app, and volume state. Read this for an at-a-glance "
            "picture of the system; use the list_devices tool when you want the same data "
            "inside a tool-calling flow."
        ),
    )
    async def devices_resource() -> str:
        """Serve ``androidtv://devices`` as a JSON ``Device[]``."""
        return _resource(lambda: _dump_all(manager.list_devices()))

    @server.resource(
        "androidtv://devices/{device_id}",
        name="device",
        mime_type="application/json",
        description=(
            "One registered Android TV as a Device object, addressed by its device_id "
            "(the MAC address lowercased with colons stripped, e.g. aabbccddeeff). "
            "Includes its live state. Unknown ids return an error envelope."
        ),
    )
    async def device_resource(device_id: str) -> str:
        """Serve ``androidtv://devices/{device_id}`` as a JSON ``Device``."""
        return _resource(lambda: _dump(manager.get_device(device_id)))

    @server.resource(
        "androidtv://keys",
        name="keys",
        mime_type="application/json",
        description=(
            "The full catalog of remote-control keys this appliance can send, as a "
            "KeyDescriptor[] array. Each entry gives the short key name, the full Android "
            "keycode, a label, and a category. These are the values send_key accepts."
        ),
    )
    async def keys_resource() -> str:
        """Serve ``androidtv://keys`` as a JSON ``KeyDescriptor[]``."""
        return _resource(lambda: _dump_all(manager.list_keys()))

    @server.resource(
        "androidtv://apps",
        name="apps",
        mime_type="application/json",
        description=(
            "The catalog of launchable apps, as an AppDescriptor[] array. Each entry's "
            "'launch' value is what launch_app expects, and 'deep_link' is the base URL "
            "for jumping to a specific title where the app supports it."
        ),
    )
    async def apps_resource() -> str:
        """Serve ``androidtv://apps`` as a JSON ``AppDescriptor[]``."""
        return _resource(lambda: _dump_all(manager.list_apps()))

    return server


class _TokenAuthMiddleware:
    """ASGI middleware enforcing the appliance's optional bearer token on ``/mcp``.

    Mirrors the REST API's rule from docs/design/architecture.md: the token may arrive as
    ``Authorization: Bearer <token>`` or as a ``?token=`` query parameter, and a rejection
    is reported with the contract's error envelope so agents see a machine-readable code.
    """

    def __init__(self, app: Any, token: str) -> None:
        """Wrap an ASGI app with token enforcement.

        :param app: The downstream ASGI application.
        :param token: The required token; never empty, callers skip this class when unset.
        """
        self.app = app
        self.token = token

    def _authorized(self, scope: Scope) -> bool:
        """Check a request scope for a valid token.

        Uses a constant-time comparison so a wrong token cannot be discovered by timing.

        :param scope: The ASGI HTTP scope.
        :returns: ``True`` when the request presented the configured token.
        """
        for key, value in scope.get("headers", []):
            if key.lower() == b"authorization":
                presented = value.decode("latin-1")
                prefix = "Bearer "
                if presented.startswith(prefix) and secrets.compare_digest(
                    presented[len(prefix) :], self.token
                ):
                    return True
        query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
        return any(secrets.compare_digest(value, self.token) for value in query.get("token", []))

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Reject unauthenticated HTTP requests; pass everything else through."""
        if scope["type"] != "http" or self._authorized(scope):
            await self.app(scope, receive, send)
            return
        body = json.dumps(Unauthorized("Missing or invalid API token").to_dict()).encode()
        await send(
            {
                "type": "http.response.start",
                "status": Unauthorized.status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"www-authenticate", b"Bearer"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


class _SingleEndpoint:
    """ASGI shim that routes every request to the app's one streamable-HTTP endpoint.

    The MCP endpoint lives at a single path, but the path the wrapped Starlette app sees
    depends on how the host application attached it: a ``Route("/mcp")`` passes the full
    ``/mcp``, while a ``Mount("/mcp")`` strips the prefix and passes ``""``. Rewriting the
    path to ``/`` makes both work, so the same object can be attached either way.
    """

    def __init__(self, app: Any) -> None:
        """Wrap the streamable-HTTP Starlette app.

        :param app: The downstream ASGI application whose only route is ``/``.
        """
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Normalise the HTTP path to ``/`` and delegate."""
        if scope["type"] == "http":
            scope = dict(scope, path="/", raw_path=b"/")
        await self.app(scope, receive, send)


def build_mcp_app(manager: DeviceManager, token: str | None = None) -> Starlette:
    """Build the streamable-HTTP ASGI app that serves the MCP server.

    The returned app does **not** receive ASGI lifespan events when a host application
    mounts it, so its lifespan must be entered explicitly or the first request fails with
    "Task group is not initialized". :func:`mount_mcp` does that wiring; prefer it unless
    you need the raw app.

    :param manager: The device facade every tool delegates to.
    :param token: Required bearer token. Defaults to ``REMOTE_API_TOKEN`` from the
        environment; auth is skipped entirely when neither is set.
    :returns: A Starlette app whose ``router.lifespan_context`` the caller must enter.
    """
    if token is None:
        token = get_settings().remote_api_token
    app = build_mcp_server(manager).streamable_http_app(
        streamable_http_path="/",
        # This appliance is reached by LAN IP or hostname, not localhost, so the SDK's
        # localhost-only DNS-rebinding defaults would reject every real request.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
    app.add_middleware(_SingleEndpoint)
    if token:
        app.add_middleware(_TokenAuthMiddleware, token=token)
    return app


def mount_mcp(
    host_app: Any, manager: DeviceManager, path: str = "/mcp", token: str | None = None
) -> Starlette:
    """Attach the MCP server to a FastAPI/Starlette application. One call does everything.

    Handles the two things that are easy to get wrong when wiring MCP into an existing
    app:

    1. ``Mount("/mcp")`` compiles to a regex that does not match ``/mcp`` itself, so the
       host router answers 307 to ``/mcp/`` — and the MCP client does not follow
       redirects. Both spellings are registered here so the documented URL works.
    2. A mounted sub-application never receives lifespan events, so the streamable-HTTP
       session manager would never start. Its lifespan is chained onto the host app's.

    Call this from the application factory, before the server starts.

    :param host_app: The FastAPI or Starlette application to attach to.
    :param manager: The device facade every tool delegates to.
    :param path: Path to serve MCP on. Defaults to ``/mcp`` per the API contract.
    :param token: Required bearer token; defaults to ``REMOTE_API_TOKEN``.
    :returns: The MCP ASGI app, for callers that want to inspect it.
    """
    mcp_app = build_mcp_app(manager, token)
    host_app.router.routes.append(
        Route(path, endpoint=mcp_app, methods=["GET", "POST", "DELETE"])
    )
    host_app.router.routes.append(Mount(path, app=mcp_app))

    host_lifespan = host_app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def _chained(app: Any) -> Any:
        """Run the MCP session manager for as long as the host application runs."""
        async with mcp_app.router.lifespan_context(mcp_app):
            async with host_lifespan(app):
                yield

    host_app.router.lifespan_context = _chained
    return mcp_app
