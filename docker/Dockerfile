# syntax=docker/dockerfile:1

# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Multi-stage build for the Android TV Remote appliance: a SINGLE image that serves the
# React SPA, the REST API, the /embed view and the MCP endpoint from one uvicorn process
# on one port. Stage `web` compiles the Vite + React + Tailwind bundle to web/dist; stage
# `runtime` installs the FastAPI server's dependencies in a separately cached layer, lays
# the server package, the vendored androidtvremote2 protocol library and the built SPA out
# at /app in exactly the same relative shape as the git repository, drops to a non-root
# user, and hands off to docker/entrypoint.sh. No pairing state is ever baked in:
# certificates and the SQLite registry live only on the mounted DATA_DIR volume.

# ---------------------------------------------------------------------------
# Stage 1 — build the single-page app
# ---------------------------------------------------------------------------
FROM node:22-alpine AS web

WORKDIR /build/web

# Dependency manifests first so `npm ci` caches independently of source edits.
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY web/ ./
# `npm run build` is `tsc -b && vite build`; output lands in /build/web/dist.
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # /app/server and /app/src precede site-packages, so a bind-mounted source tree
    # (docker-compose.dev.yml) shadows the copies installed at build time.
    PYTHONPATH=/app/server:/app/src

# curl is needed by the container HEALTHCHECK below and by scripts/container-start.test.sh.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root runtime account. UID/GID 1000 is the common default for a single-user Linux
# host, which keeps a bind-mounted DATA_DIR writable without extra setup; compose exposes
# `user: ${PUID}:${PGID}` for hosts (and NFS exports) that need a different owner.
RUN groupadd --gid 1000 app \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app

# --- dependency layer ---------------------------------------------------------------
# Install from server/pyproject.toml alone, against a stub package, so this expensive
# layer is invalidated only by a dependency change and not by every source edit. The stub
# is overwritten by the real source copy below.
COPY server/pyproject.toml server/pyproject.toml
RUN mkdir -p server/app && touch server/app/__init__.py
RUN --mount=type=cache,target=/root/.cache/pip pip install --no-cache-dir ./server

# --- source layers ------------------------------------------------------------------
COPY server/ server/

# Vendored Android TV Remote protocol v2 library — imported, never modified.
COPY src/androidtvremote2/ src/androidtvremote2/

# Built SPA. `web/dist` relative to /app mirrors the repo layout, so the same path
# resolves whether the server runs in this image or from a developer checkout.
COPY --from=web /build/web/dist/ web/dist/

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Defaults mirror docs/design/architecture.md. Every one is overridable from compose/.env.
ENV DATA_DIR=/volumes/androidtvremote \
    PORT=7433 \
    HOST=0.0.0.0 \
    CLIENT_NAME="Android TV Remote" \
    DISCOVERY_ENABLED=true \
    DISCOVERY_INTERVAL=60 \
    FRAME_ANCESTORS=* \
    LOG_LEVEL=info \
    CORS_ORIGINS=*

# Created so the image is runnable without a mount for smoke tests. In any real deployment
# this path is a mount point; the entrypoint's write probe is what proves it.
RUN mkdir -p /volumes/androidtvremote/certs && chown -R app:app /volumes/androidtvremote

USER app

# Declared for documentation and for the bridge-network dev stack; with `network_mode:
# host` (the supported production deployment) EXPOSE has no effect and PORT alone decides
# the listen port.
EXPOSE 7433

# The appliance is only healthy once uvicorn answers; /healthz is always unauthenticated.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

# No CMD: with no arguments the entrypoint builds the uvicorn command line from HOST,
# PORT and LOG_LEVEL, so changing PORT in .env is sufficient. Passing arguments (as
# docker-compose.dev.yml does to add --reload) overrides that default entirely.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
