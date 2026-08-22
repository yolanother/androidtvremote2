# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Tests for the app icon service and the GET /api/icons/{package} endpoint. Exercises every
# rung of the fallback chain with the network faked -- an on-disk cache hit, a successful
# Play Store scrape, a Play Store failure falling through to a bundled brand glyph, and an
# unknown package producing a generated wordmark tile -- and pins the properties the
# launcher depends on: that the endpoint always answers with an image rather than a 404,
# that a resolved icon is cached persistently and served without a second network call, that
# traversal-style and otherwise malformed package ids are rejected before they reach a URL
# or a path, and that a scraped image URL pointing off the allowlist is refused.
"""Tests for the app icon service and the icon endpoint."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from app.apps import APPS
from app.config import Settings
from app.icons import (
    BRANDS,
    IconService,
    InvalidPackage,
    _is_allowed_image_url,
    _normalise_size,
    validate_package,
)

#: Stand-in for real artwork. The service never decodes image bytes, only stores them.
FAKE_PNG = b"\x89PNG\r\n\x1a\nfake-artwork"
#: Where a scraped og:image points before the size directive is normalised.
LISTING_IMAGE = "https://play-lh.googleusercontent.com/AbCdEf123=s0-br30"


def listing_html(image_url: str = LISTING_IMAGE, title: str = "Netflix") -> bytes:
    """Build a minimal Play Store listing page carrying the tags the scraper reads.

    :param image_url: Value of the ``og:image`` meta tag.
    :param title: Value of the ``og:title`` meta tag.
    :returns: The encoded HTML.
    """
    return (
        f'<html><head><meta property="og:title" content="{title} - Apps on Google Play">'
        f'<meta property="og:image" content="{image_url}"></head><body></body></html>'
    ).encode("utf-8")


class FakeNetwork:
    """Scripted stand-in for the outbound fetcher, recording every URL requested.

    :param routes: URL to ``(body, content type)``. A URL that is absent raises, which is
        how a Play Store outage or a missing listing is simulated.
    :param delay: Seconds to sleep before answering, for concurrency assertions.
    :param hold: Substring marking URLs that block until :attr:`gate` is set. Used instead
        of a sleep so concurrency assertions are deterministic rather than timing races.
    """

    def __init__(
        self,
        routes: dict[str, tuple[bytes, str]] | None = None,
        delay: float = 0.0,
        hold: str | None = None,
    ):
        """Initialize the fake with a routing table, an optional delay, and an optional gate."""
        self.routes = routes or {}
        self.delay = delay
        self.hold = hold
        self.gate = asyncio.Event()
        self.calls: list[str] = []

    async def __call__(self, url: str) -> Any:
        """Answer one request from the routing table.

        :param url: The URL being fetched.
        :returns: A ``FetchResult``-shaped tuple.
        :raises OSError: When the URL is not in the routing table.
        """
        from app.icons import FetchResult

        self.calls.append(url)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.hold and self.hold in url:
            await self.gate.wait()
        if url not in self.routes:
            raise OSError(f"scripted network failure for {url}")
        body, content_type = self.routes[url]
        return FetchResult(body=body, content_type=content_type, url=url)


def netflix_routes() -> dict[str, tuple[bytes, str]]:
    """Routing table where the Netflix listing resolves all the way to artwork.

    :returns: A routing table for :class:`FakeNetwork`.
    """
    return {
        "https://play.google.com/store/apps/details?id=com.netflix.ninja&gl=us&hl=en": (
            listing_html(),
            "text/html; charset=utf-8",
        ),
        "https://play-lh.googleusercontent.com/AbCdEf123=s256": (FAKE_PNG, "image/png"),
    }


@pytest.fixture
def service_settings(tmp_path: Path) -> Settings:
    """Settings pointed at an isolated data directory, for direct service tests.

    :param tmp_path: pytest-supplied unique temporary directory.
    :returns: Settings whose ``data_dir`` is under ``tmp_path``.
    """
    return Settings(data_dir=tmp_path / "data", discovery_enabled=False, _env_file=None)


def use_network(client: Any, network: FakeNetwork) -> None:
    """Attach an icon service backed by a fake network to a running app.

    The route builds its service lazily from application state, so replacing it before the
    first icon request is all that is needed to take the real network out of the picture.

    :param client: The app's test client.
    :param network: The fake fetcher to install.
    """
    client.app.state.icons = IconService(client.app.state.settings, fetcher=network)


# -- package validation: the traversal and SSRF boundary ----------------------------


@pytest.mark.parametrize(
    "package",
    [
        "../../etc/passwd",
        "..",
        "com.foo/../../bar",
        "/etc/passwd",
        "com.foo.bar/baz",
        "com..bar",
        "com.foo bar",
        "com",
        "",
        "1com.foo",
        "com.foo;rm -rf /",
        "http://evil.host/x",
        "com.foo%2e%2e",
        "a" * 400 + ".b",
    ],
)
def test_validate_package_rejects_anything_that_is_not_a_package_id(package: str) -> None:
    """A package id that could escape a path or reshape a URL is refused outright."""
    with pytest.raises(InvalidPackage):
        validate_package(package)


@pytest.mark.parametrize(
    "package",
    [
        "com.netflix.ninja",
        "com.google.android.youtube.tv",
        "org.jellyfin.androidtv",
        "com.amazon.amazonvideo.livingroom",
        "tv.twitch.android.app",
        "com.example.app_2",
    ],
)
def test_validate_package_accepts_real_package_ids(package: str) -> None:
    """Every package id the catalog and the wider ecosystem use passes validation."""
    assert validate_package(package) == package


def test_endpoint_rejects_traversal_style_package_names(app_client: Any) -> None:
    """A traversal attempt gets the contract's error envelope, not an icon or a stack trace."""
    use_network(app_client, FakeNetwork())
    response = app_client.get("/api/icons/..%2F..%2Fetc%2Fpasswd")
    assert response.status_code in (400, 404)
    if response.status_code == 400:
        assert response.json()["error"]["code"] == "invalid_request"


def test_endpoint_rejects_a_malformed_package_with_the_error_envelope(app_client: Any) -> None:
    """A package id that reaches the handler but is malformed is a 400 invalid_request."""
    use_network(app_client, FakeNetwork())
    response = app_client.get("/api/icons/notapackage")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_no_cache_file_is_written_for_a_rejected_package(app_client: Any) -> None:
    """A rejected package never creates a file, so validation really is before the path."""
    use_network(app_client, FakeNetwork())
    app_client.get("/api/icons/notapackage")
    icons_dir = Path(app_client.app.state.settings.data_dir) / "icons"
    assert not icons_dir.exists() or not list(icons_dir.iterdir())


# -- rung 1: the on-disk cache -------------------------------------------------------


def test_cache_hit_is_served_without_touching_the_network(app_client: Any) -> None:
    """An icon already on the data volume is served locally, which is what works offline."""
    network = FakeNetwork()
    use_network(app_client, network)
    icons_dir = Path(app_client.app.state.settings.data_dir) / "icons"
    icons_dir.mkdir(parents=True)
    (icons_dir / "com.netflix.ninja.png").write_bytes(FAKE_PNG)

    response = app_client.get("/api/icons/com.netflix.ninja")

    assert response.status_code == 200
    assert response.content == FAKE_PNG
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-icon-source"] == "cache"
    assert network.calls == []


def test_a_hand_pinned_svg_wins_over_every_other_rung(app_client: Any) -> None:
    """Dropping a file into the cache directory is the documented way to pin an icon."""
    use_network(app_client, FakeNetwork(netflix_routes()))
    icons_dir = Path(app_client.app.state.settings.data_dir) / "icons"
    icons_dir.mkdir(parents=True)
    (icons_dir / "com.netflix.ninja.svg").write_bytes(b"<svg>pinned</svg>")

    response = app_client.get("/api/icons/com.netflix.ninja")

    assert response.content == b"<svg>pinned</svg>"
    assert response.headers["content-type"] == "image/svg+xml"


# -- rung 2: the Play Store ----------------------------------------------------------


def test_play_store_icon_is_fetched_cached_and_reused(app_client: Any) -> None:
    """The first request resolves from the listing; the second is served from disk."""
    network = FakeNetwork(netflix_routes())
    use_network(app_client, network)

    first = app_client.get("/api/icons/com.netflix.ninja")
    assert first.status_code == 200
    assert first.content == FAKE_PNG
    assert first.headers["x-icon-source"] == "play"
    assert len(network.calls) == 2

    cached = Path(app_client.app.state.settings.data_dir) / "icons" / "com.netflix.ninja.png"
    assert cached.read_bytes() == FAKE_PNG

    second = app_client.get("/api/icons/com.netflix.ninja")
    assert second.status_code == 200
    assert second.content == FAKE_PNG
    assert second.headers["x-icon-source"] == "cache"
    assert len(network.calls) == 2, "the cached icon must not cost a second network call"


def test_the_scraped_image_url_is_normalised_to_a_launcher_sized_icon() -> None:
    """The Google size directive is rewritten so the appliance never serves 512px tiles."""
    assert _normalise_size(LISTING_IMAGE) == "https://play-lh.googleusercontent.com/AbCdEf123=s256"
    assert _normalise_size("https://play-lh.googleusercontent.com/x=w240-h480-rw").endswith("=s256")
    assert _normalise_size("https://play-lh.googleusercontent.com/plain") == (
        "https://play-lh.googleusercontent.com/plain=s256"
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.host/icon.png",
        "http://play-lh.googleusercontent.com/x",
        "https://play-lh.googleusercontent.com.evil.host/x",
        "file:///etc/passwd",
        "https://googleusercontent.com.attacker.io/x",
    ],
)
def test_off_allowlist_image_urls_are_refused(url: str) -> None:
    """The og:image URL comes out of third-party HTML, so it is a second SSRF hop."""
    assert not _is_allowed_image_url(url)


@pytest.mark.parametrize(
    "url",
    ["https://play-lh.googleusercontent.com/x", "https://lh3.ggpht.com/x", "https://ssl.gstatic.com/x"],
)
def test_google_image_hosts_are_allowed(url: str) -> None:
    """The hosts the Play Store actually serves artwork from resolve normally."""
    assert _is_allowed_image_url(url)


def test_a_listing_pointing_off_allowlist_falls_through_instead_of_fetching(
    app_client: Any,
) -> None:
    """A poisoned og:image is not fetched at all; the request degrades to a glyph."""
    network = FakeNetwork(
        {
            "https://play.google.com/store/apps/details?id=com.netflix.ninja&gl=us&hl=en": (
                listing_html("https://evil.host/payload.png"),
                "text/html",
            ),
            "https://evil.host/payload.png=s256": (FAKE_PNG, "image/png"),
        }
    )
    use_network(app_client, network)

    response = app_client.get("/api/icons/com.netflix.ninja")

    assert response.status_code == 200
    assert response.headers["x-icon-source"] == "glyph"
    assert not any("evil.host" in call for call in network.calls)


def test_a_non_image_response_is_not_cached(app_client: Any) -> None:
    """An HTML error page served in place of artwork must not become the app's icon."""
    routes = netflix_routes()
    routes["https://play-lh.googleusercontent.com/AbCdEf123=s256"] = (b"<html>nope</html>", "text/html")
    use_network(app_client, FakeNetwork(routes))

    response = app_client.get("/api/icons/com.netflix.ninja")

    assert response.headers["x-icon-source"] == "glyph"
    icons_dir = Path(app_client.app.state.settings.data_dir) / "icons"
    assert not icons_dir.exists() or not list(icons_dir.iterdir())


# -- rung 3: the bundled brand glyph -------------------------------------------------


def test_play_store_failure_falls_through_to_a_brand_glyph(app_client: Any) -> None:
    """With the network down, a catalogued brand still renders as its own artwork."""
    use_network(app_client, FakeNetwork())

    response = app_client.get("/api/icons/com.netflix.ninja")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert response.headers["x-icon-source"] == "glyph"
    body = response.text
    assert BRANDS["netflix"].color in body
    assert BRANDS["netflix"].path in body


def test_a_glyph_is_not_written_to_the_cache(app_client: Any) -> None:
    """Caching a fallback would pin the wrong icon forever once the network came back."""
    use_network(app_client, FakeNetwork())
    app_client.get("/api/icons/com.netflix.ninja")
    icons_dir = Path(app_client.app.state.settings.data_dir) / "icons"
    assert not icons_dir.exists() or not list(icons_dir.iterdir())


def test_brand_glyph_paths_round_tripped_intact() -> None:
    """The baked simple-icons path data is well formed, not truncated by source wrapping."""
    for slug, brand in BRANDS.items():
        assert brand.color.startswith("#") and len(brand.color) == 7, slug
        if brand.path:
            assert brand.path[0] in "Mm", slug
            assert brand.path.rstrip()[-1] in "Zz", slug
            assert "  " not in brand.path, slug


# -- rung 4: the generated wordmark tile ---------------------------------------------


def test_an_unknown_package_still_produces_an_image(app_client: Any) -> None:
    """The last rung is generated locally, which is what makes the endpoint total."""
    use_network(app_client, FakeNetwork())

    response = app_client.get("/api/icons/com.example.somethingnew")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert response.headers["x-icon-source"] == "tile"
    assert "Example" in response.text


def test_a_brand_without_a_bundled_glyph_gets_a_brand_coloured_tile(app_client: Any) -> None:
    """Disney+ has no simple-icons glyph, so it must still come back on-brand."""
    use_network(app_client, FakeNetwork())

    response = app_client.get("/api/icons/com.disney.disneyplus")

    assert response.headers["x-icon-source"] == "tile"
    assert BRANDS["disneyplus"].color in response.text
    assert "Disney+" in response.text


def test_tile_ink_stays_legible_on_a_light_brand_colour(app_client: Any) -> None:
    """Plex is yellow and Hulu is bright green; white text on either would be unreadable."""
    use_network(app_client, FakeNetwork())
    body = app_client.get("/api/icons/com.hulu.plus").text
    assert "#111111" in body


# -- endpoint totality ---------------------------------------------------------------


def test_every_catalog_app_returns_an_image_with_no_network(app_client: Any) -> None:
    """A launcher rendering the whole catalog offline gets eight images and no holes."""
    use_network(app_client, FakeNetwork())
    for app in APPS:
        assert app.package
        response = app_client.get(f"/api/icons/{app.package}")
        assert response.status_code == 200, app.package
        assert response.headers["content-type"].startswith("image/"), app.package
        assert response.content, app.package


def test_catalog_apps_advertise_the_icon_endpoint() -> None:
    """``AppDescriptor.icon_url`` points at this endpoint for every app with a package."""
    for app in APPS:
        assert app.icon_url == f"/api/icons/{app.package}"


# -- caching headers and refresh -----------------------------------------------------


def test_a_resolved_icon_is_cached_hard_and_a_fallback_is_not(app_client: Any) -> None:
    """Real artwork is stable, but a tile must be replaced once the network is back."""
    use_network(app_client, FakeNetwork(netflix_routes()))
    real = app_client.get("/api/icons/com.netflix.ninja")
    assert "max-age=604800" in real.headers["cache-control"]

    fallback = app_client.get("/api/icons/com.example.somethingnew")
    assert "max-age=300" in fallback.headers["cache-control"]


def test_an_unchanged_icon_answers_304(app_client: Any) -> None:
    """A conditional request saves the launcher from re-downloading every tile."""
    use_network(app_client, FakeNetwork(netflix_routes()))
    first = app_client.get("/api/icons/com.netflix.ninja")
    etag = first.headers["etag"]

    second = app_client.get("/api/icons/com.netflix.ninja", headers={"If-None-Match": etag})

    assert second.status_code == 304
    assert second.headers["etag"] == etag


def test_refresh_discards_the_cached_icon_and_re_resolves(app_client: Any) -> None:
    """A wrong or stale icon can be corrected without a redeploy."""
    network = FakeNetwork(netflix_routes())
    use_network(app_client, network)
    app_client.get("/api/icons/com.netflix.ninja")
    assert len(network.calls) == 2

    network.routes["https://play-lh.googleusercontent.com/AbCdEf123=s256"] = (
        b"\x89PNG\r\n\x1a\nnewer-artwork",
        "image/png",
    )
    refreshed = app_client.get("/api/icons/com.netflix.ninja?refresh=1")

    assert refreshed.content == b"\x89PNG\r\n\x1a\nnewer-artwork"
    assert refreshed.headers["x-icon-source"] == "play"
    assert len(network.calls) == 4


# -- service behaviour under load ----------------------------------------------------


async def test_a_failure_is_negative_cached(service_settings: Settings) -> None:
    """A package with no listing must not re-scrape on every tile render of every page."""
    network = FakeNetwork()
    service = IconService(service_settings, fetcher=network)

    await service.resolve("com.example.missing")
    calls_after_first = len(network.calls)
    await service.resolve("com.example.missing")

    assert calls_after_first == 1
    assert len(network.calls) == 1


async def test_concurrent_requests_for_one_package_share_a_single_fetch(
    service_settings: Settings,
) -> None:
    """Eight tiles for the same app must not become eight Play Store requests."""
    network = FakeNetwork(netflix_routes(), delay=0.02)
    service = IconService(service_settings, fetcher=network)

    results = await asyncio.gather(*(service.resolve("com.netflix.ninja") for _ in range(8)))

    assert all(result.data == FAKE_PNG for result in results)
    assert len(network.calls) == 2, "one listing fetch and one image fetch, not eight of each"


async def test_a_stalled_package_does_not_hold_up_a_different_package(
    service_settings: Settings,
) -> None:
    """A hanging Play Store request for one app must not stall the rest of the launcher.

    The slow fetch is gated on an event rather than a sleep, so this asserts the ordering
    itself: if resolution serialised across packages, the second request could never
    complete before the first is released and the wait would time out.
    """
    network = FakeNetwork(netflix_routes(), hold="netflix")
    service = IconService(service_settings, fetcher=network)

    stalled = asyncio.create_task(service.resolve("com.netflix.ninja"))
    await asyncio.sleep(0)  # let the stalled fetch reach the gate

    other = await asyncio.wait_for(service.resolve("com.example.other"), timeout=2.0)

    assert other.source == "tile"
    assert not stalled.done(), "the stalled package is still waiting, as the test intends"
    network.gate.set()
    assert (await stalled).source == "play"


async def test_resolution_never_raises_for_any_valid_package(service_settings: Settings) -> None:
    """Whatever the network does, a valid package id resolves to bytes and a media type."""

    async def hostile(url: str) -> Any:
        raise RuntimeError("everything is on fire")

    service = IconService(service_settings, fetcher=hostile)
    for package in ("com.netflix.ninja", "com.disney.disneyplus", "com.nobody.knows.this"):
        icon = await service.resolve(package)
        assert icon.data and icon.media_type.startswith("image/")


def test_a_non_https_url_is_refused_before_any_socket_is_opened() -> None:
    """urllib would happily open file://; the fetcher refuses anything but HTTPS."""
    from app.icons import _fetch_blocking

    with pytest.raises(ValueError, match="non-HTTPS"):
        _fetch_blocking("file:///etc/passwd")


def test_an_unwritable_cache_directory_does_not_break_the_endpoint(
    service_settings: Settings,
) -> None:
    """A read-only or full data volume degrades to no caching, not to a broken launcher."""
    service = IconService(service_settings, fetcher=FakeNetwork(netflix_routes()))
    # A file where the icons directory should be makes every mkdir and write fail.
    service_settings.data_dir.mkdir(parents=True, exist_ok=True)
    (service_settings.data_dir / "icons").write_text("not a directory")

    icon = asyncio.run(service.resolve("com.netflix.ninja"))

    assert icon.data == FAKE_PNG
    assert icon.source == "play"
