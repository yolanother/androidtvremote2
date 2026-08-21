# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Tests for the REST surface. Asserts that every endpoint in the frozen API contract exists
# at the documented path, accepts the documented body, and answers with the documented
# status code and model, and that every failure comes back in the contract's error
# envelope with the right machine-readable code — the mapping Home Assistant and the MCP
# tools both depend on.
"""Tests for the REST surface."""

from __future__ import annotations

from typing import Any

from app.vendored import CannotConnect, InvalidAuth

HOST = "192.168.1.23"


def _register(client: Any, host: str = HOST) -> str:
    """Register a device and return its id.

    :param client: The app test client.
    :param host: Address to register.
    :returns: The new device id.
    """
    return client.post("/api/devices", json={"host": host}).json()["id"]


# -- health ------------------------------------------------------------------------------


def test_healthz_is_ok_and_counts_devices(app_client: Any) -> None:
    """``/healthz`` reports device counts and the app version."""
    body = app_client.get("/healthz").json()
    assert body["status"] == "ok"
    assert body["devices"] == 0
    assert body["connected"] == 0
    assert body["version"]

    _register(app_client)
    assert app_client.get("/healthz").json()["devices"] == 1


def test_openapi_is_served_under_api_docs(app_client: Any) -> None:
    """Home automation users read the generated docs, so they must actually be served."""
    assert app_client.get("/api/docs").status_code == 200
    schema = app_client.get("/api/openapi.json").json()
    assert "/api/devices" in schema["paths"]
    assert "/api/devices/{device_id}/keys" in schema["paths"]


# -- devices -----------------------------------------------------------------------------


def test_register_returns_201_with_the_mac_derived_device(app_client: Any) -> None:
    """``POST /api/devices`` derives the identity from the TV and answers 201."""
    response = app_client.post("/api/devices", json={"host": HOST, "name": "Lounge"})
    assert response.status_code == 201
    body = response.json()
    assert body["id"] == "aabbccddeeff"
    assert body["mac"] == "aa:bb:cc:dd:ee:ff"
    assert body["name"] == "Lounge"
    assert body["host"] == HOST
    assert body["paired"] is False
    assert body["state"]["connection"] == "unpaired"


def test_register_defaults_the_name_to_the_one_the_tv_reports(app_client: Any) -> None:
    """Omitting ``name`` uses the name read off the TV's certificate."""
    assert app_client.post("/api/devices", json={"host": HOST}).json()["name"] == "Living Room TV"


def test_list_and_get_devices(app_client: Any) -> None:
    """``GET /api/devices`` lists devices and ``GET /api/devices/{id}`` fetches one."""
    device_id = _register(app_client)
    assert [d["id"] for d in app_client.get("/api/devices").json()] == [device_id]
    assert app_client.get(f"/api/devices/{device_id}").json()["id"] == device_id


def test_patch_updates_name_and_host(app_client: Any) -> None:
    """``PATCH`` changes the mutable fields and leaves the identity alone."""
    device_id = _register(app_client)
    body = app_client.patch(
        f"/api/devices/{device_id}", json={"name": "Den", "host": "192.168.1.99"}
    ).json()
    assert body["name"] == "Den"
    assert body["host"] == "192.168.1.99"
    assert body["id"] == device_id


def test_delete_returns_204(app_client: Any) -> None:
    """``DELETE`` removes the device and answers 204 with no body."""
    device_id = _register(app_client)
    response = app_client.delete(f"/api/devices/{device_id}")
    assert response.status_code == 204
    assert app_client.get("/api/devices").json() == []


def test_registering_a_known_mac_is_409_with_the_existing_device(app_client: Any) -> None:
    """A duplicate registration is ``device_exists`` and carries the existing device."""
    _register(app_client)
    response = app_client.post("/api/devices", json={"host": HOST})
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "device_exists"
    assert error["details"]["device"]["id"] == "aabbccddeeff"


def test_unknown_device_is_404_in_the_error_envelope(app_client: Any) -> None:
    """Every failure uses ``{"error": {"code", "message"}}``."""
    response = app_client.get("/api/devices/ffffffffffff")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "device_not_found"
    assert response.json()["error"]["message"]


def test_registering_an_unreachable_tv_is_503(app_client: Any, fake_remote: Any) -> None:
    """A TV that does not answer registration is ``unreachable``."""
    fake_remote.connect_error = CannotConnect
    response = app_client.post("/api/devices", json={"host": "192.168.1.250"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "unreachable"


def test_a_malformed_body_is_a_400_in_the_envelope(app_client: Any) -> None:
    """Validation failures use the envelope too, not FastAPI's default 422 shape."""
    response = app_client.post("/api/devices", json={})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


# -- pairing -----------------------------------------------------------------------------


def test_pairing_flow(app_client: Any) -> None:
    """``pair`` asks for a code and ``pair/complete`` finishes the handshake."""
    device_id = _register(app_client)

    started = app_client.post(f"/api/devices/{device_id}/pair")
    assert started.status_code == 200
    assert started.json() == {"status": "code_required"}

    completed = app_client.post(
        f"/api/devices/{device_id}/pair/complete", json={"code": "123456"}
    )
    assert completed.status_code == 200
    assert completed.json()["paired"] is True
    assert completed.json()["state"]["connection"] == "connected"


def test_completing_before_starting_is_409(app_client: Any) -> None:
    """``pair/complete`` without ``pair`` is ``pairing_not_started``."""
    device_id = _register(app_client)
    response = app_client.post(f"/api/devices/{device_id}/pair/complete", json={"code": "123456"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "pairing_not_started"


def test_a_rejected_code_is_400(app_client: Any, fake_remote: Any) -> None:
    """A code the TV rejects is ``invalid_pairing_code``."""
    device_id = _register(app_client)
    app_client.post(f"/api/devices/{device_id}/pair")
    fake_remote.finish_pairing_error = InvalidAuth
    response = app_client.post(f"/api/devices/{device_id}/pair/complete", json={"code": "000000"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_pairing_code"


def test_unpair_clears_the_pairing(paired_client: Any) -> None:
    """``DELETE .../pair`` returns the device with ``paired: false``."""
    client, device_id = paired_client
    body = client.delete(f"/api/devices/{device_id}/pair").json()
    assert body["paired"] is False
    assert body["state"]["connection"] == "unpaired"


# -- control -----------------------------------------------------------------------------


def test_send_key_is_202(paired_client: Any) -> None:
    """Key presses are accepted asynchronously."""
    client, device_id = paired_client
    response = client.post(f"/api/devices/{device_id}/keys", json={"key": "DPAD_UP"})
    assert response.status_code == 202


def test_send_key_accepts_the_full_keycode(paired_client: Any) -> None:
    """Both ``DPAD_UP`` and ``KEYCODE_DPAD_UP`` are accepted."""
    client, device_id = paired_client
    assert (
        client.post(
            f"/api/devices/{device_id}/keys", json={"key": "KEYCODE_DPAD_UP"}
        ).status_code
        == 202
    )


def test_an_unknown_key_is_400(paired_client: Any) -> None:
    """A key outside the catalog is ``invalid_key``."""
    client, device_id = paired_client
    response = client.post(f"/api/devices/{device_id}/keys", json={"key": "SELF_DESTRUCT"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_key"


def test_repeat_outside_the_allowed_range_is_rejected(paired_client: Any) -> None:
    """``repeat`` is bounded at 1..10 by the contract."""
    client, device_id = paired_client
    response = client.post(
        f"/api/devices/{device_id}/keys", json={"key": "DPAD_UP", "repeat": 99}
    )
    assert response.status_code == 400


def test_commanding_an_unpaired_device_is_409(app_client: Any) -> None:
    """Control on a device with no certificate is ``not_paired``."""
    device_id = _register(app_client)
    response = app_client.post(f"/api/devices/{device_id}/keys", json={"key": "DPAD_UP"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "not_paired"


def test_text_and_launch_are_202(paired_client: Any) -> None:
    """Text entry and app launches are accepted asynchronously."""
    client, device_id = paired_client
    assert client.post(f"/api/devices/{device_id}/text", json={"text": "hi"}).status_code == 202
    assert (
        client.post(f"/api/devices/{device_id}/launch", json={"app": "netflix"}).status_code == 202
    )


def test_power_returns_the_device_state(paired_client: Any) -> None:
    """``power`` answers with the DeviceState, not 202."""
    client, device_id = paired_client
    response = client.post(f"/api/devices/{device_id}/power", json={"on": True})
    assert response.status_code == 200
    assert "connection" in response.json()


def test_volume_requires_exactly_one_of_action_or_level(paired_client: Any) -> None:
    """Supplying neither or both is a validation failure in the envelope."""
    client, device_id = paired_client
    assert client.post(f"/api/devices/{device_id}/volume", json={}).status_code == 400
    assert (
        client.post(
            f"/api/devices/{device_id}/volume", json={"action": "up", "level": 5}
        ).status_code
        == 400
    )
    assert client.post(f"/api/devices/{device_id}/volume", json={"action": "up"}).status_code == 200


def test_connect_disconnect_and_state(paired_client: Any) -> None:
    """The connection endpoints answer with the resulting DeviceState."""
    client, device_id = paired_client
    assert client.post(f"/api/devices/{device_id}/disconnect").json()["connection"] == "disconnected"
    assert client.post(f"/api/devices/{device_id}/connect").json()["connection"] == "connected"
    assert client.get(f"/api/devices/{device_id}/state").json()["connection"] == "connected"


# -- discovery and catalog ----------------------------------------------------------------


def test_discovery_returns_immediately(app_client: Any) -> None:
    """``GET /api/discovery`` reads the cache; it never waits on the network."""
    response = app_client.get("/api/discovery")
    assert response.status_code == 200
    assert response.json() == []


def test_scan_is_202(app_client: Any) -> None:
    """``POST /api/discovery/scan`` kicks a rescan and returns immediately."""
    assert app_client.post("/api/discovery/scan").status_code == 202


def test_key_catalog(app_client: Any) -> None:
    """``GET /api/keys`` returns descriptors with both key forms and a category."""
    keys = app_client.get("/api/keys").json()
    entry = next(k for k in keys if k["key"] == "DPAD_UP")
    assert entry["keycode"] == "KEYCODE_DPAD_UP"
    assert entry["category"] == "navigation"
    assert entry["label"]


def test_app_catalog(app_client: Any) -> None:
    """``GET /api/apps`` returns launchable apps with a launch target."""
    apps = app_client.get("/api/apps").json()
    netflix = next(a for a in apps if a["id"] == "netflix")
    assert netflix["launch"] == "com.netflix.ninja"
    assert netflix["package"] == "com.netflix.ninja"


def test_embed_responses_carry_the_frame_ancestors_policy(app_client: Any) -> None:
    """The embed view has to be framable by a home panel, so CSP is set explicitly."""
    response = app_client.get("/healthz")
    assert "frame-ancestors" in response.headers.get("content-security-policy", "")
