# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Tests for the optional bearer-token authentication. Covers the default zero-config case
# where no token is set and nothing is checked, the enabled case where /api requires the
# token, the query-parameter form that exists because an iframe src and a browser
# WebSocket constructor cannot set headers, and the guarantee that /healthz is never
# authenticated so a container health check keeps working.
"""Tests for the optional bearer-token authentication."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "s3cret-token"


@pytest.fixture
def secured_client(tmp_path: Path, fake_remote: Any) -> Any:
    """A test client for an app that requires a bearer token.

    :param tmp_path: pytest-supplied unique temporary directory.
    :param fake_remote: The FakeRemote class used as the remote factory.
    :returns: A ``TestClient`` bound to the running, token-protected app.
    """
    settings = Settings(
        data_dir=tmp_path / "data",
        discovery_enabled=False,
        remote_api_token=TOKEN,
        _env_file=None,
    )
    application = create_app(
        settings=settings,
        remote_factory=fake_remote,
        legacy_seed_path=tmp_path / "no-such-paired_tvs.json",
    )
    with TestClient(application) as client:
        yield client


def test_no_token_configured_means_no_check(app_client: Any) -> None:
    """A fresh ``docker compose up`` with no configuration must just work."""
    assert app_client.get("/api/devices").status_code == 200


def test_a_missing_token_is_401_in_the_envelope(secured_client: Any) -> None:
    """With a token configured, an unauthenticated request is ``unauthorized``."""
    response = secured_client.get("/api/devices")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_a_wrong_token_is_401(secured_client: Any) -> None:
    """A token that does not match is rejected."""
    assert (
        secured_client.get("/api/devices", headers={"Authorization": "Bearer nope"}).status_code
        == 401
    )


def test_the_bearer_header_is_accepted(secured_client: Any) -> None:
    """The documented header form authenticates."""
    assert (
        secured_client.get(
            "/api/devices", headers={"Authorization": f"Bearer {TOKEN}"}
        ).status_code
        == 200
    )


def test_the_query_parameter_form_is_accepted(secured_client: Any) -> None:
    """``?token=`` exists because an iframe src and a WebSocket cannot set headers."""
    assert secured_client.get(f"/api/devices?token={TOKEN}").status_code == 200


def test_healthz_is_never_authenticated(secured_client: Any) -> None:
    """A container health check must not need a credential."""
    assert secured_client.get("/healthz").status_code == 200


def test_the_websocket_rejects_a_missing_token(secured_client: Any) -> None:
    """An unauthenticated WebSocket is closed rather than served the snapshot."""
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect), secured_client.websocket_connect("/api/ws") as socket:
        socket.receive_json()


def test_the_websocket_accepts_the_query_token(secured_client: Any) -> None:
    """The browser WebSocket constructor can only authenticate via the query string."""
    with secured_client.websocket_connect(f"/api/ws?token={TOKEN}") as socket:
        assert socket.receive_json()["type"] == "snapshot"
