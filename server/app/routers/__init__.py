# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# HTTP router package for the Android TV Remote appliance. Groups the REST surface into
# the device registry and pairing routes, the control routes, the discovery routes, the
# static key and app catalog routes, and the WebSocket event stream, each mounted under
# /api by the application factory. Every route in here is a direct implementation of an
# entry in docs/design/api-contract.md.
"""HTTP router package for the Android TV Remote appliance."""
