# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Runnable, HTTP-only example of Android TV Remote's version-one provider protocol.
# Simulates one TV catalog, guide and media session entirely in memory, including
# guarded commands and UUID deduplication. Never connects to or controls a real TV.
"""Simulated provider for adapter development and offline remote UI verification."""

from __future__ import annotations

import argparse
import json
import math
import re
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse


def create_fixture_app(device_id: str = "aabbccddeeff") -> FastAPI:
    """Build an isolated simulated provider without opening sockets or contacting TVs.

    :param device_id: Canonical TV identity to advertise for local fixture testing.
    :returns: FastAPI application implementing the version-one HTTP provider protocol.
    :raises ValueError: If the identity is not twelve lowercase hexadecimal digits.
    """
    if not re.fullmatch(r"[0-9a-f]{12}", device_id):
        raise ValueError("device_id must be twelve lowercase hexadecimal digits")
    app = FastAPI(title="Example provider (simulated)")
    base = "/atvr/v1"
    revision = "demo-1"
    package = "org.example.player"
    session = {
        "session_id": "example-session", "package": package,
        "title": "Simulated programme", "subtitle": "Example data — no TV is controlled",
        "images": [], "player_state": "PLAYING", "position": 60.0, "duration": 1800.0,
        "channel_id": None, "actions": ["play", "pause", "play_pause", "seek", "stop"],
    }
    state: dict = {"playback": session}
    seen: dict[str, tuple[str, dict]] = {}

    def check(tv: str) -> None:
        """Reject requests for a TV outside this isolated fixture."""
        if tv != device_id:
            raise HTTPException(404, "Unknown example TV")

    def observation() -> dict | None:
        """Sample the simulated player; launch acceptance never changes its metadata."""
        current = state["playback"]
        if current is None:
            return None
        at = datetime.now(UTC).isoformat()
        return {**current, "position_at": at, "observed_at": at}

    @app.exception_handler(HTTPException)
    async def errors(request: Request, exc: HTTPException) -> JSONResponse:
        """Use the provider error envelope for expected fixture failures."""
        return JSONResponse(status_code=exc.status_code, content={"error": {
            "code": "not_found" if exc.status_code == 404 else "invalid_request", "message": str(exc.detail),
        }})

    @app.get(f"{base}/manifest")
    async def manifest() -> dict:
        """Identify this provider clearly as simulated data."""
        return {"id": "example", "name": "Example provider (simulated)", "version": 1}

    @app.get(f"{base}/devices")
    async def devices() -> list[dict]:
        """Advertise one virtual TV with an independent demo profile."""
        return [{"id": device_id, "name": "Example TV (simulated)", "online": True,
                 "capabilities": ["catalog", "browse", "guide", "tune", "channel_step", "playback", "profiles"],
                 "profile_id": "demo", "profile_revision": revision}]

    @app.get(f"{base}/devices/{{tv}}/catalog")
    async def catalog(tv: str) -> dict:
        """Return a generic simulated app, without proprietary services or origins."""
        check(tv)
        return {"revision": revision, "profile_revision": revision, "items": [{
            "id": "example-player", "name": "Example player", "kind": "app", "package": package,
            "icon_url": None, "available": True, "action": {"type": "launch", "item_id": "example-player"},
        }]}

    @app.get(f"{base}/devices/{{tv}}/playback")
    async def playback(tv: str) -> dict | None:
        """Report only this fixture's simulated player state."""
        check(tv)
        return observation()

    @app.get(f"{base}/devices/{{tv}}/guide")
    async def guide(tv: str, request: Request) -> dict:
        """Provide authoritative half-hour intervals for a positive window of at most one day."""
        check(tv)
        try:
            start = datetime.fromisoformat(request.query_params["from"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(request.query_params["to"].replace("Z", "+00:00"))
            if start.tzinfo is None or end.tzinfo is None or not 0 < (end - start).total_seconds() <= 86400:
                raise ValueError("invalid window")
        except (KeyError, ValueError):
            raise HTTPException(400, "Guide requires a UTC window of at most 24 hours") from None
        cursor = datetime.fromtimestamp(math.floor(start.timestamp() / 1800) * 1800, UTC)
        programmes = []
        while cursor < end:
            until = cursor + timedelta(minutes=30)
            programmes.append({"id": f"example-{int(cursor.timestamp())}", "title_id": "example-title",
                               "title": "Simulated programme", "subtitle": "Example provider", "image_url": None,
                               "start": cursor.isoformat(), "end": until.isoformat(), "available": True})
            cursor = until
        return {"revision": revision, "profile_revision": revision, "timezone": "UTC",
                "server_time": datetime.now(UTC).isoformat(), "channels": [{"id": "example-channel",
                "name": "Example channel", "number": 1, "kind": "recommendation", "programmes": programmes}]}

    @app.get(f"{base}/devices/{{tv}}/browse")
    async def browse(tv: str) -> dict:
        """Return one synthetic card for browsing/continue fixtures."""
        check(tv)
        return {"revision": revision, "profile_revision": revision, "items": [{"id": "example-title",
                "title": "Simulated programme", "subtitle": "Example provider", "image_url": None,
                "available": True}], "next_cursor": None}

    @app.get(f"{base}/devices/{{tv}}/titles/{{title_id}}")
    async def title(tv: str, title_id: str) -> dict:
        """Describe the example title and its supported launch actions."""
        check(tv)
        if title_id != "example-title":
            raise HTTPException(404, "Unknown example title")
        return {"id": title_id, "title": "Simulated programme", "subtitle": "Example provider",
                "image_url": None, "available": True, "actions": ["open", "resume"]}

    @app.get(f"{base}/devices/{{tv}}/profiles")
    async def profiles(tv: str) -> dict:
        """Return the virtual TV's single demo profile."""
        check(tv)
        return {"items": [{"id": "demo", "name": "Demo", "image_url": None}], "active_id": "demo", "revision": revision}

    @app.post(f"{base}/devices/{{tv}}/commands")
    async def command(tv: str, request: Request) -> dict:
        """Deduplicate actions and control only the in-memory player, never a physical device."""
        check(tv)
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, "A JSON command is required") from None
        if not isinstance(body, dict):
            raise HTTPException(400, "A command object is required")
        try:
            command_id = str(UUID(body["command_id"]))
        except (KeyError, ValueError, TypeError, AttributeError):
            raise HTTPException(400, "A command UUID is required") from None
        signature = json.dumps(body, sort_keys=True)
        if command_id in seen:
            previous_signature, result = seen[command_id]
            if signature != previous_signature:
                raise HTTPException(409, "Command UUID already used")
            return result
        if body.get("profile_revision", revision) != revision:
            raise HTTPException(409, "Profile changed")
        action = body.get("action")
        if not isinstance(action, str) or action not in {
            "launch", "open", "resume", "tune", "channel_step", "set_profile",
            "play", "pause", "play_pause", "stop", "seek",
        }:
            raise HTTPException(400, "Unsupported action")
        current = state["playback"]
        if action in {"launch", "open", "resume", "tune", "channel_step", "set_profile"}:
            result = {"command_id": command_id, "status": "accepted"}
        elif current and action in current["actions"]:
            if body.get("session_id") != current["session_id"]:
                raise HTTPException(409, "Playback session changed")
            if action == "seek":
                position = body.get("position")
                if isinstance(position, bool) or not isinstance(position, (int, float)) or not math.isfinite(position) or not 0 <= position <= current["duration"]:
                    raise HTTPException(400, "Invalid seek position")
                current["position"] = position
            elif action == "stop":
                state["playback"] = None
            else:
                current["player_state"] = "PAUSED" if action == "pause" or action == "play_pause" and current["player_state"] == "PLAYING" else "PLAYING"
            result = {"command_id": command_id, "status": "completed"}
        else:
            raise HTTPException(409, "Action or playback session is unavailable")
        seen[command_id] = (signature, result)
        if len(seen) > 128:
            del seen[next(iter(seen))]
        return result

    return app


def main() -> None:
    """Serve the example on loopback for explicit local development configuration."""
    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device-id", default="aabbccddeeff")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    uvicorn.run(create_fixture_app(args.device_id), host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
