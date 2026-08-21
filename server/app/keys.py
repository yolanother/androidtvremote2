# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Key catalog for the Android TV Remote appliance. Defines the curated set of sendable
# keys served by GET /api/keys, each carrying its short form, its full Android keycode, a
# display label, and the UI category it groups under. Also provides the resolver that
# turns a user-supplied key name in either form into a validated KEYCODE_* string, so an
# unknown key is rejected at the edge with InvalidKey instead of being forwarded to the TV.
"""Key catalog for the Android TV Remote appliance."""

from __future__ import annotations

from .errors import InvalidKey
from .models import KeyCategory, KeyDescriptor


def _key(short: str, label: str, category: KeyCategory) -> KeyDescriptor:
    """Build a key descriptor from its short form.

    :param short: Short key name, e.g. ``DPAD_UP``.
    :param label: Human-readable label for the UI.
    :param category: Grouping the UI lays the key out under.
    :returns: The descriptor with its full ``KEYCODE_`` form filled in.
    """
    return KeyDescriptor(key=short, keycode=f"KEYCODE_{short}", label=label, category=category)


#: Every key the appliance will send, in the order the catalog endpoint returns them.
KEYS: tuple[KeyDescriptor, ...] = (
    # navigation
    _key("DPAD_UP", "Up", "navigation"),
    _key("DPAD_DOWN", "Down", "navigation"),
    _key("DPAD_LEFT", "Left", "navigation"),
    _key("DPAD_RIGHT", "Right", "navigation"),
    _key("DPAD_CENTER", "Select", "navigation"),
    _key("BACK", "Back", "navigation"),
    _key("HOME", "Home", "navigation"),
    _key("MENU", "Menu", "navigation"),
    # transport
    _key("MEDIA_PLAY_PAUSE", "Play/Pause", "transport"),
    _key("MEDIA_PLAY", "Play", "transport"),
    _key("MEDIA_PAUSE", "Pause", "transport"),
    _key("MEDIA_STOP", "Stop", "transport"),
    _key("MEDIA_NEXT", "Next", "transport"),
    _key("MEDIA_PREVIOUS", "Previous", "transport"),
    _key("MEDIA_REWIND", "Rewind", "transport"),
    _key("MEDIA_FAST_FORWARD", "Fast forward", "transport"),
    _key("MEDIA_SKIP_BACKWARD", "Skip back", "transport"),
    _key("MEDIA_SKIP_FORWARD", "Skip forward", "transport"),
    _key("MEDIA_RECORD", "Record", "transport"),
    # volume
    _key("VOLUME_UP", "Volume up", "volume"),
    _key("VOLUME_DOWN", "Volume down", "volume"),
    _key("VOLUME_MUTE", "Mute", "volume"),
    _key("MUTE", "Mute microphone", "volume"),
    # power
    _key("POWER", "Power", "power"),
    _key("TV_POWER", "TV power", "power"),
    _key("SLEEP", "Sleep", "power"),
    _key("WAKEUP", "Wake", "power"),
    # channel
    _key("CHANNEL_UP", "Channel up", "channel"),
    _key("CHANNEL_DOWN", "Channel down", "channel"),
    _key("LAST_CHANNEL", "Last channel", "channel"),
    _key("GUIDE", "Guide", "channel"),
    # input
    _key("TV_INPUT", "Input", "input"),
    _key("TV_INPUT_HDMI_1", "HDMI 1", "input"),
    _key("TV_INPUT_HDMI_2", "HDMI 2", "input"),
    _key("TV_INPUT_HDMI_3", "HDMI 3", "input"),
    _key("TV_INPUT_HDMI_4", "HDMI 4", "input"),
    # numeric
    _key("0", "0", "numeric"),
    _key("1", "1", "numeric"),
    _key("2", "2", "numeric"),
    _key("3", "3", "numeric"),
    _key("4", "4", "numeric"),
    _key("5", "5", "numeric"),
    _key("6", "6", "numeric"),
    _key("7", "7", "numeric"),
    _key("8", "8", "numeric"),
    _key("9", "9", "numeric"),
    # system
    _key("SEARCH", "Search", "system"),
    _key("ASSIST", "Assistant", "system"),
    _key("SETTINGS", "Settings", "system"),
    _key("INFO", "Info", "system"),
    _key("CAPTIONS", "Captions", "system"),
    _key("NOTIFICATION", "Notifications", "system"),
    _key("ENTER", "Enter", "system"),
    _key("DEL", "Delete", "system"),
)

_KEYS_BY_SHORT: dict[str, KeyDescriptor] = {descriptor.key: descriptor for descriptor in KEYS}


def resolve_key(key: str) -> str:
    """Validate a requested key and return its full Android keycode.

    Accepts the catalog short form (``DPAD_UP``), the full keycode
    (``KEYCODE_DPAD_UP``), and either in any case.

    :param key: Key name supplied by an API client.
    :returns: The full ``KEYCODE_*`` string accepted by the protocol library.
    :raises InvalidKey: If the key is not in the catalog.
    """
    candidate = key.strip().upper()
    candidate = candidate.removeprefix("KEYCODE_")
    descriptor = _KEYS_BY_SHORT.get(candidate)
    if descriptor is None:
        raise InvalidKey(f"Unknown key {key!r}")
    return descriptor.keycode


def keys_in_category(category: str | None = None) -> list[KeyDescriptor]:
    """Return the key catalog, optionally narrowed to one category.

    :param category: Category to filter by, or ``None`` for the whole catalog.
    :returns: The matching key descriptors in catalog order.
    """
    if category is None:
        return list(KEYS)
    wanted = category.strip().lower()
    return [descriptor for descriptor in KEYS if descriptor.category == wanted]
