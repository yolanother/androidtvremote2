# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Behavioral integration tests for optional Android TV Remote launcher providers.
# Exercises the appliance's HTTP and event surfaces against a fake external provider,
# proving paired-TV identity, independent device data, bounded provider failures,
# command authorization and generic-control fallback without any TV or LAN traffic.
"""Behavioral integration tests for optional launcher provider APIs."""

from __future__ import annotations

from typing import Any


def test_no_provider_reports_unavailable_without_losing_core_control(paired_client: Any) -> None:
    """A paired TV remains controllable when no optional provider is present."""
    client, device_id = paired_client
    response = client.get(f"/api/devices/{device_id}/integrations")
    assert response.status_code == 200
    body = response.json()
    assert body["device_id"] == device_id
    assert body["available"] is False
    assert body["capabilities"] == []
    assert client.get("/api/providers").json() == []
    assert client.post(f"/api/devices/{device_id}/keys", json={"key": "DPAD_UP"}).status_code == 202
    assert client.post(f"/api/devices/{device_id}/media", json={"action": "play"}).json()["error"]["code"] == "no_media_session"
