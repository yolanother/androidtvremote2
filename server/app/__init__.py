# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Application package for the Android TV Remote appliance server. Holds the FastAPI
# application factory, the DeviceManager that owns every TV connection, the SQLite-backed
# device registry, the mDNS discovery browser, the REST routers, the WebSocket event
# stream, and the MCP server. All of it is built against the frozen interface described
# in docs/design/api-contract.md.
"""Application package for the Android TV Remote appliance server."""

__version__ = "1.0.0"
