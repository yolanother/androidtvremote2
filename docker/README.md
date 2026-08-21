<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Operator guide for running the Android TV Remote appliance in Docker. Covers the
single-container topology and why it is shaped that way, the production and development
compose stacks, the control scripts, the full environment-variable surface, deployment via
Portainer or a git-pull deployer, and — most importantly — the persistent-volume contract
that makes device pairing survive restarts and rebuilds. Read this before deploying or
changing anything under docker/.
-->

# Running the appliance in Docker

## Topology

**One image, one container, one port.** `uvicorn` serves the React SPA, the `/embed` view,
the REST API and the MCP endpoint from the same origin on port **7433**.

```
docker/Dockerfile
  stage `web`      node:22-alpine   -> npm ci && npm run build -> web/dist
  stage `runtime`  python:3.12-slim -> pip install ./server, copy src/androidtvremote2,
                                       copy web/dist, entrypoint.sh
```

The image mirrors the git repository's layout at `/app`, so `web/dist`,
`server/app/` and `src/androidtvremote2/` resolve to the same relative paths inside the
container as they do in a developer checkout. `PYTHONPATH=/app/server:/app/src` puts those
trees ahead of site-packages, which is what makes the dev stack's bind mounts hot-reload.

### Why one container

The previous build ran Flask and nginx as two containers. That bought nothing and cost a
CORS configuration, a cross-origin iframe, and a second image to rebuild. Same-origin
means the SPA, the embed view and the WebSocket just work.

### Why `network_mode: host`

mDNS/DNS-SD (`_androidtvremote2._tcp.local.`) is link-local multicast and **does not cross
a Docker bridge**. On a bridge network the discovery browser returns an empty list forever
— exactly what the old build did. Host networking is also why the stack publishes no
`ports:` mapping: `PORT` alone decides where the appliance listens.

Host mode is **Linux only**. On Docker Desktop (macOS/Windows) the container runs but
discovery cannot work: set `DISCOVERY_ENABLED=false` and add TVs by IP.

## The persistent volume — read this part

This is the single most important thing in this directory.

The old build wrote one shared `cert.pem`/`key.pem` pair into the process working
directory, and the `paired_tvs_data` volume its compose file declared **was never actually
mounted**. Pairing therefore lived in the container's writable layer and was destroyed by
every restart, rebuild and image upgrade.

The fix is the bind mount in `docker-compose.yml`:

```yaml
volumes:
  - ${HOST_DATA_DIR:-/volumes/androidtvremote}:/volumes/androidtvremote
```

Everything durable lives under that mount:

```
/volumes/androidtvremote/
  devices.db                    SQLite device registry
  certs/
    aabbccddeeff/               one directory per device, keyed by MAC
      cert.pem
      key.pem
```

Certificates are **per device** (sharing one keypair meant pairing a second TV
invalidated the first) and devices are keyed by **MAC address**, not IP, so a DHCP lease
change does not orphan a pairing.

Two guards enforce this rather than trusting it:

- `docker/entrypoint.sh` creates `$DATA_DIR/certs`, writes a probe file, and **refuses to
  start** with an explicit message if the directory is missing or not writable. A loud
  failure at boot beats a remote that silently forgets its TVs.
- `scripts/container-start.test.sh` writes pairing state, destroys and recreates the
  container, and asserts the state is still there. It runs in CI on every push.

`HOST_DATA_DIR` must exist and be writable by the container before you start. If it is an
NFS export, check its root-squash settings — a squashed export is the most likely reason
the entrypoint's write probe fails.

> **Never** run `docker compose down -v` on the production stack, and never remove the
> host data directory. That is the one action that still destroys every pairing. The
> control script's `stop` command deliberately omits `-v`.

### SQLite on NFS

`/volumes` is expected to be NFS-backed. SQLite's WAL journal mode requires shared-memory
mmap and does **not** work over NFS; the server opens the database with
`journal_mode=TRUNCATE` and `synchronous=FULL`. Do not "optimize" that back to WAL — it
will appear to work and then corrupt on a lock-contention event.

## Quick start

```bash
cp .env.example .env          # optional; every value has a working default
sudo mkdir -p /volumes/androidtvremote
scripts/dev-server.sh start
```

Then open <http://localhost:7433/>. API docs are at `/api/docs`.

`start` builds the image, creates and write-checks the data directory, brings the stack
up, and polls `/healthz` until the appliance actually answers — it does not report success
just because the container was created.

## Control scripts

Identical command surface on both platforms:

| | |
|---|---|
| Linux / macOS | `scripts/dev-server.sh [--dev\|--prod] <command>` |
| Windows | `scripts\dev-server.ps1 [-Dev\|-Prod] <command>` |

| Command | Effect |
|---|---|
| `start` | Build if needed, start the stack, wait for `/healthz` |
| `stop` | Stop and remove containers. **Keeps the data volume.** |
| `restart` | `stop` then `start` |
| `status` | Container state, health, and the resolved data directory |
| `logs [service]` | Follow logs, optionally for one service |
| `build` | Build or rebuild the image |
| `config` | Print the fully resolved compose configuration |

```bash
scripts/dev-server.sh start           # production stack
scripts/dev-server.sh --dev start     # hot-reloading dev stack
scripts/dev-server.sh --dev logs web  # just the Vite dev server
scripts/dev-server.sh status
```

## Development stack

`docker-compose.dev.yml` runs two containers on the host network:

- **`api`** — the same image, `uvicorn --reload`, with `./server` and `./src` bind-mounted.
  Python edits reload in place.
- **`web`** — `node:22-alpine` running the Vite dev server on `WEB_DEV_PORT` (7434) with
  `./web` bind-mounted. `node_modules` is a named volume so the container's Linux modules
  never shadow the host tree. Vite proxies `/api`, `/healthz` and the WebSocket upgrade to
  the API container, so the SPA is same-origin in development exactly as in production.

Dev pairing state goes to `./data` (git-ignored), so no NFS mount is needed locally. It is
still a real volume — dev pairings survive restarts too.

```bash
scripts/dev-server.sh --dev start
# API + built SPA : http://localhost:7433/
# Vite dev UI     : http://localhost:7434/
```

Vite listens with `--host`, so the dev UI is reachable from a phone on the same LAN — the
only way to test the touch surfaces properly.

## Configuration

Every knob is an environment variable; there is no config file. Copy `.env.example` to
`.env` and edit. Application variables match the table in
[`docs/design/architecture.md`](../docs/design/architecture.md).

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `/volumes/androidtvremote` | Container-side SQLite + cert root |
| `PORT` | `7433` | HTTP listen port (also the host port, under host networking) |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `REMOTE_API_TOKEN` | *(unset)* | If set, `/api` + `/mcp` require this bearer token |
| `CLIENT_NAME` | `Android TV Remote` | Name shown on the TV during pairing |
| `DISCOVERY_ENABLED` | `true` | Run the mDNS browser |
| `DISCOVERY_INTERVAL` | `60` | Seconds between full rescans |
| `FRAME_ANCESTORS` | `*` | CSP `frame-ancestors` for `/embed` |
| `LOG_LEVEL` | `info` | Uvicorn/app log level |
| `CORS_ORIGINS` | `*` | Allowed origins for `/api` |

Compose-only variables (not read by the server):

| Variable | Default | Purpose |
|---|---|---|
| `HOST_DATA_DIR` | `/volumes/androidtvremote` | **Host** path bind-mounted onto `DATA_DIR` |
| `IMAGE_NAME` / `IMAGE_TAG` | `androidtv-remote` / `latest` | Image built and run |
| `WEB_DEV_PORT` | `7434` | Vite dev server port (dev stack only) |

### Security notes

Authentication is **off by default**, because a fresh `docker compose up` has to produce a
working remote with zero configuration — that is the actual home-lab use case. The
appliance is designed for a trusted LAN.

If it is reachable beyond one, set both:

- `REMOTE_API_TOKEN` — required on every `/api` and `/mcp` request, as
  `Authorization: Bearer <token>` or `?token=<token>`. The query-param form exists because
  an `<iframe src>` and the browser `WebSocket` constructor cannot set headers.
  `/healthz` and static assets stay unauthenticated.
- `FRAME_ANCESTORS` — restrict from `*` to your dashboard's origin.

The container runs as **root**. This is deliberate: `DATA_DIR` is typically an NFS export
whose squash and ownership settings are not known at build time, and pinning an arbitrary
UID is the classic way to make the volume unwritable — which is the exact failure this
rebuild exists to eliminate. With `network_mode: host` the container already shares the
host's network namespace, so a non-root UID would not buy meaningful isolation here. If
your threat model needs it, add `user: "${PUID}:${PGID}"` to the compose service and
`chown` the host data directory to match.

Secrets never belong in `.env` for a Portainer deployment — set `REMOTE_API_TOKEN` in the
Portainer stack's own environment instead.

## Deployment

### Portainer — from git (recommended)

Portainer pulls this repository and deploys `docker-compose.yml` directly.

1. **Stacks → Add stack → Repository**.
2. Repository URL: this repo. Reference: `refs/heads/main`.
3. Compose path: `docker-compose.yml`.
4. Add environment variables (at minimum `HOST_DATA_DIR`; add `REMOTE_API_TOKEN` here if
   you want auth).
5. Enable **GitOps updates** (polling or webhook) to redeploy on push.

Use a **Docker Standalone** stack, not Swarm: Swarm does not support `network_mode: host`
as this stack needs it.

### Portainer — from the API

`scripts/deploy-portainer.sh` creates the stack on first run and updates it afterwards:

```bash
export PORTAINER_URL=https://portainer.example.lan
export PORTAINER_TOKEN=ptr_...     # My account -> Access tokens
export PORTAINER_ENDPOINT=1
scripts/deploy-portainer.sh
```

It forwards only the non-secret deployment variables from `.env`; `REMOTE_API_TOKEN` is
deliberately excluded so it is not shipped from a workstation. Requires `jq` and `curl`.

### Plain compose on the host

```bash
git pull
scripts/dev-server.sh start        # rebuilds and restarts; pairing is untouched
```

### Prebuilt image

CI publishes `ghcr.io/<owner>/<repo>:latest` on every push to `main`. To run that instead
of building, set `IMAGE_NAME=ghcr.io/<owner>/<repo>` in `.env` and use
`docker compose pull && docker compose up -d`.

## Verifying pairing durability

The claim that pairing survives restarts is tested, not asserted:

```bash
scripts/container-start.test.sh
```

It builds the image, starts the stack against a temporary data directory, writes a cert
and a `devices.db` into `DATA_DIR`, runs `docker compose down`, brings the stack back up,
and fails unless both files are still present. CI runs it on every push and pull request.

## CI

`.github/workflows/docker-ci.yml`:

1. `shellcheck` over every shell script here.
2. `docker compose config` over both compose files.
3. Builds the image with a GitHub Actions build cache.
4. Runs `scripts/container-start.test.sh` — the durability gate.
5. On pushes to `main`, publishes to GHCR.

## Troubleshooting

**`FATAL: cannot create /volumes/androidtvremote/certs` or `... is not writable`**
The entrypoint's write probe failed. The host directory does not exist, or the container
cannot write to it. Create it and fix ownership; on NFS check root-squash. The container
refuses to start rather than write pairing data somewhere ephemeral.

**Discovery finds nothing**
Either you are not on Linux (host networking is unavailable, so multicast cannot reach the
container — set `DISCOVERY_ENABLED=false` and add TVs by IP), or the TV is on a different
VLAN/subnet from the host. mDNS does not route between subnets.

**Port 7433 already in use**
With host networking there is no port remapping. Change `PORT` in `.env`, or stop whatever
holds the port. Note the dev and prod stacks both bind `PORT` — do not run them together.

**Pairing was lost anyway**
Check `scripts/dev-server.sh status` for the resolved data directory, then confirm
`certs/<device_id>/cert.pem` exists on the **host** at that path. If `certs/` is empty on
the host but the container had paired devices, the mount is wrong. Someone almost
certainly ran `docker compose down -v` or edited the `volumes:` entry.

**SPA returns 404 but `/api` works**
`web/dist` was not built into the image. Rebuild without cache:
`scripts/dev-server.sh build --no-cache`.

**Changes to `server/` are not picked up**
The production image bakes the code in; rebuild. Use `--dev` for hot reload.
