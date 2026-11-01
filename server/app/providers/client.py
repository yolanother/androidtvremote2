# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Bounded HTTP transport for optional Android TV Remote providers. Restricts requests
# to a validated provider origin and versioned base path, disables redirects and proxy
# environment inheritance, and limits decoded response size before JSON validation.
# It deliberately never receives or forwards the appliance's bearer token.
"""Origin-scoped, bounded provider HTTP requests."""

from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

import httpx

from ..errors import ProviderUnavailable

MAX_RESPONSE_BYTES = 2 * 1024 * 1024


def provider_url(value: str) -> str:
    """Normalize a provider base URL, rejecting credentials and ambiguous path components.

    :param value: Explicit or DNS-SD-discovered provider base URL.
    :returns: An HTTP(S) origin with a version-one base path.
    :raises ValueError: If the URL could escape the provider origin or contract path.
    """
    parsed = urlsplit(value.strip())
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path.rstrip("/") != "/atvr/v1"
    ):
        raise ValueError("provider URL must be an HTTP(S) origin with /atvr/v1 and no credentials")
    _ = parsed.port  # validates malformed or out-of-range ports
    return urlunsplit((parsed.scheme, parsed.netloc, "/atvr/v1", "", ""))


def segment(value: str) -> str:
    """Encode an opaque provider identifier as one path segment.

    :param value: Item or canonical TV identity.
    :returns: A path-safe identifier.
    :raises ValueError: For empty or relative path traversal identifiers.
    """
    if not value or value in {".", ".."} or "\x00" in value:
        raise ValueError("invalid provider identifier")
    return quote(value, safe="")


class ProviderClient:
    """Reusable HTTP client with a finite timeout and no appliance credentials.

    :param timeout: Total request/body deadline in seconds, also used for HTTP inactivity.
    :param transport: Optional in-process transport for integration tests.
    """

    def __init__(self, timeout: float, transport: httpx.AsyncBaseTransport | None = None) -> None:
        """Create the client without performing network I/O."""
        self._timeout = timeout
        self.http = httpx.AsyncClient(
            timeout=timeout, transport=transport, follow_redirects=False, trust_env=False,
        )

    async def close(self) -> None:
        """Release connection pools after registry tasks have stopped."""
        await self.http.aclose()

    async def request(
        self, base: str, path: str, *, body: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
    ) -> Any:
        """Fetch JSON below a provider's fixed base, with a bounded decoded body.

        :param base: Validated provider base URL.
        :param path: Locally constructed relative endpoint path.
        :param body: Optional JSON body; selects POST rather than GET.
        :param params: Escaped query parameters.
        :returns: Parsed JSON data, awaiting schema validation by the registry.
        :raises ProviderUnavailable: For deadline, connection, redirect, size or JSON failures.
        """
        if path.startswith(("/", ".")) or "://" in path or "?" in path or "#" in path:
            raise ProviderUnavailable("Invalid provider endpoint")
        try:
            # httpx's read timeout is an inactivity timeout. A slow peer sending
            # frequent tiny chunks could otherwise keep this request alive forever.
            async with asyncio.timeout(self._timeout):
                async with self.http.stream(
                    "POST" if body is not None else "GET", f"{base}/{path}",
                    json=body, params=params,
                ) as response:
                    if response.status_code < 200 or response.status_code >= 300:
                        raise ProviderUnavailable(f"Provider returned HTTP {response.status_code}")
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > MAX_RESPONSE_BYTES:
                            raise ProviderUnavailable("Provider response exceeded 2 MiB")
                    return json.loads(content)
        except ProviderUnavailable:
            raise
        except TimeoutError as exc:
            raise ProviderUnavailable("Provider exceeded the total request deadline") from exc
        except (httpx.HTTPError, ValueError, UnicodeError) as exc:
            raise ProviderUnavailable("Provider did not return a valid bounded JSON response") from exc
