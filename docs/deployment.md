<!--
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Operator deployment guide for the Android TV Remote appliance. Covers first run, exactly
where pairing data lives and how to back it up and restore it, how to turn on bearer-token
authentication, the host-versus-bridge networking tradeoff and what each costs, upgrade and
rollback, and the recovery procedure for a lost pairing. This is the document to follow
when deploying or operating the appliance; docker/README.md covers the image and compose
internals, and docs/design/architecture.md explains why the system is shaped this way.
-->

# Deployment

## What you are deploying

One container. It serves the web remote, the embed view, the REST API and the MCP endpoint
from a single uvicorn process on port **7433**.

| Surface | Path |
|---|---|
| Web remote | `/` |
| Embed remote | `/embed?device=<id>` |
| REST API + OpenAPI | `/api`, `/api/docs` |
| MCP (streamable HTTP) | `/mcp` |
| Health probe (never authenticated) | `/healthz` |

## Requirements

- Docker Engine with the Compose v2 plugin.
- **Linux**, for device discovery. `network_mode: host` is a Linux-only feature and mDNS
  is link-local multicast that cannot cross a Docker bridge. The appliance runs elsewhere,
  but discovery does not — see [Networking](#networking-host-vs-bridge).
- A writable directory for pairing data, by convention the NFS-backed
  `/volumes/androidtvremote`.
- The appliance and your TVs on the **same subnet**. mDNS does not route between VLANs.

## First run

```bash
git clone <this-repo> androidtvremote2
cd androidtvremote2

cp .env.example .env              # optional: every value has a working default

sudo mkdir -p /volumes/androidtvremote
sudo chown 1000:1000 /volumes/androidtvremote    # must match PUID/PGID in .env

scripts/dev-server.sh start
```

`start` builds the image, verifies the data directory is writable, brings the stack up and
polls `/healthz` until the appliance actually answers. It does not report success merely
because a container was created.

Open <http://localhost:7433/> (or `http://<host-ip>:7433/` from a phone). Pair a TV from
the UI: a code appears on the television, you type it into the remote.

Verify:

```bash
curl -fsS http://localhost:7433/healthz
scripts/dev-server.sh status
```

On Windows use `scripts\dev-server.ps1 start`; the command surface is identical.

## Where the data lives

Everything durable is under one directory — `DATA_DIR` inside the container,
`HOST_DATA_DIR` on the host, bind-mounted together by `docker-compose.yml`:

```
/volumes/androidtvremote/
  devices.db                    SQLite registry: devices, names, settings
  certs/
    aabbccddeeff/               one directory per device, named by its MAC address
      cert.pem                  this device's client certificate
      key.pem                   its private key
```

**That directory is the entire state of the appliance.** The image holds no pairing data,
and nothing is ever written to the container's writable layer. Delete the directory and
you have a factory-fresh appliance; copy it to another host and that host is paired with
all the same TVs.

Devices are keyed by **MAC address**, not IP, so a DHCP lease change does not orphan a
pairing — the appliance re-resolves the address and reconnects. Each device has its **own**
keypair, so pairing a second TV cannot invalidate the first.

If the appliance cannot write this directory it **refuses to start**, printing the uid it
needs and how to fix it. That is deliberate. The previous build wrote pairing certificates
into the container's writable layer whenever the volume was missing, which silently
destroyed every pairing on restart; a loud failure at boot is strictly better.

### Backup

Stop the stack (SQLite is being written live) and copy the directory:

```bash
scripts/dev-server.sh stop
sudo tar czf androidtvremote-$(date +%F).tar.gz -C /volumes androidtvremote
scripts/dev-server.sh start
```

A hot copy is usually fine too — the registry is written only when a device is registered
or renamed — but stopping first is the only way to guarantee a consistent `devices.db`.

Back this up like any other credential store: `certs/*/key.pem` are private keys that
grant control of your televisions.

### Restore

```bash
scripts/dev-server.sh stop
sudo rm -rf /volumes/androidtvremote
sudo tar xzf androidtvremote-2026-08-21.tar.gz -C /volumes
sudo chown -R 1000:1000 /volumes/androidtvremote
scripts/dev-server.sh start
```

Ownership matters: the container runs as a non-root uid and `tar` restores the *archived*
owner, which may not be the one you are running as.

## Authentication

Authentication is **off by default**. A fresh `docker compose up` has to produce a working
remote with zero configuration, because that is the real home-lab use case. Off means
anyone who can reach port 7433 can control every paired TV.

Turn it on if the appliance is reachable from anywhere beyond a trusted LAN:

```bash
openssl rand -hex 32                      # generate a token
```

Set it in `.env` (uncomment the line):

```
REMOTE_API_TOKEN=<the generated value>
```

then `scripts/dev-server.sh restart`.

Every `/api/*` and `/mcp` request must then carry it:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:7433/api/devices
curl "http://localhost:7433/api/devices?token=$TOKEN"
```

The query-parameter form exists because an `<iframe src>` and the browser `WebSocket`
constructor cannot set headers — it is what makes the embed view and the live state socket
work under auth. Treat a URL containing `?token=` as a secret: it lands in browser history
and in proxy logs.

`/healthz` and the SPA's static assets stay unauthenticated regardless.

While you are at it, tighten `FRAME_ANCESTORS` from `*` to your dashboard's origin (e.g.
`https://home.example.lan`) so only that page may iframe `/embed`.

For a Portainer deployment, set `REMOTE_API_TOKEN` in the **stack's** environment rather
than in a `.env` shipped from a workstation.

## Networking: host vs bridge

| | `docker-compose.yml` (host) | `docker-compose.dev.yml` (bridge) |
|---|---|---|
| Network mode | `network_mode: host` | bridge, published ports |
| mDNS discovery | **works** | impossible — `DISCOVERY_ENABLED=false` |
| Adding devices | discovered automatically, or by IP | by IP only |
| Port mapping | none; `PORT` is the host port | `PORT` published from the container |
| Platform | Linux only | anywhere Docker runs |
| Isolation | shares the host network namespace | isolated namespace |

Use the **host** stack in production. `_androidtvremote2._tcp.local.` discovery is
link-local multicast; on a bridge network the browser returns an empty list forever, which
is exactly what the old build did. Host mode is also why the production stack publishes no
ports: `PORT` alone decides where the appliance listens.

Use the **bridge** stack (`--dev`) on macOS or Windows, or anywhere you want the container
in its own network namespace. You give up discovery and add each TV by typing its IP.
Give those TVs DHCP reservations — the MAC stays the primary key either way, but a device
you have never reached cannot be registered.

If host mode is unavailable and you need discovery, run the appliance directly on the LAN
host instead of in a container, or on a VM with a bridged (not NAT) adapter.

## Upgrading

```bash
git pull
scripts/dev-server.sh start        # rebuilds the image and recreates the container
```

Pairing is untouched: it lives on the volume, not in the image. This is the property the
rebuild exists to guarantee, and `scripts/container-start.test.sh` asserts it on every CI
run.

To roll back, check out the previous tag or commit and run the same command. The on-disk
format has not changed, so an older image reads the same `devices.db` and certificates.

To run the prebuilt image instead of building locally, set `IMAGE_NAME` to
`ghcr.io/<owner>/<repo>` in `.env`, then `docker compose pull && docker compose up -d`.

## Deploying with Portainer

Use a **Docker Standalone** stack, not Swarm — Swarm does not support `network_mode: host`
the way this stack needs it.

**From git (recommended):** Stacks → Add stack → Repository; point it at this repository,
compose path `docker-compose.yml`, add `HOST_DATA_DIR` (and `REMOTE_API_TOKEN` if you want
auth) as stack environment variables, and enable GitOps updates to redeploy on push.

**From the API:** `scripts/deploy-portainer.sh` creates the stack on first run and updates
it thereafter. It needs `PORTAINER_URL` and `PORTAINER_TOKEN` exported in the environment,
and forwards only non-secret variables from `.env`.

Full details in [`docker/README.md`](../docker/README.md).

## Recovering a lost pairing

Work through this in order; the first three steps distinguish a genuinely lost pairing from
a misconfigured mount, which is far more common.

**1. Is the data actually on the host?**

```bash
scripts/dev-server.sh status                      # prints the resolved data directory
sudo ls -la /volumes/androidtvremote/certs/
```

Directories named after each TV's MAC should be there. If `certs/` is empty on the **host**
but the appliance had paired devices, the mount is wrong — the data was going into the
container. Check the `volumes:` entry in `docker-compose.yml` and `HOST_DATA_DIR` in
`.env`, fix it, and re-pair once. It will stick this time.

The usual cause of a genuinely emptied directory is `docker compose down -v` or a manual
delete. **Never run `down -v` on this stack**; `scripts/dev-server.sh stop` deliberately
omits `-v`.

**2. Did the container refuse to start?**

```bash
scripts/dev-server.sh logs
```

A `FATAL: ... is not writable` message means the entrypoint's write probe failed: the host
directory is owned by a different uid than the container runs as. `chown` it to your
`PUID:PGID`, or set `PUID`/`PGID` in `.env` to the owning uid. On NFS, check the export's
root-squash settings. No pairing was lost here — nothing was ever written.

**3. Is the TV simply unreachable?**

A device showing `connection: "unreachable"` is still paired; the television is off,
asleep or off the network. The appliance reconnects on its own when it returns. Nothing to
do.

**4. Was the pairing revoked on the TV?**

A device showing `connection: "unpaired"` means the television rejected the certificate —
it was factory-reset, or someone removed this client under Settings → Remotes & Accessories.
The certificate on disk is now worthless. Re-pair that device from the UI; a new keypair is
written and no other device is affected.

**5. Restore from backup.**

If the data is genuinely gone and you have a backup, follow [Restore](#restore) above.
Otherwise re-pair each TV from the UI — it takes about a minute per device, and with the
volume mounted correctly it is a one-time cost.

## Troubleshooting

**Port 7433 already in use.** Host networking does no port remapping. Change `PORT` in
`.env`, or stop whatever holds the port. The dev and prod stacks both bind `PORT` — do not
run them at the same time.

**Discovery finds nothing.** Either you are on a bridge network (expected; add TVs by IP)
or the TV is on a different subnet from the appliance. mDNS does not cross subnets.

**SPA 404s but `/api` works.** `web/dist` was not built into the image. Rebuild without
cache: `scripts/dev-server.sh build --no-cache`.

**Changes to `server/` are ignored.** The production image bakes code in; rebuild, or use
`scripts/dev-server.sh --dev start` for hot reload.

Deeper container and compose internals are in [`docker/README.md`](../docker/README.md);
the reasoning behind the design is in
[`docs/design/architecture.md`](design/architecture.md).
