# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Single import seam between the appliance server and the vendored androidtvremote2
# protocol library. Adds the repository's src/ directory to sys.path when the library is
# not already installed as a distribution, then re-exports AndroidTVRemote and the three
# protocol exceptions so that no other module in the server needs to know where the
# library physically lives. The path is appended rather than prepended on purpose: the
# legacy src/app.py would otherwise shadow this server's own `app` package.
"""Single import seam between the appliance server and the vendored protocol library."""

from __future__ import annotations

import sys
from pathlib import Path

_SRC_DIR = Path(__file__).resolve().parents[2] / "src"
if _SRC_DIR.is_dir() and str(_SRC_DIR) not in sys.path:
    sys.path.append(str(_SRC_DIR))

from androidtvremote2 import (  # noqa: E402
    AndroidTVRemote,
    CannotConnect,
    ConnectionClosed,
    InvalidAuth,
)

__all__ = ["AndroidTVRemote", "CannotConnect", "ConnectionClosed", "InvalidAuth"]
