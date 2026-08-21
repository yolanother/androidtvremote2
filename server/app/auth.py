# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Optional bearer-token authentication for the Android TV Remote appliance. When
# REMOTE_API_TOKEN is unset — the default, because a fresh docker compose up must produce
# a working remote on a trusted LAN with zero configuration — nothing is checked. When it
# is set, every /api and /mcp request must present the token, either as an Authorization
# bearer header or as a ?token= query parameter; the query form exists because an
# <iframe src> and the browser WebSocket constructor cannot set headers.
"""Optional bearer-token authentication for the Android TV Remote appliance."""

from __future__ import annotations

import hmac

from .config import Settings
from .errors import Unauthorized

#: Query parameter carrying the token when a header cannot be set.
TOKEN_QUERY_PARAM = "token"


def extract_token(authorization: str | None, query_token: str | None) -> str | None:
    """Pull the presented token out of a request.

    :param authorization: Value of the ``Authorization`` header, if any.
    :param query_token: Value of the ``token`` query parameter, if any.
    :returns: The presented token, or ``None`` if the request carried neither form.
    """
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer" and value:
            return value.strip()
    return query_token or None


def verify(settings: Settings, authorization: str | None, query_token: str | None) -> None:
    """Authenticate a request against the configured token.

    :param settings: Resolved appliance configuration.
    :param authorization: Value of the ``Authorization`` header, if any.
    :param query_token: Value of the ``token`` query parameter, if any.
    :raises Unauthorized: If a token is configured and the request did not present it.
    """
    if not settings.auth_enabled:
        return
    presented = extract_token(authorization, query_token)
    expected = settings.remote_api_token or ""
    if presented is None or not hmac.compare_digest(presented, expected):
        raise Unauthorized("A valid API token is required")
