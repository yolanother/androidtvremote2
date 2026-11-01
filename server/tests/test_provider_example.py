# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Public HTTP acceptance tests for the portable simulated launcher-provider example.
# Imports the standalone example without starting a server and checks its versioned
# manifest, canonical TV registration, guide bounds, command idempotency and isolated
# simulated playback controls, without physical televisions or private services.
"""Acceptance tests for the portable simulated launcher provider."""

from __future__ import annotations

import importlib.util
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[2]
DEVICE_ID = "112233445566"
BASE = f"/atvr/v1/devices/{DEVICE_ID}"


def _client() -> TestClient:
    """Import the portable public example and construct an in-process HTTP client."""
    spec = importlib.util.spec_from_file_location("atvr_provider_example", ROOT / "examples/provider_fixture.py")
    assert spec is not None and spec.loader is not None
    example = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = example
    spec.loader.exec_module(example)
    return TestClient(example.create_fixture_app(device_id=DEVICE_ID))


def test_example_is_clearly_simulated_and_uses_the_supplied_tv_identity() -> None:
    """The example is usable by public clients without household-specific configuration."""
    with _client() as client:
        manifest = client.get("/atvr/v1/manifest")
        assert manifest.status_code == 200
        assert manifest.json()["id"] == "example"
        assert manifest.json()["version"] == 1
        assert "simulat" in manifest.json()["name"].lower()
        devices = client.get("/atvr/v1/devices")
        assert devices.status_code == 200
        assert [device["id"] for device in devices.json()] == [DEVICE_ID]
        assert {"catalog", "guide", "playback"}.issubset(devices.json()[0]["capabilities"])


def _guide(client: TestClient) -> dict[str, Any]:
    """Request one small valid guide window through the public provider route."""
    start = datetime.now(UTC)
    response = client.get(f"{BASE}/guide", params={"from": start.isoformat(), "to": (start + timedelta(hours=2)).isoformat()})
    assert response.status_code == 200
    return response.json()


def test_example_resources_follow_wire_shapes_and_bound_guide_requests() -> None:
    """Generic fake data is complete enough to exercise the public UI without services."""
    with _client() as client:
        catalog = client.get(f"{BASE}/catalog")
        assert catalog.status_code == 200
        assert catalog.json()["revision"]
        assert catalog.json()["profile_revision"]
        assert any(item["available"] and item["action"]["type"] == "launch" for item in catalog.json()["items"])
        guide = _guide(client)
        assert guide["revision"] and guide["profile_revision"] and guide["timezone"]
        assert guide["channels"]
        programme = guide["channels"][0]["programmes"][0]
        assert programme["id"] and programme["title_id"] and programme["title"]
        assert datetime.fromisoformat(programme["start"].replace("Z", "+00:00")) < datetime.fromisoformat(programme["end"].replace("Z", "+00:00"))
        observed = client.get(f"{BASE}/playback")
        assert observed.status_code == 200
        assert observed.json()["session_id"] and observed.json()["observed_at"]
        assert observed.json()["actions"]
        for resource in ["catalog", "playback"]:
            assert client.get(f"/atvr/v1/devices/223344556677/{resource}").status_code == 404
        start = datetime.now(UTC)
        assert client.get("/atvr/v1/devices/223344556677/guide", params={"from": start.isoformat(), "to": (start + timedelta(hours=1)).isoformat()}).status_code == 404
        for end in [start, start - timedelta(seconds=1), start + timedelta(hours=24, seconds=1)]:
            response = client.get(f"{BASE}/guide", params={"from": start.isoformat(), "to": end.isoformat()})
            assert response.status_code == 400


def test_example_launches_are_idempotent_acknowledgements_not_observed_playback() -> None:
    """Launch/tune/open/resume acknowledge once and do not fabricate a watched title."""
    with _client() as client:
        catalog = client.get(f"{BASE}/catalog").json()
        app = next(item for item in catalog["items"] if item["available"])
        guide = _guide(client)
        channel = guide["channels"][0]
        title_id = channel["programmes"][0]["title_id"]
        before = client.get(f"{BASE}/playback").json()
        original = None
        original_result = None
        for action in ["launch", "tune", "open", "resume"]:
            body = {"command_id": str(uuid4()), "action": action, "profile_revision": catalog["profile_revision"]}
            if action == "launch":
                body["item_id"] = app["id"]
            elif action == "tune":
                body["channel_id"] = channel["id"]
                body["schedule_revision"] = guide["revision"]
            else:
                body["item_id"] = title_id
            response = client.post(f"{BASE}/commands", json=body)
            assert response.status_code in (200, 202)
            assert response.json()["command_id"] == body["command_id"]
            assert response.json()["status"] == "accepted"
            if original is None:
                original, original_result = body, response.json()
            after = client.get(f"{BASE}/playback").json()
            assert (after["session_id"], after["title"], after.get("channel_id")) == (before["session_id"], before["title"], before.get("channel_id"))
        repeated = client.post(f"{BASE}/commands", json=original)
        assert repeated.json() == original_result
        conflicting = {**original, "action": "open", "item_id": title_id}
        assert client.post(f"{BASE}/commands", json=conflicting).status_code == 409
        for malformed in [{"command_id": "not-a-uuid", "action": "launch", "item_id": app["id"]}, {"command_id": str(uuid4()), "action": "shell"}]:
            assert client.post(f"{BASE}/commands", json=malformed).status_code in (400, 422)


def test_example_media_controls_affect_only_the_matching_simulated_session() -> None:
    """The example demonstrates usable pause/play/seek while rejecting stale sessions."""
    with _client() as client:
        observed = client.get(f"{BASE}/playback").json()
        session = observed["session_id"]
        assert {"pause", "play", "seek"}.issubset(observed["actions"])
        stale = client.post(f"{BASE}/commands", json={"command_id": str(uuid4()), "action": "pause", "session_id": "retired-session"})
        assert stale.status_code in (400, 409)
        response = client.post(f"{BASE}/commands", json={"command_id": str(uuid4()), "action": "pause", "session_id": session})
        assert response.status_code in (200, 202)
        assert client.get(f"{BASE}/playback").json()["player_state"] == "PAUSED"
        response = client.post(f"{BASE}/commands", json={"command_id": str(uuid4()), "action": "seek", "session_id": session, "position": 12.5})
        assert response.status_code in (200, 202)
        assert client.get(f"{BASE}/playback").json()["position"] == pytest.approx(12.5)
        response = client.post(f"{BASE}/commands", json={"command_id": str(uuid4()), "action": "play", "session_id": session})
        assert response.status_code in (200, 202)
        assert client.get(f"{BASE}/playback").json()["player_state"] == "PLAYING"
