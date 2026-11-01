# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Behavioral integration tests for optional Android TV Remote launcher providers.
# Exercises the appliance's HTTP and event surfaces against a fake external provider,
# proving paired-TV identity, independent device data, bounded provider failures,
# command authorization and generic-control fallback without any TV or LAN traffic.
"""Behavioral integration tests for optional launcher provider APIs."""

from __future__ import annotations

import asyncio
import json
import time
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


TV_A = "aabbccddeeff"
TV_B = "112233445566"
HOST_A = "192.168.1.23"
HOST_B = "192.168.1.24"
BASE = "/atvr/v1"
CAPABILITIES = ["catalog", "browse", "guide", "tune", "channel_step", "playback", "profiles"]
GUIDE_FROM = "2026-11-01T12:00:00Z"
GUIDE_TO = "2026-11-01T14:00:00Z"


class ProviderStub:
    """External protocol peer with mutable per-TV data and recorded HTTP requests.

    The stub is a boundary double, not a replacement for registry behavior. Tests
    observe public appliance HTTP/events while this peer supplies the locked v1 wire
    contract and deliberate network/protocol failures.
    """

    def __init__(self, provider_id: str = "fixture") -> None:
        """Create a valid provider serving two distinct TVs and profiles."""
        self.provider_id = provider_id
        self.version = 1
        self.failure: str | None = None
        self.requests: list[httpx.Request] = []
        self.commands: list[tuple[str, dict[str, Any]]] = []
        self.command_results: dict[str, dict[str, Any]] = {}
        self.devices = [self._device(TV_A, "Family", "family"), self._device(TV_B, "Bedroom", "adult")]
        self.catalogs = {TV_A: self._catalog("family"), TV_B: self._catalog("adult")}
        self.playbacks: dict[str, dict[str, Any] | None] = {
            TV_A: self._playback("A programme", "session-a"),
            TV_B: self._playback("B programme", "session-b"),
        }

    @staticmethod
    def _device(device_id: str, name: str, profile: str) -> dict[str, Any]:
        """Return one normalized, online launcher registration."""
        return {
            "id": device_id,
            "name": name,
            "online": True,
            "capabilities": list(CAPABILITIES),
            "profile_id": profile,
            "profile_revision": f"{profile}-1",
        }

    @staticmethod
    def _catalog(profile: str) -> dict[str, Any]:
        """Return an installed app whose label distinguishes each TV's catalog."""
        return {
            "revision": "catalog-1",
            "profile_revision": f"{profile}-1",
            "items": [{
                "id": f"app-{profile}",
                "name": f"{profile} player",
                "kind": "app",
                "package": "org.example.player",
                "icon_url": None,
                "available": True,
                "action": {"type": "launch", "item_id": f"app-{profile}"},
            }],
        }

    @staticmethod
    def _playback(title: str, session: str) -> dict[str, Any]:
        """Return fresh observed media, never a launch or Watch Next assertion."""
        now = datetime.now(UTC).isoformat()
        return {
            "session_id": session,
            "package": "org.example.player",
            "title": title,
            "subtitle": None,
            "images": [],
            "player_state": "PLAYING",
            "position": 12.0,
            "duration": 600.0,
            "position_at": now,
            "observed_at": now,
            "channel_id": None,
            "actions": ["play", "pause", "seek"],
        }

    def respond(self, request: httpx.Request) -> httpx.Response:
        """Answer the external HTTP protocol, recording all observable requests.

        :param request: HTTP request produced by the appliance provider client.
        :returns: A wire response or a simulated transport exception.
        """
        self.requests.append(request)
        if self.failure == "timeout":
            raise httpx.ConnectTimeout("fixture timeout", request=request)
        if self.failure == "unavailable":
            return httpx.Response(503, json={"error": "temporarily offline"})
        if self.failure == "redirect":
            return httpx.Response(302, headers={"Location": "http://different-origin.test/private"})
        if self.failure == "invalid_json":
            return httpx.Response(200, text="<!doctype html><title>not a provider</title>")
        if self.failure == "oversized":
            return httpx.Response(200, content=b" " * (2 * 1024 * 1024 + 1))
        path = request.url.path
        if path == f"{BASE}/manifest":
            return httpx.Response(200, json={"id": self.provider_id, "name": "Fixture provider", "version": self.version})
        if path == f"{BASE}/devices":
            return httpx.Response(200, json=self.devices)
        prefix = f"{BASE}/devices/"
        if not path.startswith(prefix):
            return httpx.Response(404)
        device_id, _, resource = path[len(prefix):].partition("/")
        device = next((d for d in self.devices if d["id"] == device_id), None)
        if device is None:
            return httpx.Response(404)
        profile_revision = device["profile_revision"]
        if resource == "catalog":
            return httpx.Response(200, json=self.catalogs[device_id])
        if resource == "playback":
            if self.playbacks[device_id] is None:
                return httpx.Response(200, content="null", headers={"Content-Type": "application/json"})
            return httpx.Response(200, json=self.playbacks[device_id])
        if resource == "guide":
            return httpx.Response(200, json={
                "revision": "guide-1",
                "profile_revision": profile_revision,
                "timezone": "America/Los_Angeles",
                "server_time": GUIDE_FROM,
                "channels": [{
                    "id": "channel-a",
                    "name": "Recommendations",
                    "number": 1,
                    "kind": "recommendation",
                    "programmes": [{
                        "id": "programme-a",
                        "title_id": "title-a",
                        "title": f"A title for {device_id}",
                        "subtitle": None,
                        "image_url": None,
                        "start": GUIDE_FROM,
                        "end": GUIDE_TO,
                        "available": True,
                    }],
                }],
            })
        if resource == "browse":
            return httpx.Response(200, json={
                "revision": "browse-1",
                "profile_revision": profile_revision,
                "items": [{"id": "title-a", "title": f"Title for {device_id}", "subtitle": None, "image_url": None, "available": True}],
                "next_cursor": "page-two",
            })
        if resource.startswith("titles/"):
            return httpx.Response(200, json={
                "id": resource.removeprefix("titles/"),
                "title": f"Title for {device_id}",
                "subtitle": None,
                "image_url": None,
                "available": True,
                "actions": ["open", "resume"],
            })
        if resource == "profiles":
            return httpx.Response(200, json={
                "items": [{"id": device["profile_id"], "name": device["profile_id"], "image_url": None}],
                "active_id": device["profile_id"],
                "revision": profile_revision,
            })
        if resource == "commands" and request.method == "POST":
            body = json.loads(request.content)
            self.commands.append((device_id, body))
            result = self.command_results.setdefault(body["command_id"], {"command_id": body["command_id"], "status": "accepted"})
            return httpx.Response(200, json=result)
        return httpx.Response(404)


@contextmanager
def _provider_client(
    tmp_path: Path,
    fake_remote: Any,
    peers: list[ProviderStub] | None = None,
    token: str | None = None,
    timeout: float = 5,
) -> Iterator[TestClient]:
    """Run the real appliance lifespan against only in-memory external peers.

    :param tmp_path: Isolated test storage root.
    :param fake_remote: Existing TV protocol boundary double.
    :param peers: Provider peers, each given a distinct origin; defaults to one.
    :param token: Optional appliance token, which must never reach a peer.
    :param timeout: Total upstream request budget in seconds.
    :returns: The running API client; all resources close when the context exits.
    """
    providers = peers if peers is not None else [ProviderStub()]
    origins = {f"provider-{i}.test": peer for i, peer in enumerate(providers)}

    def handle(request: httpx.Request) -> httpx.Response:
        """Route only configured fake origins; unexpected destinations are a failure."""
        assert request.url.host in origins, f"Provider escaped configured origins: {request.url}"
        return origins[request.url.host].respond(request)

    config = Settings(
        data_dir=tmp_path / "data",
        discovery_enabled=False,
        provider_urls=",".join(f"http://{host}{BASE}" for host in origins),
        provider_timeout=timeout,
        provider_poll_interval=15,
        remote_api_token=token,
        _env_file=None,
    )
    application = create_app(
        settings=config,
        remote_factory=fake_remote,
        legacy_seed_path=tmp_path / "no-legacy-seed",
        provider_transport=httpx.MockTransport(handle),
    )
    with TestClient(application) as client:
        if token:
            client.headers["Authorization"] = f"Bearer {token}"
        yield client


def _register(client: TestClient, host: str = HOST_A, *, paired: bool = True) -> str:
    """Register and optionally pair a fake TV through public API endpoints."""
    response = client.post("/api/devices", json={"host": host})
    assert response.status_code == 201, response.text
    device_id = response.json()["id"]
    if paired:
        assert client.post(f"/api/devices/{device_id}/pair").status_code == 200
        response = client.post(f"/api/devices/{device_id}/pair/complete", json={"code": "123456"})
        assert response.status_code == 200, response.text
    return device_id


def _refresh(client: TestClient) -> None:
    """Synchronize the external boundary through the registry's public refresh seam."""
    assert client.portal is not None
    client.portal.call(client.app.state.providers.refresh)


def _command(client: TestClient, device_id: str, action: str, **fields: Any) -> httpx.Response:
    """Send a fresh client command UUID unless the test intentionally reuses one."""
    return client.post(f"/api/devices/{device_id}/provider/commands", json={"command_id": str(uuid4()), "action": action, **fields})


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


def test_matching_provider_binds_only_after_pairing(tmp_path: Path, fake_remote: Any) -> None:
    """A canonical ID match cannot authorize commands to an unpaired television."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client, paired=False)
        _refresh(client)
        before = client.get(f"/api/devices/{device_id}/integrations").json()
        assert before["available"] is False
        response = _command(client, device_id, "launch", item_id="app-family")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "not_paired"
        assert peer.commands == []
        client.post(f"/api/devices/{device_id}/pair")
        client.post(f"/api/devices/{device_id}/pair/complete", json={"code": "123456"})
        _refresh(client)
        after = client.get(f"/api/devices/{device_id}/integrations").json()
        assert after["available"] is True
        assert after["provider_id"] == peer.provider_id
        assert after["profile_id"] == "family"
        assert "guide" in after["capabilities"]


def test_two_tv_catalogs_profiles_and_playback_are_separate(tmp_path: Path, fake_remote: Any) -> None:
    """Same-provider TVs keep distinct installed apps, profiles and observed sessions."""
    fake_remote.identities[HOST_B] = ("Bedroom", "11:22:33:44:55:66")
    with _provider_client(tmp_path, fake_remote) as client:
        first, second = _register(client), _register(client, HOST_B)
        _refresh(client)
        for device_id, profile, session, title in [
            (first, "family", "session-a", "A programme"),
            (second, "adult", "session-b", "B programme"),
        ]:
            catalog = client.get(f"/api/devices/{device_id}/catalog")
            assert catalog.status_code == 200
            assert catalog.json()["items"][0]["name"] == f"{profile} player"
            profiles = client.get(f"/api/devices/{device_id}/profiles").json()
            assert profiles["active_id"] == profile
            playback = client.get(f"/api/devices/{device_id}/playback").json()
            assert playback["session_id"] == session
            assert playback["title"] == title


def test_unknown_registered_tv_does_not_inherit_another_tv_provider(tmp_path: Path, fake_remote: Any) -> None:
    """A shared household provider is not automatically attached to unrelated IDs."""
    fake_remote.identities[HOST_B] = ("Other room", "99:88:77:66:55:44")
    with _provider_client(tmp_path, fake_remote) as client:
        _register(client)
        other = _register(client, HOST_B)
        _refresh(client)
        assert client.get(f"/api/devices/{other}/integrations").json()["available"] is False
        response = client.get(f"/api/devices/{other}/catalog")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "provider_unavailable"


def test_disabled_and_unpaired_tvs_lose_provider_control(tmp_path: Path, fake_remote: Any) -> None:
    """Registry state is rechecked when commanding, rather than remembered at discovery."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        client.patch(f"/api/devices/{device_id}", json={"enabled": False})
        response = _command(client, device_id, "launch", item_id="app-family")
        assert response.status_code in (400, 409, 503)
        assert peer.commands == []
        client.patch(f"/api/devices/{device_id}", json={"enabled": True})
        client.delete(f"/api/devices/{device_id}/pair")
        response = _command(client, device_id, "launch", item_id="app-family")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "not_paired"
        assert peer.commands == []


def test_duplicate_provider_claims_do_not_pick_an_arbitrary_owner(tmp_path: Path, fake_remote: Any) -> None:
    """Two independent providers claiming the same TV leave the integration unresolved."""
    first, second = ProviderStub("one"), ProviderStub("two")
    with _provider_client(tmp_path, fake_remote, [first, second]) as client:
        device_id = _register(client)
        _refresh(client)
        integration = client.get(f"/api/devices/{device_id}/integrations").json()
        assert integration["available"] is False
        assert integration["error"]
        assert _command(client, device_id, "launch", item_id="app-family").status_code == 503
        assert first.commands == second.commands == []


@pytest.mark.parametrize("invalid_id", ["", "AA:BB:CC:DD:EE:FF", "not-a-tv", "000000000000", "020000000000"])
def test_invalid_or_placeholder_provider_identity_never_binds(
    tmp_path: Path, fake_remote: Any, invalid_id: str
) -> None:
    """A provider must send the shared canonical ID, never a name or placeholder MAC."""
    peer = ProviderStub()
    peer.devices = [{**peer.devices[0], "id": invalid_id}]
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        assert client.get(f"/api/devices/{device_id}/integrations").json()["available"] is False
        assert peer.commands == []


def test_guide_preserves_programme_intervals_and_tv_identity(tmp_path: Path, fake_remote: Any) -> None:
    """The remote renders the authoritative guide, without inventing a local schedule."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        response = client.get(f"/api/devices/{device_id}/guide", params={"from": GUIDE_FROM, "to": GUIDE_TO})
        assert response.status_code == 200
        body = response.json()
        assert body["revision"] == "guide-1"
        assert body["timezone"] == "America/Los_Angeles"
        programme = body["channels"][0]["programmes"][0]
        assert programme["title"] == f"A title for {device_id}"
        assert datetime.fromisoformat(programme["start"].replace("Z", "+00:00")) == datetime.fromisoformat(GUIDE_FROM.replace("Z", "+00:00"))
        assert datetime.fromisoformat(programme["end"].replace("Z", "+00:00")) == datetime.fromisoformat(GUIDE_TO.replace("Z", "+00:00"))
        upstream = next(r for r in reversed(peer.requests) if r.url.path.endswith("/guide"))
        assert datetime.fromisoformat(upstream.url.params["from"].replace("Z", "+00:00")) == datetime.fromisoformat(GUIDE_FROM.replace("Z", "+00:00"))


@pytest.mark.parametrize("start,end", [
    (GUIDE_TO, GUIDE_FROM),
    (GUIDE_FROM, GUIDE_FROM),
    (GUIDE_FROM, "2026-11-02T12:00:01Z"),
    ("not-a-time", GUIDE_TO),
])
def test_invalid_guide_window_is_rejected_before_upstream_fetch(
    tmp_path: Path, fake_remote: Any, start: str, end: str
) -> None:
    """Guide queries cannot request inverted, unbounded or malformed time ranges."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        before = len([r for r in peer.requests if r.url.path.endswith("/guide")])
        response = client.get(f"/api/devices/{device_id}/guide", params={"from": start, "to": end})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_request"
        assert len([r for r in peer.requests if r.url.path.endswith("/guide")]) == before


def test_browse_query_and_title_details_stay_on_the_selected_tv(tmp_path: Path, fake_remote: Any) -> None:
    """Search text/cursors are encoded as data and preserve the selected TV context."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        response = client.get(f"/api/devices/{device_id}/browse", params={"query": "cats & dogs?", "mode": "continue", "cursor": "page + one"})
        assert response.status_code == 200
        assert response.json()["items"][0]["title"] == f"Title for {device_id}"
        assert response.json()["next_cursor"] == "page-two"
        upstream = next(r for r in reversed(peer.requests) if r.url.path.endswith("/browse"))
        assert upstream.url.params["query"] == "cats & dogs?"
        assert upstream.url.params["cursor"] == "page + one"
        detail = client.get(f"/api/devices/{device_id}/titles/title-a")
        assert detail.status_code == 200
        assert detail.json()["id"] == "title-a"
        assert "resume" in detail.json()["actions"]


def test_accepted_tune_does_not_replace_observed_playback(tmp_path: Path, fake_remote: Any) -> None:
    """Opening a recommendation never fabricates media metadata or a playing channel."""
    peer = ProviderStub()
    peer.playbacks[TV_A] = None
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        response = _command(client, device_id, "tune", channel_id="channel-a", profile_revision="family-1", schedule_revision="guide-1")
        assert response.status_code in (200, 202)
        assert response.json()["status"] == "accepted"
        assert peer.commands[-1][0] == device_id
        assert peer.commands[-1][1]["action"] == "tune"
        assert client.get(f"/api/devices/{device_id}/playback").json() is None
        assert client.get(f"/api/devices/{device_id}/state").json()["now_playing"] is None


def test_media_commands_require_a_current_supported_session(tmp_path: Path, fake_remote: Any) -> None:
    """A seek cannot target an old session or an unsupported transport action."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        stale = _command(client, device_id, "seek", session_id="previous-session", position=12)
        assert stale.status_code in (400, 409)
        unsupported = _command(client, device_id, "next", session_id="session-a")
        assert unsupported.status_code in (400, 409)
        assert peer.commands == []
        valid = _command(client, device_id, "pause", session_id="session-a")
        assert valid.status_code in (200, 202)
        assert peer.commands[-1][1]["session_id"] == "session-a"


def test_commands_cannot_use_capabilities_the_tv_did_not_advertise(tmp_path: Path, fake_remote: Any) -> None:
    """A provider-wide feature cannot grant an unsupported per-TV action."""
    peer = ProviderStub()
    peer.devices[0]["capabilities"] = ["catalog"]
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        response = _command(client, device_id, "tune", channel_id="channel-a")
        assert response.status_code in (400, 409)
        assert response.json()["error"]["code"] == "invalid_request"
        assert peer.commands == []


def test_profile_revision_change_rejects_a_pending_old_profile_action(tmp_path: Path, fake_remote: Any) -> None:
    """A request opened under one profile cannot launch after that TV switches profile."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        peer.devices[0]["profile_id"] = "kids"
        peer.devices[0]["profile_revision"] = "kids-2"
        peer.catalogs[device_id] = peer._catalog("kids")
        peer.catalogs[device_id]["profile_revision"] = "kids-2"
        _refresh(client)
        response = _command(client, device_id, "launch", item_id="app-family", profile_revision="family-1")
        assert response.status_code in (400, 409)
        assert peer.commands == []
        assert client.get(f"/api/devices/{device_id}/integrations").json()["profile_revision"] == "kids-2"


def test_command_uuid_is_preserved_and_retries_do_not_change_payload(tmp_path: Path, fake_remote: Any) -> None:
    """Repeating a command UUID does not create a fresh launch identity."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        body = {"command_id": str(uuid4()), "action": "launch", "item_id": "app-family", "profile_revision": "family-1"}
        first = client.post(f"/api/devices/{device_id}/provider/commands", json=body)
        second = client.post(f"/api/devices/{device_id}/provider/commands", json=body)
        assert first.status_code in (200, 202)
        assert second.status_code in (200, 202)
        assert first.json() == second.json()
        assert first.json()["command_id"] == body["command_id"]
        assert all(command["command_id"] == body["command_id"] for _, command in peer.commands)


def test_stale_observations_expire_and_cannot_authorize_seek(tmp_path: Path, fake_remote: Any) -> None:
    """Resume history or an old heartbeat cannot masquerade as a live media session."""
    peer = ProviderStub()
    assert peer.playbacks[TV_A] is not None
    peer.playbacks[TV_A]["observed_at"] = (datetime.now(UTC) - timedelta(seconds=31)).isoformat()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        assert client.get(f"/api/devices/{device_id}/playback").json() is None
        response = _command(client, device_id, "seek", session_id="session-a", position=10)
        assert response.status_code in (400, 409)
        assert peer.commands == []


@pytest.mark.parametrize("failure", ["timeout", "unavailable", "redirect", "invalid_json", "oversized"])
def test_provider_failure_does_not_break_paired_remote_controls(
    tmp_path: Path, fake_remote: Any, failure: str
) -> None:
    """Transport/protocol failures are bounded to optional integration behavior."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        peer.failure = failure
        _refresh(client)
        assert client.get(f"/api/devices/{device_id}/integrations").json()["available"] is False
        response = client.get(f"/api/devices/{device_id}/catalog")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "provider_unavailable"
        assert client.post(f"/api/devices/{device_id}/keys", json={"key": "DPAD_UP"}).status_code == 202
        assert client.get("/healthz").status_code == 200
        assert all(r.url.host == "provider-0.test" for r in peer.requests)


def test_unknown_protocol_major_does_not_bind(tmp_path: Path, fake_remote: Any) -> None:
    """An incompatible provider cannot be mistaken for the v1 data contract."""
    peer = ProviderStub()
    peer.version = 2
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        assert client.get(f"/api/devices/{device_id}/integrations").json()["available"] is False
        assert _command(client, device_id, "launch", item_id="app-family").status_code == 503
        assert peer.commands == []


def test_appliance_token_is_required_but_never_forwarded_to_provider(tmp_path: Path, fake_remote: Any) -> None:
    """Provider requests must not receive the appliance's bearer or query credential."""
    peer = ProviderStub()
    token = "test-only-appliance-token"
    with _provider_client(tmp_path, fake_remote, [peer], token=token) as client:
        device_id = _register(client)
        _refresh(client)
        assert client.get(f"/api/devices/{device_id}/catalog").status_code == 200
        client.headers.pop("Authorization")
        assert client.get("/api/providers").status_code == 401
        assert client.get(f"/api/devices/{device_id}/catalog").status_code == 401
        assert client.get(f"/api/devices/{device_id}/catalog", params={"token": token}).status_code == 200
        assert peer.requests
        for request in peer.requests:
            assert "authorization" not in request.headers
            assert token not in str(request.url)
            assert token.encode() not in request.content


def test_disabling_provider_persists_and_preserves_core_control(tmp_path: Path, fake_remote: Any) -> None:
    """Settings opt-out survives process restart without touching TV pairing."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        response = client.patch(f"/api/providers/{peer.provider_id}", json={"enabled": False})
        assert response.status_code == 200
        assert client.get(f"/api/devices/{device_id}/integrations").json()["available"] is False
        assert client.post(f"/api/devices/{device_id}/keys", json={"key": "DPAD_UP"}).status_code == 202
    with _provider_client(tmp_path, fake_remote, [peer]) as restarted:
        _refresh(restarted)
        providers = restarted.get("/api/providers").json()
        assert next(p for p in providers if p["id"] == peer.provider_id)["enabled"] is False
        assert restarted.get(f"/api/devices/{device_id}/integrations").json()["available"] is False
        assert restarted.get(f"/api/devices/{device_id}").json()["paired"] is True


def test_provider_loss_publishes_device_scoped_changes_on_the_existing_bus(tmp_path: Path, fake_remote: Any) -> None:
    """A provider outage reaches reactive clients without overwriting Cast state."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)

        async def observe_failure() -> list[dict[str, Any]]:
            """Capture a finite event batch from the public lifecycle refresh operation."""
            with client.app.state.devices.event_bus.subscribe() as queue:
                peer.failure = "unavailable"
                await client.app.state.providers.refresh()
                events = []
                while not queue.empty():
                    events.append(queue.get_nowait())
                return events

        assert client.portal is not None
        events = client.portal.call(observe_failure)
        integration_events = [e for e in events if e and e.get("type") == "integration.updated"]
        provider_events = [e for e in events if e and e.get("type") == "provider.updated"]
        assert any(e["device_id"] == device_id and e["integration"]["available"] is False for e in integration_events)
        assert any(e["provider"]["id"] == peer.provider_id for e in provider_events)
        assert client.get(f"/api/devices/{device_id}/state").json()["now_playing"] is None


@pytest.mark.parametrize("change", ["title", "expiry"])
def test_http_refresh_invalidates_playback_when_device_metadata_is_unchanged(
    tmp_path: Path, fake_remote: Any, change: str
) -> None:
    """HTTP-only providers must refresh visible playing state even without profile changes."""
    peer = ProviderStub()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)

        async def refresh_changed_playback() -> list[dict[str, Any]]:
            """Capture the normal fallback refresh's bounded event batch."""
            with client.app.state.devices.event_bus.subscribe() as queue:
                assert peer.playbacks[device_id] is not None
                if change == "title":
                    peer.playbacks[device_id]["title"] = "A newer observed title"
                else:
                    peer.playbacks[device_id]["observed_at"] = (datetime.now(UTC) - timedelta(seconds=31)).isoformat()
                await client.app.state.providers.refresh()
                events = []
                while not queue.empty():
                    events.append(queue.get_nowait())
                return events

        assert client.portal is not None
        events = client.portal.call(refresh_changed_playback)
        assert any(e and e.get("type") == "integration.updated" and e.get("device_id") == device_id for e in events)
        playback = client.get(f"/api/devices/{device_id}/playback").json()
        if change == "expiry":
            assert playback is None
        else:
            assert playback["title"] == "A newer observed title"


def test_request_deadline_includes_a_slow_drip_response_body(tmp_path: Path, fake_remote: Any) -> None:
    """A peer sending frequent small chunks cannot stretch a total request budget."""

    class SlowBody(httpx.AsyncByteStream):
        """Yield a valid JSON catalog over several short waits, exceeding the full budget."""

        def __init__(self, body: bytes) -> None:
            self.body = body

        async def __aiter__(self) -> Any:
            size = (len(self.body) + 7) // 8
            for offset in range(0, len(self.body), size):
                await asyncio.sleep(0.015)
                yield self.body[offset:offset + size]

    class SlowCatalog(ProviderStub):
        """Keep discovery prompt while delaying the body of one real data response."""

        def respond(self, request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/catalog"):
                self.requests.append(request)
                return httpx.Response(200, headers={"Content-Type": "application/json"}, stream=SlowBody(json.dumps(self.catalogs[TV_A]).encode()))
            return super().respond(request)

    with _provider_client(tmp_path, fake_remote, [SlowCatalog()], timeout=0.04) as client:
        device_id = _register(client)
        _refresh(client)
        started = time.monotonic()
        response = client.get(f"/api/devices/{device_id}/catalog")
        elapsed = time.monotonic() - started
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "provider_unavailable"
        assert elapsed < 0.1


@pytest.mark.parametrize("operation", ["catalog", "command"])
def test_inflight_results_are_rejected_after_profile_id_changes_with_same_revision(
    tmp_path: Path, fake_remote: Any, operation: str
) -> None:
    """A repeated revision string cannot make a different profile's late response current."""

    class HeldProvider(ProviderStub):
        """Pause one response after taking its old-profile snapshot."""

        hold = False
        entered: asyncio.Event
        release: asyncio.Event

        async def respond(self, request: httpx.Request) -> httpx.Response:
            response = super().respond(request)
            suffix = "/catalog" if operation == "catalog" else "/commands"
            if self.hold and request.url.path.endswith(suffix):
                self.entered.set()
                await self.release.wait()
            return response

    peer = HeldProvider()
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)

        async def switch_profile_during_request() -> httpx.Response:
            """Race through public HTTP with a real provider refresh between request/response."""
            peer.entered, peer.release = asyncio.Event(), asyncio.Event()
            peer.hold = True
            transport = httpx.ASGITransport(app=client.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://appliance.test") as asynchronous:
                if operation == "catalog":
                    pending = asyncio.create_task(asynchronous.get(f"/api/devices/{device_id}/catalog"))
                else:
                    pending = asyncio.create_task(asynchronous.post(f"/api/devices/{device_id}/provider/commands", json={
                        "command_id": str(uuid4()), "action": "launch", "item_id": "app-family", "profile_revision": "family-1",
                    }))
                try:
                    await asyncio.wait_for(peer.entered.wait(), timeout=1)
                    # Deliberately reuse the revision: the profile ID itself is essential context.
                    peer.devices[0]["profile_id"] = "another-profile"
                    await asyncio.wait_for(client.app.state.providers.refresh(), timeout=1)
                finally:
                    peer.release.set()
                return await asyncio.wait_for(pending, timeout=1)

        assert client.portal is not None
        response = client.portal.call(switch_profile_during_request)
        assert response.status_code in (400, 409)
        assert response.json()["error"]["code"] == "invalid_request"


@pytest.mark.parametrize("expected_profile", ["family", None])
def test_command_expected_profile_id_is_checked_and_not_forwarded(
    tmp_path: Path, fake_remote: Any, expected_profile: str | None
) -> None:
    """Old UI context cannot authorize a launch after a same-revision profile switch."""
    peer = ProviderStub()
    peer.devices[0]["profile_id"] = expected_profile
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        accepted = _command(client, device_id, "launch", item_id="app-family", profile_id=expected_profile, profile_revision="family-1")
        assert accepted.status_code in (200, 202)
        assert "profile_id" not in peer.commands[-1][1]
        before = len(peer.commands)
        peer.devices[0]["profile_id"] = "another-profile"
        # Revisions are opaque provider values; an ID switch must be checked independently.
        _refresh(client)
        rejected = _command(client, device_id, "launch", item_id="app-family", profile_id=expected_profile, profile_revision="family-1")
        assert rejected.status_code in (400, 409)
        assert rejected.json()["error"]["code"] == "invalid_request"
        assert len(peer.commands) == before


@pytest.mark.parametrize("state", ["UNKNOWN", "IDLE"])
def test_unknown_or_idle_provider_observation_is_not_usable_playback(
    tmp_path: Path, fake_remote: Any, state: str
) -> None:
    """Fresh identity-only/idle reports do not suppress a separate usable media source."""
    peer = ProviderStub()
    assert peer.playbacks[TV_A] is not None
    peer.playbacks[TV_A].update(player_state=state, title=None, actions=[])
    with _provider_client(tmp_path, fake_remote, [peer]) as client:
        device_id = _register(client)
        _refresh(client)
        response = client.get(f"/api/devices/{device_id}/playback")
        assert response.status_code == 200
        assert response.json() is None
