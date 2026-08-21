# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Test suite for the Android TV Remote MCP server. Exercises the agent-facing tool and
# resource surface against a stub DeviceManager that implements the frozen facade from
# docs/design/api-contract.md, so the MCP stream can be verified with no real backend,
# no network, and no paired television present. Covers tool registration coverage
# against the contract, the never-raise error envelope, the human-in-the-loop pairing
# instructions, key-sequence ordering, and bearer-token enforcement on the HTTP mount.
"""Test suite for the Android TV Remote MCP server."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

# The MCP module lives in the ``app`` package under ``server/``; make it importable no
# matter which directory pytest was invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.errors import DeviceNotFound, InvalidPairingCode, RemoteError  # noqa: E402
from app.models import (  # noqa: E402
    AppDescriptor,
    Device,
    DeviceState,
    DiscoveredDevice,
    KeyDescriptor,
    VolumeInfo,
)
from app.mcp_server import (  # noqa: E402
    CONTRACT_TOOLS,
    build_mcp_app,
    build_mcp_server,
    mount_mcp,
)

NOW = datetime(2026, 8, 21, 18, 4, tzinfo=timezone.utc)
DEVICE_ID = "aabbccddeeff"


class StubDeviceManager:
    """In-memory stand-in for the real ``DeviceManager`` facade.

    Implements exactly the surface declared in ``docs/design/api-contract.md`` so the MCP
    layer can be tested without the backend stream. Every call is recorded in
    :attr:`calls` so tests can assert ordering, and :attr:`fail_with` lets a test make the
    next facade call raise a chosen exception.
    """

    def __init__(self) -> None:
        """Create a stub holding one registered, paired device."""
        self.calls: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []
        self.fail_with: BaseException | None = None
        self.device = Device(
            id=DEVICE_ID,
            name="Living Room TV",
            host="192.168.1.23",
            mac="aa:bb:cc:dd:ee:ff",
            mdns_name="BRAVIA 4K GB._androidtvremote2._tcp.local.",
            model="BRAVIA 4K GB",
            paired=True,
            enabled=True,
            created_at=NOW,
            state=self._state(),
        )

    @staticmethod
    def _state() -> DeviceState:
        """Build a representative connected device state."""
        return DeviceState(
            connection="connected",
            is_on=True,
            current_app="com.netflix.ninja",
            volume=VolumeInfo(level=12, max=100, muted=False),
            last_seen=NOW,
            error=None,
        )

    def _record(_self, _name: str, /, *args: Any, **kwargs: Any) -> None:
        """Record a facade call and raise :attr:`fail_with` if a test armed it.

        Both parameters are positional-only and underscore-prefixed because facade calls
        legitimately pass keyword arguments called ``name`` and ``self``.
        """
        _self.calls.append((_name, args, kwargs))
        if _self.fail_with is not None:
            error, _self.fail_with = _self.fail_with, None
            raise error

    # -- registry ---------------------------------------------------------------

    def list_devices(self) -> list[Device]:
        """Return every registered device."""
        self._record("list_devices")
        return [self.device]

    def get_device(self, device_id: str) -> Device:
        """Return one device or raise :class:`DeviceNotFound`."""
        self._record("get_device", device_id)
        if device_id != DEVICE_ID:
            raise DeviceNotFound(f"No device with id {device_id}")
        return self.device

    async def add_device(self, host: str, name: str | None = None) -> Device:
        """Register a device by host address."""
        self._record("add_device", host, name)
        return self.device

    async def update_device(
        self,
        device_id: str,
        *,
        name: str | None = None,
        host: str | None = None,
        enabled: bool | None = None,
    ) -> Device:
        """Mutate a registered device's attributes."""
        self._record("update_device", device_id, name=name, host=host, enabled=enabled)
        return self.device

    async def remove_device(self, device_id: str) -> None:
        """Delete a device and its certificates."""
        self._record("remove_device", device_id)

    # -- pairing ----------------------------------------------------------------

    async def start_pairing(self, device_id: str) -> None:
        """Begin the pairing handshake so the TV displays a code."""
        self._record("start_pairing", device_id)

    async def finish_pairing(self, device_id: str, code: str) -> Device:
        """Complete pairing with the code the human read off the TV."""
        self._record("finish_pairing", device_id, code)
        return self.device

    async def unpair(self, device_id: str) -> Device:
        """Drop the stored certificate but keep the registration."""
        self._record("unpair", device_id)
        return self.device

    # -- control ----------------------------------------------------------------

    def get_state(self, device_id: str) -> DeviceState:
        """Return the live state of one device or raise :class:`DeviceNotFound`."""
        self._record("get_state", device_id)
        if device_id != DEVICE_ID:
            raise DeviceNotFound(f"No device with id {device_id}")
        return self._state()

    async def send_key(
        self, device_id: str, key: str, direction: str = "SHORT", repeat: int = 1
    ) -> None:
        """Send one key press."""
        self._record("send_key", device_id, key, direction=direction, repeat=repeat)

    async def send_text(self, device_id: str, text: str) -> None:
        """Type text into the focused field."""
        self._record("send_text", device_id, text)

    async def launch_app(self, device_id: str, app: str) -> None:
        """Launch a package id or deep link."""
        self._record("launch_app", device_id, app)

    async def set_power(self, device_id: str, on: bool | None) -> DeviceState:
        """Set screen power idempotently."""
        self._record("set_power", device_id, on)
        return self._state()

    async def set_volume(
        self, device_id: str, action: str | None = None, level: int | None = None
    ) -> DeviceState:
        """Step, mute, or set an absolute volume level."""
        self._record("set_volume", device_id, action=action, level=level)
        return self._state()

    # -- discovery and catalog ---------------------------------------------------

    def list_discovered(self) -> list[DiscoveredDevice]:
        """Return the mDNS browser's current cache."""
        self._record("list_discovered")
        return [
            DiscoveredDevice(
                mdns_name="SHIELD._androidtvremote2._tcp.local.",
                display_name="SHIELD",
                addresses=["192.168.1.140"],
                host="192.168.1.140",
                registered=False,
                device_id=None,
                last_seen=NOW,
            )
        ]

    async def rescan(self) -> None:
        """Kick a fresh mDNS sweep."""
        self._record("rescan")

    def list_keys(self, category: str | None = None) -> list[KeyDescriptor]:
        """Return the key catalog, optionally filtered by category."""
        self._record("list_keys", category)
        keys = [
            KeyDescriptor(key="DPAD_UP", keycode="KEYCODE_DPAD_UP", label="Up", category="navigation"),
            KeyDescriptor(key="VOLUME_UP", keycode="KEYCODE_VOLUME_UP", label="Volume up", category="volume"),
        ]
        if category is not None:
            keys = [key for key in keys if key.category == category]
        return keys

    def list_apps(self) -> list[AppDescriptor]:
        """Return the launchable-app catalog."""
        self._record("list_apps")
        return [
            AppDescriptor(
                id="netflix",
                name="Netflix",
                package="com.netflix.ninja",
                deep_link="https://www.netflix.com/title/",
                launch="com.netflix.ninja",
                icon="netflix",
            )
        ]


@pytest.fixture()
def manager() -> StubDeviceManager:
    """Provide a fresh stub device manager per test."""
    return StubDeviceManager()


@pytest.fixture()
def server(manager: StubDeviceManager):
    """Provide an ``MCPServer`` wired to the stub manager."""
    return build_mcp_server(manager)


async def call(server: Any, tool: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Invoke a tool and return its structured JSON payload.

    Arguments are passed as a dict rather than as ``**kwargs`` because several contract
    tools take an argument called ``name``, which would collide with this helper's own
    parameters.

    :param server: The ``MCPServer`` under test.
    :param tool: Tool name to invoke.
    :param args: Tool arguments.
    :returns: The tool's structured content as a plain dict.
    """
    result = await server.call_tool(tool, args or {})
    assert result.structured_content is not None, f"{tool} returned no structured content"
    return dict(result.structured_content)


async def read(server: Any, uri: str) -> Any:
    """Read a resource and parse its JSON body."""
    contents = list(await server.read_resource(uri))
    assert len(contents) == 1
    return json.loads(contents[0].content)


# -- contract coverage ----------------------------------------------------------


async def test_every_contract_tool_is_registered(server: Any) -> None:
    """The server exposes exactly the tool set the frozen contract lists."""
    registered = {tool.name for tool in await server.list_tools()}
    assert registered == set(CONTRACT_TOOLS)


async def test_every_tool_has_an_agent_facing_description(server: Any) -> None:
    """Descriptions are the product: every tool ships a substantial one."""
    for tool in await server.list_tools():
        assert tool.description, f"{tool.name} has no description"
        assert len(tool.description) > 80, f"{tool.name} description is too thin to be usable"


async def test_all_four_contract_resources_are_registered(server: Any) -> None:
    """Both static resources and both templated resources are present."""
    static = {str(resource.uri) for resource in await server.list_resources()}
    templates = {template.uri_template for template in await server.list_resource_templates()}
    assert static == {"androidtv://devices", "androidtv://keys", "androidtv://apps"}
    assert templates == {"androidtv://devices/{device_id}"}


# -- error envelope -------------------------------------------------------------


async def test_domain_errors_return_an_envelope_instead_of_raising(
    server: Any, manager: StubDeviceManager
) -> None:
    """A ``RemoteError`` from the facade comes back as ``{"error": {...}}``."""
    payload = await call(server, "get_device_state", {"device_id": "000000000000"})
    assert payload["error"]["code"] == "device_not_found"
    assert "000000000000" in payload["error"]["message"]


async def test_unexpected_errors_return_an_internal_error_envelope(
    server: Any, manager: StubDeviceManager
) -> None:
    """A non-domain exception is caught and reported as ``internal_error``."""
    manager.fail_with = ZeroDivisionError("boom")
    payload = await call(server, "list_devices")
    assert payload["error"]["code"] == "internal_error"
    assert "boom" in payload["error"]["message"]


async def test_invalid_pairing_code_is_recoverable(server: Any, manager: StubDeviceManager) -> None:
    """A rejected pairing code is an envelope the agent can retry from."""
    manager.fail_with = InvalidPairingCode("The TV rejected that code")
    payload = await call(server, "complete_pairing", {"device_id": DEVICE_ID, "code": "000000"})
    assert payload["error"]["code"] == "invalid_pairing_code"


@pytest.mark.parametrize(
    ("tool", "kwargs"),
    [
        ("list_devices", {}),
        ("discover_devices", {}),
        ("register_device", {"host": "192.168.1.23"}),
        ("pair_device", {"device_id": DEVICE_ID}),
        ("complete_pairing", {"device_id": DEVICE_ID, "code": "123456"}),
        ("unpair_device", {"device_id": DEVICE_ID}),
        ("remove_device", {"device_id": DEVICE_ID}),
        ("rename_device", {"device_id": DEVICE_ID, "name": "Den"}),
        ("get_device_state", {"device_id": DEVICE_ID}),
        ("send_key", {"device_id": DEVICE_ID, "key": "DPAD_UP"}),
        ("send_keys", {"device_id": DEVICE_ID, "keys": ["DPAD_UP"]}),
        ("send_text", {"device_id": DEVICE_ID, "text": "hi"}),
        ("launch_app", {"device_id": DEVICE_ID, "app": "com.netflix.ninja"}),
        ("set_power", {"device_id": DEVICE_ID, "on": True}),
        ("set_volume", {"device_id": DEVICE_ID, "action": "up"}),
        ("list_keys", {}),
        ("list_apps", {}),
    ],
)
async def test_no_tool_ever_raises(
    server: Any, manager: StubDeviceManager, tool: str, kwargs: dict[str, Any]
) -> None:
    """Every tool swallows a facade explosion and returns an error envelope."""
    manager.fail_with = RuntimeError("the TV fell over")
    payload = await call(server, tool, kwargs)
    assert "error" in payload, f"{tool} did not report the failure as an envelope"


# -- pairing is human-in-the-loop -----------------------------------------------


async def test_pair_device_tells_the_agent_to_ask_a_human(server: Any) -> None:
    """The response body instructs the agent to have a person read the TV screen."""
    payload = await call(server, "pair_device", {"device_id": DEVICE_ID})
    assert payload["status"] == "code_required"
    instructions = payload["instructions"].lower()
    assert "ask" in instructions
    assert "code" in instructions
    assert "complete_pairing" in payload["instructions"]


async def test_pair_device_description_tells_the_agent_to_ask_a_human(server: Any) -> None:
    """The tool description, which is all an agent sees up front, says the same thing."""
    tool = next(tool for tool in await server.list_tools() if tool.name == "pair_device")
    description = tool.description.lower()
    assert "ask" in description
    assert "screen" in description or "television" in description or "tv" in description
    assert "complete_pairing" in tool.description


# -- behaviour ------------------------------------------------------------------


async def test_list_devices_returns_serialised_devices(server: Any) -> None:
    """Devices come back as plain JSON objects matching the contract model."""
    payload = await call(server, "list_devices")
    assert payload["count"] == 1
    assert payload["devices"][0]["id"] == DEVICE_ID
    assert payload["devices"][0]["state"]["connection"] == "connected"


async def test_discover_devices_only_rescans_when_asked(
    server: Any, manager: StubDeviceManager
) -> None:
    """``rescan=False`` reads the cache; ``rescan=True`` kicks the browser first."""
    await call(server, "discover_devices")
    assert [name for name, _, _ in manager.calls] == ["list_discovered"]
    manager.calls.clear()
    await call(server, "discover_devices", {"rescan": True})
    assert [name for name, _, _ in manager.calls] == ["rescan", "list_discovered"]


async def test_send_keys_sends_the_whole_sequence_in_order(
    server: Any, manager: StubDeviceManager
) -> None:
    """A macro arrives at the facade as ordered individual key presses."""
    payload = await call(
        server, "send_keys", {"device_id": DEVICE_ID, "keys": ["HOME", "DPAD_DOWN", "DPAD_CENTER"]}
    )
    assert payload["sent"] == ["HOME", "DPAD_DOWN", "DPAD_CENTER"]
    assert [args[1] for name, args, _ in manager.calls if name == "send_key"] == [
        "HOME",
        "DPAD_DOWN",
        "DPAD_CENTER",
    ]


async def test_send_keys_reports_how_far_it_got_before_failing(
    server: Any, manager: StubDeviceManager
) -> None:
    """A mid-sequence failure still tells the agent which keys landed."""
    manager.fail_with = DeviceNotFound("gone")
    payload = await call(server, "send_keys", {"device_id": DEVICE_ID, "keys": ["HOME", "DPAD_DOWN"]})
    assert payload["error"]["code"] == "device_not_found"
    assert payload["error"]["details"]["sent"] == []
    assert payload["error"]["details"]["failed_at"] == "HOME"


async def test_send_keys_rejects_an_empty_sequence(server: Any) -> None:
    """An empty macro is a caller mistake, reported rather than silently succeeding."""
    payload = await call(server, "send_keys", {"device_id": DEVICE_ID, "keys": []})
    assert payload["error"]["code"] == "invalid_request"


async def test_set_volume_requires_exactly_one_of_action_or_level(server: Any) -> None:
    """Supplying neither or both is rejected with a recoverable envelope."""
    assert (await call(server, "set_volume", {"device_id": DEVICE_ID}))["error"]["code"] == "invalid_request"
    both = await call(server, "set_volume", {"device_id": DEVICE_ID, "action": "up", "level": 20})
    assert both["error"]["code"] == "invalid_request"


async def test_set_volume_passes_an_absolute_level_through(
    server: Any, manager: StubDeviceManager
) -> None:
    """An absolute level reaches the facade unchanged."""
    payload = await call(server, "set_volume", {"device_id": DEVICE_ID, "level": 20})
    assert payload["state"]["volume"]["level"] == 12
    assert manager.calls[-1] == ("set_volume", (DEVICE_ID,), {"action": None, "level": 20})


async def test_rename_device_updates_only_the_name(server: Any, manager: StubDeviceManager) -> None:
    """Renaming must not disturb ``host`` or ``enabled``."""
    await call(server, "rename_device", {"device_id": DEVICE_ID, "name": "Den TV"})
    assert manager.calls[-1] == (
        "update_device",
        (DEVICE_ID,),
        {"name": "Den TV", "host": None, "enabled": None},
    )


async def test_set_power_is_passed_through_as_an_explicit_boolean(
    server: Any, manager: StubDeviceManager
) -> None:
    """``set_power`` forwards the requested state so the facade can be idempotent."""
    await call(server, "set_power", {"device_id": DEVICE_ID, "on": False})
    assert manager.calls[-1] == ("set_power", (DEVICE_ID, False), {})


async def test_list_keys_filters_by_category(server: Any) -> None:
    """The catalog can be narrowed so an agent does not have to read all of it."""
    payload = await call(server, "list_keys", {"category": "volume"})
    assert [key["key"] for key in payload["keys"]] == ["VOLUME_UP"]


async def test_list_apps_returns_the_catalog(server: Any) -> None:
    """The app catalog is exposed with the launch token an agent needs."""
    payload = await call(server, "list_apps")
    assert payload["apps"][0]["launch"] == "com.netflix.ninja"


async def test_remove_device_reports_completion(server: Any) -> None:
    """A void facade call still returns something the agent can check."""
    payload = await call(server, "remove_device", {"device_id": DEVICE_ID})
    assert payload["removed"] is True


# -- resources ------------------------------------------------------------------


async def test_devices_resource_lists_devices(server: Any) -> None:
    """``androidtv://devices`` returns the ``Device[]`` the contract promises."""
    body = await read(server, "androidtv://devices")
    assert body[0]["id"] == DEVICE_ID


async def test_device_resource_returns_one_device(server: Any) -> None:
    """The templated resource resolves a single device by id."""
    body = await read(server, f"androidtv://devices/{DEVICE_ID}")
    assert body["name"] == "Living Room TV"


async def test_device_resource_reports_a_missing_device_as_an_envelope(server: Any) -> None:
    """An unknown id in a resource URI does not blow up the read."""
    body = await read(server, "androidtv://devices/000000000000")
    assert body["error"]["code"] == "device_not_found"


async def test_keys_and_apps_resources_expose_the_catalogs(server: Any) -> None:
    """Both catalog resources return their contract models."""
    assert (await read(server, "androidtv://keys"))[0]["keycode"] == "KEYCODE_DPAD_UP"
    assert (await read(server, "androidtv://apps"))[0]["id"] == "netflix"


# -- transport and auth ---------------------------------------------------------


def _initialize_body() -> dict[str, Any]:
    """Build a minimal MCP ``initialize`` JSON-RPC request body."""
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "1"},
        },
    }


_MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


def _client(manager: StubDeviceManager, token: str | None = None):
    """Build a ``TestClient`` over a FastAPI app with the MCP server mounted."""
    from fastapi import FastAPI
    from starlette.testclient import TestClient

    app = FastAPI()
    mount_mcp(app, manager, token=token)
    return TestClient(app)


def test_mcp_answers_with_and_without_a_trailing_slash(manager: StubDeviceManager) -> None:
    """Both ``/mcp`` and ``/mcp/`` work, because clients do not follow redirects."""
    with _client(manager) as client:
        for path in ("/mcp", "/mcp/"):
            response = client.post(path, json=_initialize_body(), headers=_MCP_HEADERS,
                                   follow_redirects=False)
            assert response.status_code == 200, f"{path} returned {response.status_code}"


def test_requests_without_the_token_are_rejected(manager: StubDeviceManager) -> None:
    """With a token configured, an unauthenticated call gets the contract's 401 envelope."""
    with _client(manager, token="s3cret") as client:
        response = client.post("/mcp", json=_initialize_body(), headers=_MCP_HEADERS)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_the_bearer_header_is_accepted(manager: StubDeviceManager) -> None:
    """The REST API's ``Authorization: Bearer`` form works against ``/mcp`` too."""
    with _client(manager, token="s3cret") as client:
        response = client.post(
            "/mcp",
            json=_initialize_body(),
            headers={**_MCP_HEADERS, "Authorization": "Bearer s3cret"},
        )
    assert response.status_code == 200


def test_the_query_parameter_token_is_accepted(manager: StubDeviceManager) -> None:
    """``?token=`` works for clients that cannot set headers."""
    with _client(manager, token="s3cret") as client:
        response = client.post("/mcp?token=s3cret", json=_initialize_body(), headers=_MCP_HEADERS)
    assert response.status_code == 200


def test_a_wrong_token_is_rejected(manager: StubDeviceManager) -> None:
    """A token mismatch is refused rather than ignored."""
    with _client(manager, token="s3cret") as client:
        response = client.post(
            "/mcp", json=_initialize_body(), headers={**_MCP_HEADERS, "Authorization": "Bearer nope"}
        )
    assert response.status_code == 401


def test_build_mcp_app_returns_a_mountable_asgi_app(manager: StubDeviceManager) -> None:
    """The raw factory hands back an app whose lifespan the backend can chain."""
    app = build_mcp_app(manager)
    assert callable(app)
    assert hasattr(app.router, "lifespan_context")


def test_the_module_imports_without_a_backend() -> None:
    """``app.mcp_server`` must not import ``app.devices``, which lands on another branch."""
    assert "app.devices" not in sys.modules
    assert isinstance(CONTRACT_TOOLS, tuple)
    assert issubclass(RemoteError, Exception)
