# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Optional network provider support for Android TV Remote. Exposes the registry that
# discovers versioned data providers, associates them with paired televisions and
# keeps their catalogs and observed playback separate from core remote/Cast state.
"""Optional, data-only launcher integrations."""

from .registry import ProviderRegistry

__all__ = ["ProviderRegistry"]
