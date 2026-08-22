# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# App icon resolution for the Android TV Remote appliance, backing GET /api/icons/{package}.
# Resolves an Android package id to real artwork through a four-rung fallback chain -- the
# on-disk cache on the data volume, the app's Play Store listing image, a bundled monochrome
# brand glyph, and finally a generated wordmark tile -- so the endpoint always answers with
# an image and the launcher never shows a hole. Play Store results are cached persistently so
# repeat requests and offline operation are served locally, failures are negative-cached so a
# missing app is not re-fetched on every page load, and the client-supplied package id is
# validated against a strict Android package pattern before it is used to build either an
# outbound URL or a cache filename.
"""App icon resolution for the Android TV Remote appliance."""

from __future__ import annotations

import asyncio
import hashlib
import html
import logging
import os
import re
import time
import urllib.parse
import urllib.request
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Annotated, NamedTuple

from fastapi import Depends, Request

from .config import Settings, get_settings
from .errors import RemoteError

LOGGER = logging.getLogger(__name__)

#: Android package ids: dot-separated Java identifiers, at least two segments. Anything else
#: is rejected before it can reach a URL or a filesystem path, which is what stops both
#: traversal (``../../etc/passwd``) and SSRF (``evil.host/x``) at the front door.
PACKAGE_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$")
#: Longest package id accepted. Real ids are far shorter; this bounds the cache filename.
MAX_PACKAGE_LENGTH = 200

#: Play Store listing page for one package. ``gl``/``hl`` pin the locale so the scrape is
#: not silently reshaped by the caller's geography.
PLAY_STORE_URL = "https://play.google.com/store/apps/details?id={package}&gl=us&hl=en"
#: Sent with every outbound request; the listing page is not served to unknown clients.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
#: Seconds any single outbound request may take. Deliberately short: a launcher that hangs
#: is worse than one showing plain tiles, and every failure has a usable fallback.
FETCH_TIMEOUT = 5.0
#: Hard cap on a single download. The listing page is ~1.2 MB; an icon is a few KB.
MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024
#: Hosts an icon may be downloaded from. The URL comes out of scraped HTML, so it is a
#: second SSRF hop and is allowlisted rather than trusted.
ALLOWED_IMAGE_HOSTS = (".googleusercontent.com", ".ggpht.com", ".gstatic.com")
#: Pixel size icons are normalised to, so the launcher is not pulling 512px art per tile.
ICON_SIZE = 256
#: How long a failed resolution is remembered, so a missing app is not re-fetched per load.
NEGATIVE_TTL = 3600.0
#: ``Cache-Control`` max-age for a real, cached icon. It is stable artwork; cache it hard.
CACHED_MAX_AGE = 604800
#: ``Cache-Control`` max-age for a generated fallback. Short, so a tile is replaced by real
#: artwork soon after connectivity returns rather than being pinned in the browser for days.
FALLBACK_MAX_AGE = 300

#: Content types accepted from the network, mapped to the cache-file extension used for
#: each. SVG is deliberately absent: a remote SVG served back from the appliance's own
#: origin would be stored XSS, and the Play Store serves raster art anyway.
DOWNLOAD_MEDIA_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
#: Cache-file extensions recognised on read, mapped to the type they are served as. Wider
#: than :data:`DOWNLOAD_MEDIA_TYPES` because an operator may pin an icon by hand by dropping
#: a file into the cache directory, and a hand-placed file is trusted local content.
CACHE_EXTENSIONS = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "svg": "image/svg+xml",
}

_OG_IMAGE_PATTERN = re.compile(
    r'<meta\s+property="og:image"\s+content="([^"]+)"', re.IGNORECASE
)
#: Trailing Google image-server size directive, e.g. ``=s0-br30`` or ``=w240-h480-rw``.
_SIZE_SUFFIX_PATTERN = re.compile(r"=[-\w]+$")
#: Cap on how many packages the in-memory lock and failure tables track before pruning.
_MAX_TRACKED_PACKAGES = 512
#: Package segments too generic to name an app, skipped when deriving a wordmark label.
_GENERIC_SEGMENTS = frozenset(
    {"com", "org", "net", "io", "co", "tv", "de", "uk", "me", "app", "apps", "android"}
)


class _Brand(NamedTuple):
    """One brand's display name, official colour, and optional monochrome glyph path."""

    #: Display name used on a wordmark tile and as the SVG's accessible label.
    name: str
    #: Official brand colour as a ``#rrggbb`` string.
    color: str
    #: simple-icons path data in a 24x24 viewBox, or ``""`` when no glyph is bundled.
    path: str


#: Bundled brand glyphs. Path data and colours come from simple-icons (CC0-1.0), baked in
#: rather than fetched so rung 3 works with no network and no packaging of asset files.
#: Disney+, Prime Video, Hulu, Peacock and Pluto TV are absent because simple-icons removed
#: them after trademark requests -- they resolve to a brand-coloured wordmark tile instead,
#: which is precisely why the chain has a fourth rung.
BRANDS: dict[str, _Brand] = {
    "netflix": _Brand(
        name="Netflix",
        color="#E50914",
        path=(
            "m5.398 0 8.348 23.602c2.346.059 4.856.398 4.856.398L10.113 0H5.398zm8.489 0v9.172l4.715 "
            "13.33V0h-4.715zM5.398 1.5V24c1.873-.225 2.81-.312 4.715-.398V14.83L5.398 1.5z"
        ),
    ),
    "youtube": _Brand(
        name="YouTube",
        color="#FF0000",
        path=(
            "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.37"
            "7.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2"
            ".122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.13"
            "6C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
        ),
    ),
    "spotify": _Brand(
        name="Spotify",
        color="#1ED760",
        path=(
            "M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66."
            "48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-."
            "78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-"
            "1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1."
            "141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5"
            ".16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.72"
            "1 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"
        ),
    ),
    "plex": _Brand(
        name="Plex",
        color="#EBAF00",
        path=(
            "M3.987 8.409c-.96 0-1.587.28-2.12.933v-.72H0v8.88s.038.018.127.037c.138.03.821.187 1.331"
            "-.249.441-.377.542-.814.542-1.318v-1.283c.533.573 1.147.813 2 .813 1.84 0 3.253-1.493 3."
            "253-3.48 0-2.12-1.36-3.613-3.266-3.613Zm16.748 5.595.406.591c.391.614.894.906 1.492.908."
            "621-.012 1.064-.562 1.226-.755 0 0-.307-.27-.686-.72-.517-.614-1.214-1.755-1.24-1.803l-1"
            ".198 1.779Zm-3.205-1.955c0-2.08-1.52-3.64-3.52-3.64s-3.467 1.587-3.467 3.573a3.48 3.48 0"
            " 0 0 3.507 3.52c1.413 0 2.626-.84 3.253-2.293h-2.04l-.093.093c-.427.4-.72.533-1.227.533-"
            ".787 0-1.373-.506-1.453-1.266h4.986c.04-.214.054-.307.054-.52Zm-7.671-.219c0 .769.11 1.7"
            "01.868 2.722l.056.069c-.306.526-.742.88-1.248.88-.399 0-.814-.211-1.138-.579a2.177 2.177"
            " 0 0 1-.538-1.441V6.409H9.86l-.001 5.421Zm9.283 3.46h-2.39l2.247-3.332-2.247-3.335h2.39l"
            "2.248 3.335-2.248 3.332Zm1.593-1.286Zm-17.162-.342c-.933 0-1.68-.773-1.68-1.72s.76-1.666"
            " 1.68-1.666c.92 0 1.68.733 1.68 1.68 0 .946-.733 1.706-1.68 1.706Zm18.361-1.974L24 8.622"
            "h-2.391l-.87 1.293 1.195 1.773Zm-9.404-.466c.16-.706.72-1.133 1.493-1.133.773 0 1.373.46"
            "7 1.507 1.133h-3Z"
        ),
    ),
    "jellyfin": _Brand(
        name="Jellyfin",
        color="#00A4DC",
        path=(
            "M12 .002C8.826.002-1.398 18.537.16 21.666c1.56 3.129 22.14 3.094 23.682 0C25.384 18.573 "
            "15.177 0 12 0zm7.76 18.949c-1.008 2.028-14.493 2.05-15.514 0C3.224 16.9 9.92 4.755 12.00"
            "3 4.755c2.081 0 8.77 12.166 7.759 14.196zM12 9.198c-1.054 0-4.446 6.15-3.93 7.189.518 1."
            "04 7.348 1.027 7.86 0 .511-1.027-2.874-7.19-3.93-7.19z"
        ),
    ),
    "max": _Brand(
        name="Max",
        color="#525252",
        path=(
            "M1.769 0A1.77 1.77 0 0 0 0 1.769V22.23A1.77 1.77 0 0 0 1.769 24H22.23A1.77 1.77 0 0 0 24"
            " 22.231V1.77A1.77 1.77 0 0 0 22.231 0zm12.485 3.28a4.301 4.301 0 0 1 4.3 4.302 4.301 4.3"
            "01 0 0 1-1.993 3.63 6.085 6.085 0 0 1 1.054 3.422 6.085 6.085 0 0 1-6.085 6.085 6.085 6."
            "085 0 0 1-6.085-6.085 6.085 6.085 0 0 1 4.66-5.916 4.301 4.301 0 0 1-.152-1.136 4.301 4."
            "301 0 0 1 4.301-4.301zm0 1.849a2.453 2.453 0 0 0-2.453 2.453 2.453 2.453 0 0 0 2.453 2.4"
            "53 2.453 2.453 0 0 0 2.453-2.453 2.453 2.453 0 0 0-2.453-2.453zm-2.724 5.268a4.237 4.237"
            " 0 0 0-4.237 4.237 4.237 4.237 0 0 0 4.237 4.237 4.237 4.237 0 0 0 4.237-4.237 4.237 4.2"
            "37 0 0 0-4.237-4.237zm.032 2.54a1.781 1.781 0 1 1 0 3.562 1.781 1.781 0 0 1 0-3.562Z"
        ),
    ),
    "appletv": _Brand(
        name="Apple TV",
        color="#000000",
        path=(
            "M20.57 17.735h-1.815l-3.34-9.203h1.633l2.02 5.987c.075.231.273.9.586 2.012l.297-.997.33-"
            "1.006 2.094-6.004H24zm-5.344-.066a5.76 5.76 0 0 1-1.55.207c-1.23 0-1.84-.693-1.84-2.087V"
            "9.646h-1.063V8.532h1.121V7.081l1.476-.602v2.062h1.707v1.113H13.38v5.805c0 .446.074.75.21"
            "4.932.14.182.396.264.75.264.207 0 .495-.041.883-.115zm-7.29-5.343c.017 1.764 1.55 2.358 "
            "1.567 2.366-.017.042-.248.842-.808 1.658-.487.71-.99 1.418-1.79 1.435-.783.016-1.03-.462"
            "-1.93-.462-.89 0-1.17.445-1.913.478-.758.025-1.344-.775-1.838-1.484-.998-1.451-1.765-4.0"
            "98-.734-5.88.51-.89 1.426-1.451 2.416-1.46.75-.016 1.468.512 1.93.512.461 0 1.327-.627 2"
            ".234-.536.38.016 1.452.157 2.136 1.154-.058.033-1.278.743-1.27 2.219M6.468 7.988c.404-.4"
            "95.685-1.18.61-1.864-.585.025-1.294.388-1.723.883-.38.437-.71 1.138-.619 1.806.652.05 1."
            "328-.338 1.732-.825Z"
        ),
    ),
    "twitch": _Brand(
        name="Twitch",
        color="#9146FF",
        path=(
            "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V2"
            "4l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h1"
            "3.714Z"
        ),
    ),
    "kodi": _Brand(
        name="Kodi",
        color="#17B2E7",
        path=(
            "M12.03.047c-.226 0-.452.107-.669.324-.922.922-1.842 1.845-2.763 2.768-.233.233-.455.48-."
            "703.695-.31.267-.405.583-.399.988.02 1.399.008 2.799.008 4.198 0 1.453-.002 2.907 0 4.36"
            " 0 .11.002.223.03.327.087.337.303.393.546.15 1.31-1.31 2.618-2.622 3.928-3.933l4.449-4.4"
            "53c.43-.431.43-.905 0-1.336L12.697.37c-.216-.217-.442-.324-.668-.324zm7.224 7.23c-.223 0"
            "-.445.104-.65.309L14.82 11.37c-.428.429-.427.895 0 1.322l3.76 3.766c.44.44.908.44 1.346."
            "002 1.215-1.216 2.427-2.433 3.644-3.647.182-.18.353-.364.43-.615v-.33c-.077-.251-.246-.4"
            "36-.428-.617-1.224-1.22-2.443-2.445-3.666-3.668-.205-.205-.429-.307-.652-.307zM4.18 7.61"
            "1c-.086.014-.145.094-.207.157L.209 11.572c-.28.284-.278.677.004.96l2.043 2.046c.59.59 1."
            "177 1.182 1.767 1.772.169.168.33.139.416-.084.044-.114.062-.242.063-.364.004-1.283.004-2"
            ".567.004-3.851h-.002V8.184c0-.085-.01-.169-.022-.252-.019-.135-.072-.258-.207-.309a.186."
            "186 0 0 0-.095-.012zm7.908 6.838c-.224 0-.447.106-.656.315L7.66 18.537c-.433.434-.433.89"
            "9.002 1.334 1.215 1.216 2.43 2.43 3.643 3.649.18.18.361.354.611.433h.33c.244-.069.423-.2"
            "26.598-.402 1.222-1.23 2.45-2.453 3.676-3.68.43-.43.427-.905-.004-1.338l-3.772-3.773c-.2"
            "08-.208-.432-.311-.656-.31z"
        ),
    ),
    "crunchyroll": _Brand(
        name="Crunchyroll",
        color="#FF5E00",
        path=(
            "M2.909 13.436C2.914 7.61 7.642 2.893 13.468 2.898c5.576.005 10.137 4.339 10.51 9.819q.02"
            "1-.351.022-.706C24.007 5.385 18.64.006 12.012 0S.007 5.36 0 11.988 5.36 23.994 11.988 24"
            "q.412 0 .815-.027c-5.526-.338-9.9-4.928-9.894-10.538Zm16.284.155a4.1 4.1 0 0 1-4.095-4.1"
            "03 4.1 4.1 0 0 1 2.712-3.855 8.95 8.95 0 0 0-4.187-1.037 9.007 9.007 0 1 0 8.997 9.016q-"
            ".001-.847-.15-1.651a4.1 4.1 0 0 1-3.278 1.63Z"
        ),
    ),
    "paramountplus": _Brand(
        name="Paramount+",
        color="#0064FF",
        path=(
            "M16.347 21.373c.057-.084.151-.314-.025-.74l-.53-1.428c-.073-.182.084-.293.19-.173 0 0 1."
            "004 1.157 1.264 1.64l.495.822c.425.028 1.6.06 2.732.06a3.26 3.26 0 0 1-.316-.364c-1.93-2"
            ".392-3.154-3.724-3.166-3.737-.391-.426-.572-.508-.87-.643a4.82 4.82 0 0 1-.138-.065v.364"
            "c0 .047-.057.073-.086.022l-2.846-5.001a1.598 1.598 0 0 0-.508-.587l-.277-.194-1.354 3.12"
            "3c.212 0 .354.216.27.409l-1.25 2.893h1.147c.443 0 .883.087 1.294.255l.302.125s-.913 1.87"
            "8-.913 2.867c0 .181.028.362.075.534h2.104l-.096-.595s1.266.294 2.502.413M12 2.437c-6.627"
            " 0-12 5.373-12 12 0 2.669.873 5.133 2.346 7.126.503-.218.783-.542.983-.791l2.234-2.858a."
            "467.467 0 0 1 .179-.138l.336-.146 3.674-4.659.534-.417 1.094-1.524a.482.482 0 0 1 .101-."
            "102l.478-.347a.34.34 0 0 1 .398-.004l.578.407c.308.216.557.504.726.84l2.322 4.077c.051.0"
            "9.09.129.182.174.454.227.732.268 1.33.913.277.304 1.495 1.666 3.203 3.784.236.318.538.58"
            "8.963.783A11.948 11.948 0 0 0 24 14.437c0-6.627-5.373-12-12-12M3.236 15.1l-.778-.253-.48"
            ".662v-.818l-.778-.253.778-.253v-.818l.48.662.778-.253-.48.662Zm-.185 2.676-.252.778-.253"
            "-.778h-.818l.661-.481-.253-.777.663.48.66-.48-.252.777.662.481Zm.156-6.195.253.778-.661-"
            ".48-.663.48.253-.778-.66-.48h.817l.253-.778.252.777h.818Zm1.314-1.76L4.04 9.16l-.778.253"
            ".48-.661-.48-.663.778.254.48-.662v.818l.778.253-.777.252Zm2.045-2.862-.253.777-.252-.777"
            "h-.818l.662-.48-.253-.778.661.48.661-.48-.252.777.662.48Zm2.577-1.313-.48.661V5.49l-.779"
            "-.254.778-.253v-.817l.48.66.78-.253-.481.663.48.66zm3.265-.75.253.778-.661-.48-.662.48.2"
            "52-.777-.66-.481h.818L12 3.637l.252.778h.818zm2.93.595v.816l-.481-.661-.777.252.48-.662-"
            ".48-.662.777.253.48-.66v.817l.779.252zm5.426 8.285.778.253.48-.662v.818l.778.253-.778.25"
            "3v.818l-.48-.662-.778.253.48-.662zm-3.077-6.04-.253-.777h-.818l.662-.48-.253-.778.662.48"
            ".662-.48-.254.778.662.48h-.818zm1.792 2.086v-.818l-.777-.252.777-.253V7.68l.481.662.777-"
            ".254-.48.663.48.66-.777-.252zm1.469 1.278.253-.777.254.777h.816l-.66.481.252.778-.662-.4"
            "8-.661.48.253-.778-.662-.48zm.506 6.676-.253.778-.253-.778h-.817l.662-.481-.253-.777.66."
            "48.663-.48-.253.777.661.481zm-12.08-.615.76-1.588c.024-.048-.032-.108-.067-.067l-.664.66"
            "8c-.313.329-.847 1.25-.95 1.421l-.808 1.335a.109.109 0 0 1 .1.162l-.739 1.238c-.18.309.1"
            "45.523.189.452 1.157-1.868 1.832-1.719 1.832-1.719l.387-.897c.022-.047-.001-.1-.05-.12-."
            "12-.05-.316-.27.01-.885z"
        ),
    ),
    "emby": _Brand(
        name="Emby",
        color="#52B54B",
        path=(
            "M11.041 0c-.007 0-1.456 1.43-3.219 3.176L4.615 6.352l.512.513.512.512-2.819 2.791L0 12.9"
            "61l1.83 1.848c1.006 1.016 2.438 2.46 3.182 3.209l1.351 1.359.508-.496c.28-.273.515-.498."
            "524-.498.008 0 1.266 1.264 2.794 2.808L12.97 24l.187-.182c.23-.225 5.007-4.95 5.717-5.65"
            "6l.52-.516-.502-.513c-.276-.282-.5-.52-.496-.53.003-.009 1.264-1.26 2.802-2.783 1.538-1."
            "522 2.8-2.776 2.803-2.785.005-.012-3.617-3.684-6.107-6.193L17.65 4.6l-.505.505c-.279.278"
            "-.517.501-.53.497-.013-.005-1.27-1.267-2.793-2.805A449.655 449.655 0 0011.041 0zM9.223 7"
            ".367c.091.038 7.951 4.608 7.957 4.627.003.013-1.781 1.056-3.965 2.32a999.898 999.898 0 0"
            "1-3.996 2.307c-.019.006-.026-1.266-.026-4.629 0-3.7.007-4.634.03-4.625Z"
        ),
    ),
    # Brands simple-icons dropped over trademark requests: colour and name only, so the
    # wordmark tile is still on-brand even though there is no glyph to draw.
    "disneyplus": _Brand(name="Disney+", color="#113CCF", path=""),
    "primevideo": _Brand(name="Prime Video", color="#00A8E1", path=""),
    "hulu": _Brand(name="Hulu", color="#1CE783", path=""),
    "peacock": _Brand(name="Peacock", color="#005EB8", path=""),
    "plutotv": _Brand(name="Pluto TV", color="#000000", path=""),
}

#: Android package ids mapped to a :data:`BRANDS` key. Both the TV and phone package ids are
#: listed where they differ, because a TV reports whichever one is installed.
PACKAGE_BRANDS: dict[str, str] = {
    "com.netflix.ninja": "netflix",
    "com.netflix.mediaclient": "netflix",
    "com.google.android.youtube.tv": "youtube",
    "com.google.android.youtube": "youtube",
    "com.google.android.apps.youtube.music": "youtube",
    "com.spotify.tv.android": "spotify",
    "com.spotify.music": "spotify",
    "com.plexapp.android": "plex",
    "org.jellyfin.androidtv": "jellyfin",
    "org.jellyfin.mobile": "jellyfin",
    "com.wbd.stream": "max",
    "com.hbo.hbonow": "max",
    "com.apple.atve.androidtv.appletv": "appletv",
    "tv.twitch.android.app": "twitch",
    "org.xbmc.kodi": "kodi",
    "com.crunchyroll.crunchyroid": "crunchyroll",
    "com.cbs.ott": "paramountplus",
    "tv.emby.embyatv": "emby",
    "com.disney.disneyplus": "disneyplus",
    "com.amazon.amazonvideo.livingroom": "primevideo",
    "com.amazon.avod.thirdpartyclient": "primevideo",
    "com.hulu.plus": "hulu",
    "com.hulu.livingroomplus": "hulu",
    "com.peacocktv.peacockandroid": "peacock",
    "tv.pluto.android": "plutotv",
}


class InvalidPackage(RemoteError):
    """Raised when a package id fails :data:`PACKAGE_PATTERN`.

    The frozen contract has no dedicated code for this, and ``errors.py`` is frozen, so the
    already-contracted ``invalid_request`` / 400 pair is reused rather than inventing a new
    one or editing a frozen module.
    """

    code = "invalid_request"
    status = 400


class ResolvedIcon(NamedTuple):
    """An icon plus everything the HTTP layer needs to serve and cache it."""

    #: The image bytes.
    data: bytes
    #: The ``Content-Type`` to serve them as.
    media_type: str
    #: Strong entity tag derived from the bytes, for conditional requests.
    etag: str
    #: Which rung of the fallback chain produced this: ``cache``, ``play``, ``glyph``,
    #: or ``tile``. Surfaced as ``X-Icon-Source`` so a wrong icon can be diagnosed.
    source: str
    #: ``Cache-Control`` max-age appropriate to :attr:`source`.
    max_age: int


class FetchResult(NamedTuple):
    """The outcome of one outbound HTTP GET."""

    #: Response body, truncated to :data:`MAX_DOWNLOAD_BYTES`.
    body: bytes
    #: Raw ``Content-Type`` header, parameters included.
    content_type: str
    #: The final URL after any redirects, so the allowlist can be re-checked.
    url: str


#: Signature of the outbound fetcher. Injected so tests can fake the network entirely.
Fetcher = Callable[[str], Awaitable[FetchResult]]


def validate_package(package: str) -> str:
    """Check a client-supplied package id before it is used in a URL or a path.

    This is the trust boundary for the icon endpoint: ``package`` arrives from the client
    and is interpolated into both an outbound URL and a cache filename, so a value that
    does not look exactly like an Android package id is rejected outright.

    :param package: The raw path parameter.
    :returns: The package id, unchanged, when it is well formed.
    :raises InvalidPackage: If the value is empty, over-long, or not a dotted Java
        identifier sequence -- which covers ``..``, absolute paths, and URLs.
    """
    if not package or len(package) > MAX_PACKAGE_LENGTH or not PACKAGE_PATTERN.match(package):
        raise InvalidPackage(f"{package!r} is not a valid Android package id")
    return package


def brand_for(package: str) -> _Brand | None:
    """Look up the bundled brand entry for a package id.

    :param package: A validated Android package id.
    :returns: The matching :class:`_Brand`, or ``None`` when the package is not catalogued.
    """
    slug = PACKAGE_BRANDS.get(package)
    return BRANDS.get(slug) if slug else None


def _label_for(package: str) -> str:
    """Derive a short human label for a package with no catalogued brand.

    :param package: A validated Android package id.
    :returns: The first non-generic path segment, capitalised and truncated.
    """
    for segment in package.split("."):
        if segment.lower() not in _GENERIC_SEGMENTS:
            return segment[:12].capitalize()
    return package.split(".")[-1][:12].capitalize()


def _contrast_ink(color: str) -> str:
    """Pick black or white ink for legibility against a background colour.

    Brand colours are not all dark -- Plex is yellow and Spotify is bright green -- so white
    ink is not a safe default if the tile is to stay readable.

    :param color: Background colour as ``#rrggbb``.
    :returns: ``#111111`` on a light background, ``#FFFFFF`` on a dark one.
    """
    red, green, blue = (int(color[index : index + 2], 16) for index in (1, 3, 5))
    # ITU-R BT.601 luma, the same weighting browsers use for perceived brightness.
    return "#111111" if (red * 299 + green * 587 + blue * 114) / 1000 > 150 else "#FFFFFF"


def _svg_document(color: str, body: str, label: str) -> bytes:
    """Wrap tile contents in a square, rounded, brand-coloured SVG.

    :param color: Tile background colour as ``#rrggbb``.
    :param body: SVG markup drawn on top of the background.
    :param label: Accessible name for the tile.
    :returns: The encoded SVG document.
    """
    safe = html.escape(label, quote=True)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ICON_SIZE} {ICON_SIZE}" '
        f'width="{ICON_SIZE}" height="{ICON_SIZE}" role="img" aria-label="{safe}">'
        f"<title>{safe}</title>"
        f'<rect width="{ICON_SIZE}" height="{ICON_SIZE}" rx="{ICON_SIZE // 8}" fill="{color}"/>'
        f"{body}</svg>"
    ).encode("utf-8")


def render_glyph(brand: _Brand) -> bytes:
    """Render rung 3: a bundled monochrome brand glyph on a brand-coloured tile.

    :param brand: A brand entry whose :attr:`_Brand.path` is non-empty.
    :returns: The encoded SVG document.
    """
    # simple-icons paths live in a 24x24 box; scale it to 56% of the tile and centre it.
    scale = ICON_SIZE * 0.56 / 24
    offset = (ICON_SIZE - 24 * scale) / 2
    glyph = (
        f'<g transform="translate({offset:.2f},{offset:.2f}) scale({scale:.4f})" '
        f'fill="{_contrast_ink(brand.color)}"><path d="{brand.path}"/></g>'
    )
    return _svg_document(brand.color, glyph, brand.name)


def render_tile(package: str) -> bytes:
    """Render rung 4: a wordmark tile, brand-coloured when the brand is known.

    This is the last rung and cannot fail, which is what makes the endpoint total.

    :param package: A validated Android package id.
    :returns: The encoded SVG document.
    """
    brand = brand_for(package)
    label = brand.name if brand else _label_for(package)
    # Neutral slate when the brand is unknown, per the contract's fallback description.
    color = brand.color if brand else "#3F4551"
    # A bold sans glyph averages ~0.62em wide, so this keeps any label inside the tile
    # without measuring text, which SVG cannot do server-side.
    font_size = min(104, int(330 / max(len(label), 1)))
    text = (
        f'<text x="{ICON_SIZE // 2}" y="{ICON_SIZE // 2}" text-anchor="middle" '
        f'dominant-baseline="central" fill="{_contrast_ink(color)}" font-weight="700" '
        f'font-size="{font_size}" font-family="system-ui,-apple-system,Segoe UI,Roboto,'
        f'Helvetica,Arial,sans-serif">{html.escape(label)}</text>'
    )
    return _svg_document(color, text, label)


def _is_allowed_image_url(url: str) -> bool:
    """Check a scraped or redirected image URL against the outbound allowlist.

    The URL is extracted from third-party HTML, so it is attacker-influenced in the same
    way the package id is: without this check the endpoint would fetch whatever the page
    named, which is a server-side request forgery primitive.

    :param url: Absolute URL to test.
    :returns: ``True`` when the URL is HTTPS on an allowlisted Google image host.
    """
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    return any(host == allowed.lstrip(".") or host.endswith(allowed) for allowed in ALLOWED_IMAGE_HOSTS)


def _normalise_size(url: str) -> str:
    """Rewrite a Google image URL to ask for a launcher-sized icon.

    Google's image servers take a trailing size directive, so the icon is resized at the
    source. That is what lets the appliance normalise dimensions with no image library in
    the runtime container: a listing's default ``=s0-br30`` yields a 512px PNG, while
    ``=s256`` yields the same art at 256px and roughly a third of the bytes.

    :param url: The scraped ``og:image`` URL.
    :returns: The URL with its size directive replaced by ``=s<ICON_SIZE>``.
    """
    head, separator, tail = url.rpartition("/")
    if not separator:
        return url
    return f"{head}/{_SIZE_SUFFIX_PATTERN.sub('', tail)}=s{ICON_SIZE}"


def _fetch_blocking(url: str) -> FetchResult:
    """Perform one outbound GET. Blocking; always called on a worker thread.

    :param url: Absolute HTTPS URL to fetch.
    :returns: The body, content type, and post-redirect URL.
    :raises ValueError: If the URL is not HTTPS or the response exceeds the size cap.
    :raises OSError: On any transport failure, including a timeout.
    """
    # Defence in depth behind the allowlist: urllib would otherwise happily open file://.
    if not url.startswith("https://"):
        raise ValueError(f"refusing to fetch a non-HTTPS URL: {url!r}")
    request = urllib.request.Request(  # noqa: S310 - scheme is checked immediately above
        url, headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}
    )
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:
        body = response.read(MAX_DOWNLOAD_BYTES + 1)
        if len(body) > MAX_DOWNLOAD_BYTES:
            raise ValueError(f"response from {url!r} exceeds {MAX_DOWNLOAD_BYTES} bytes")
        return FetchResult(body, response.headers.get("Content-Type", ""), response.geturl())


async def fetch_url(url: str) -> FetchResult:
    """Fetch a URL without blocking the event loop.

    ``urllib`` is used rather than an async HTTP client because the appliance's runtime
    image installs no HTTP client library, and one icon fetch does not justify adding a
    dependency to every deployment. Running it on a worker thread keeps the loop free, so a
    slow Play Store response never delays a request for a different package.

    :param url: Absolute HTTPS URL to fetch.
    :returns: The body, content type, and post-redirect URL.
    """
    return await asyncio.to_thread(_fetch_blocking, url)


class IconService:
    """Resolves package ids to icons through the cache/Play Store/glyph/tile chain.

    One instance is shared per application. It owns the on-disk cache directory, an
    in-memory negative cache, and a per-package lock so that concurrent requests for the
    same icon collapse into a single outbound fetch while requests for different packages
    stay fully parallel.

    :param settings: Resolved settings; supplies ``data_dir``.
    :param fetcher: Outbound HTTP callable, overridden by tests to fake the network.
    """

    def __init__(self, settings: Settings, fetcher: Fetcher | None = None) -> None:
        """Initialize the service against a data directory and an outbound fetcher."""
        self._settings = settings
        self._fetch = fetcher or fetch_url
        self._locks: dict[str, asyncio.Lock] = {}
        self._failed_until: dict[str, float] = {}

    @property
    def cache_dir(self) -> Path:
        """Directory holding cached icons.

        :returns: ``<data_dir>/icons``.
        """
        return self._settings.data_dir / "icons"

    async def resolve(self, package: str, *, refresh: bool = False) -> ResolvedIcon:
        """Resolve one package to an icon, walking the fallback chain until something wins.

        :param package: Client-supplied Android package id.
        :param refresh: When true, discard any cached result and re-resolve from source.
        :returns: The resolved icon; never ``None`` and never an error, because the final
            rung is generated locally and cannot fail.
        :raises InvalidPackage: If ``package`` is not a well-formed Android package id.
        """
        validate_package(package)
        if refresh:
            await asyncio.to_thread(self._purge, package)

        cached = await asyncio.to_thread(self._read_cache, package)
        if cached is not None:
            return _resolved(cached[0], cached[1], "cache", CACHED_MAX_AGE)

        async with self._lock_for(package):
            # Re-checked under the lock: whoever held it before us may have just filled the
            # cache, and refetching would waste an outbound request per queued caller.
            cached = await asyncio.to_thread(self._read_cache, package)
            if cached is not None:
                return _resolved(cached[0], cached[1], "cache", CACHED_MAX_AGE)
            if not self._recently_failed(package):
                downloaded = await self._fetch_store_icon(package)
                if downloaded is not None:
                    data, media_type = downloaded
                    await asyncio.to_thread(self._write_cache, package, data, media_type)
                    return _resolved(data, media_type, "play", CACHED_MAX_AGE)
                self._remember_failure(package)

        brand = brand_for(package)
        if brand is not None and brand.path:
            return _resolved(render_glyph(brand), "image/svg+xml", "glyph", FALLBACK_MAX_AGE)
        return _resolved(render_tile(package), "image/svg+xml", "tile", FALLBACK_MAX_AGE)

    async def _fetch_store_icon(self, package: str) -> tuple[bytes, str] | None:
        """Try rung 2: scrape the Play Store listing and download its artwork.

        Every failure mode -- no listing, no ``og:image``, a URL off the allowlist, a
        timeout, an unexpected content type -- returns ``None`` rather than raising, because
        the caller's job is to fall through to a generated tile, not to surface an error.

        :param package: A validated Android package id.
        :returns: ``(image bytes, content type)``, or ``None`` if the icon could not be had.
        """
        listing_url = PLAY_STORE_URL.format(package=urllib.parse.quote(package, safe=""))
        try:
            page = await self._fetch(listing_url)
        except Exception as error:  # any transport or protocol failure is just a miss
            LOGGER.info("Play Store listing for %s could not be fetched: %s", package, error)
            return None

        match = _OG_IMAGE_PATTERN.search(page.body.decode("utf-8", "replace"))
        if match is None:
            LOGGER.info("Play Store listing for %s carries no og:image", package)
            return None

        image_url = _normalise_size(html.unescape(match.group(1)))
        if not _is_allowed_image_url(image_url):
            LOGGER.warning("Refusing off-allowlist icon URL for %s: %s", package, image_url)
            return None

        try:
            image = await self._fetch(image_url)
        except Exception as error:
            LOGGER.info("Icon download for %s failed: %s", package, error)
            return None

        # Re-checked after the fact because urllib follows redirects, and a redirect off the
        # allowlist would otherwise be an unvalidated hop.
        if not _is_allowed_image_url(image.url):
            LOGGER.warning("Icon for %s redirected off-allowlist: %s", package, image.url)
            return None

        media_type = image.content_type.split(";")[0].strip().lower()
        if media_type not in DOWNLOAD_MEDIA_TYPES or not image.body:
            LOGGER.info("Icon for %s has unusable content type %r", package, media_type)
            return None
        return image.body, media_type

    # -- cache ---------------------------------------------------------------------

    def _cache_path(self, package: str, extension: str) -> Path:
        """Build the cache path for one package and file extension.

        :param package: A package id already through :func:`validate_package`.
        :param extension: File extension without the dot.
        :returns: The absolute path the icon is stored at.
        """
        return self.cache_dir / f"{package}.{extension}"

    def _read_cache(self, package: str) -> tuple[bytes, str] | None:
        """Read a cached icon from the data volume. Blocking; called on a worker thread.

        :param package: A validated Android package id.
        :returns: ``(bytes, content type)``, or ``None`` when nothing is cached.
        """
        for extension, media_type in CACHE_EXTENSIONS.items():
            path = self._cache_path(package, extension)
            try:
                return path.read_bytes(), media_type
            except OSError:
                continue
        return None

    def _write_cache(self, package: str, data: bytes, media_type: str) -> None:
        """Persist a resolved icon. Blocking; called on a worker thread.

        Written to a temporary file and renamed, so a crash or a concurrent reader never
        observes a half-written icon on the shared data volume.

        :param package: A validated Android package id.
        :param data: The image bytes to store.
        :param media_type: Content type the bytes were served with.
        """
        path = self._cache_path(package, DOWNLOAD_MEDIA_TYPES[media_type])
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(f"{path.suffix}.tmp")
            temporary.write_bytes(data)
            os.replace(temporary, path)
        except OSError:
            # A read-only or full volume must not break the endpoint; it just stops caching.
            LOGGER.warning("Could not cache the icon for %s at %s", package, path, exc_info=True)

    def _purge(self, package: str) -> None:
        """Drop every cached artefact for one package. Blocking; called on a worker thread.

        :param package: A validated Android package id.
        """
        self._failed_until.pop(package, None)
        for extension in CACHE_EXTENSIONS:
            self._cache_path(package, extension).unlink(missing_ok=True)

    # -- in-memory state -----------------------------------------------------------

    def _lock_for(self, package: str) -> asyncio.Lock:
        """Return the per-package fetch lock, so one package fetches once at a time.

        :param package: A validated Android package id.
        :returns: The lock guarding outbound resolution for this package.
        """
        if len(self._locks) > _MAX_TRACKED_PACKAGES:
            # ponytail: coarse prune of idle locks to bound memory against a client that
            # walks many package ids. Racing this can at worst cause one duplicate fetch,
            # never a wrong result; swap in an LRU if that ever shows up in practice.
            self._locks = {key: lock for key, lock in self._locks.items() if lock.locked()}
        return self._locks.setdefault(package, asyncio.Lock())

    def _recently_failed(self, package: str) -> bool:
        """Check whether resolution for this package failed recently.

        Without this, a package with no Play Store listing would re-scrape on every tile
        render of every page load.

        :param package: A validated Android package id.
        :returns: ``True`` while the negative-cache entry is still live.
        """
        expiry = self._failed_until.get(package)
        if expiry is None:
            return False
        if expiry > time.monotonic():
            return True
        del self._failed_until[package]
        return False

    def _remember_failure(self, package: str) -> None:
        """Negative-cache a failed resolution for :data:`NEGATIVE_TTL` seconds.

        :param package: A validated Android package id.
        """
        now = time.monotonic()
        if len(self._failed_until) > _MAX_TRACKED_PACKAGES:
            self._failed_until = {
                key: expiry for key, expiry in self._failed_until.items() if expiry > now
            }
        self._failed_until[package] = now + NEGATIVE_TTL


def _resolved(data: bytes, media_type: str, source: str, max_age: int) -> ResolvedIcon:
    """Bundle icon bytes with the entity tag and caching policy the HTTP layer needs.

    :param data: The image bytes.
    :param media_type: Content type to serve them as.
    :param source: Which rung of the chain produced them.
    :param max_age: ``Cache-Control`` max-age for this kind of result.
    :returns: The assembled :class:`ResolvedIcon`.
    """
    etag = f'"{hashlib.sha256(data).hexdigest()[:32]}"'
    return ResolvedIcon(data=data, media_type=media_type, etag=etag, source=source, max_age=max_age)


def get_icon_service(request: Request) -> IconService:
    """FastAPI dependency returning the application's icon service, creating it on first use.

    Attached lazily to application state rather than built in the app factory, so this
    workstream adds no edit to ``main.py`` and cannot collide with a parallel stream there.

    :param request: The incoming request, carrying application state.
    :returns: The process-wide :class:`IconService`.
    """
    service: IconService | None = getattr(request.app.state, "icons", None)
    if service is None:
        settings: Settings = getattr(request.app.state, "settings", None) or get_settings()
        service = IconService(settings)
        request.app.state.icons = service
    return service


#: Convenience alias for the icon route.
IconServiceDep = Annotated[IconService, Depends(get_icon_service)]
