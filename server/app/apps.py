# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# App catalog for the Android TV Remote appliance. Defines the launchable apps served by
# GET /api/apps, each carrying a stable slug, a display name, the Android package id, an
# optional deep-link base URL, and the launch target handed verbatim to the protocol
# library's send_launch_app_command. Also provides the resolver that maps a catalog slug
# to its launch target while passing raw package ids and deep-link URLs straight through,
# so the launch endpoint is never limited to the curated list.
"""App catalog for the Android TV Remote appliance."""

from __future__ import annotations

from .models import AppDescriptor

#: Apps the UI offers as one-tap launches. ``launch`` is passed verbatim to the TV.
APPS: tuple[AppDescriptor, ...] = (
    AppDescriptor(
        id="netflix",
        name="Netflix",
        package="com.netflix.ninja",
        deep_link="https://www.netflix.com/title/",
        launch="com.netflix.ninja",
        icon="netflix",
    ),
    AppDescriptor(
        id="youtube",
        name="YouTube",
        package="com.google.android.youtube.tv",
        deep_link="https://www.youtube.com/watch?v=",
        launch="com.google.android.youtube.tv",
        icon="youtube",
    ),
    AppDescriptor(
        id="prime-video",
        name="Prime Video",
        package="com.amazon.amazonvideo.livingroom",
        deep_link=None,
        launch="com.amazon.amazonvideo.livingroom",
        icon="prime-video",
    ),
    AppDescriptor(
        id="disney-plus",
        name="Disney+",
        package="com.disney.disneyplus",
        deep_link=None,
        launch="com.disney.disneyplus",
        icon="disney-plus",
    ),
    AppDescriptor(
        id="spotify",
        name="Spotify",
        package="com.spotify.tv.android",
        deep_link=None,
        launch="com.spotify.tv.android",
        icon="spotify",
    ),
    AppDescriptor(
        id="plex",
        name="Plex",
        package="com.plexapp.android",
        deep_link=None,
        launch="com.plexapp.android",
        icon="plex",
    ),
    AppDescriptor(
        id="jellyfin",
        name="Jellyfin",
        package="org.jellyfin.androidtv",
        deep_link=None,
        launch="org.jellyfin.androidtv",
        icon="jellyfin",
    ),
    AppDescriptor(
        id="hbo-max",
        name="HBO Max",
        package="com.wbd.stream",
        deep_link=None,
        launch="com.wbd.stream",
        icon="hbo-max",
    ),
)

_APPS_BY_ID: dict[str, AppDescriptor] = {app.id: app for app in APPS}



def resolve_app(app: str) -> str:
    """Turn an app reference into the launch target handed to the TV.

    A catalog slug (``netflix``) resolves to that app's launch target. Anything else — a
    raw package id or a deep-link URL — is passed through unchanged, so the API is not
    limited to the catalog.

    :param app: Catalog slug, package id, or deep-link URL.
    :returns: The string to pass to ``send_launch_app_command``.
    """
    descriptor = _APPS_BY_ID.get(app.strip().lower())
    return descriptor.launch if descriptor else app
