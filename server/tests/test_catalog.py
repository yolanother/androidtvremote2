# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Tests for the key and app catalogs. Verifies that every catalogued key maps to a real
# keycode in the vendored protocol's RemoteKeyCode enum, that key lookup accepts both the
# short form and the full keycode, that unknown keys raise InvalidKey rather than being
# forwarded to the TV, and that the app catalog entries carry a launch target.
"""Tests for the key and app catalogs."""

from __future__ import annotations

import pytest

from app.apps import APPS, resolve_app
from app.errors import InvalidKey
from app.keys import KEYS, resolve_key


def test_every_key_is_a_real_android_keycode() -> None:
    """Each catalog entry names a keycode the vendored protobuf enum actually defines."""
    from androidtvremote2.remotemessage_pb2 import RemoteKeyCode

    valid = {RemoteKeyCode.Name(value) for value in RemoteKeyCode.values()}
    for descriptor in KEYS:
        assert descriptor.keycode in valid, descriptor.keycode


def test_catalog_covers_every_category() -> None:
    """The catalog has at least one key in each category the contract declares."""
    categories = {descriptor.category for descriptor in KEYS}
    assert categories == {
        "navigation",
        "transport",
        "volume",
        "power",
        "channel",
        "input",
        "numeric",
        "system",
    }


@pytest.mark.parametrize("supplied", ["DPAD_UP", "KEYCODE_DPAD_UP", "dpad_up"])
def test_resolve_key_accepts_short_and_full_forms(supplied: str) -> None:
    """Both ``DPAD_UP`` and ``KEYCODE_DPAD_UP`` resolve to the same keycode."""
    assert resolve_key(supplied) == "KEYCODE_DPAD_UP"


def test_resolve_key_rejects_unknown_keys() -> None:
    """A key outside the catalog raises InvalidKey instead of reaching the TV."""
    with pytest.raises(InvalidKey):
        resolve_key("SELF_DESTRUCT")


def test_key_short_forms_are_unique() -> None:
    """No two catalog entries share a short form, so lookup is unambiguous."""
    shorts = [descriptor.key for descriptor in KEYS]
    assert len(shorts) == len(set(shorts))


def test_apps_have_launch_targets() -> None:
    """Every app entry carries the string handed to ``send_launch_app_command``."""
    assert APPS
    for app in APPS:
        assert app.launch


def test_resolve_app_maps_slug_to_launch_target() -> None:
    """A catalog slug resolves to its launch target; anything else passes through."""
    assert resolve_app("netflix") == "com.netflix.ninja"
    assert resolve_app("com.example.unknown") == "com.example.unknown"
    assert resolve_app("https://example.com/x") == "https://example.com/x"
