# Stream: Containerization

**Worktree:** `.claude/worktrees/container` — branch `stream-container`. Work ONLY in there.

## Goal
One container that serves the SPA, the REST API, the embed view, and the MCP server on port
7433, with pairing data on the NFS-backed volume so it survives every rebuild.

## Read first
- `docs/design/architecture.md` — single-container / host-network topology, the data layout,
  and the full environment-variable table. Implement that table exactly.
- `docs/design/conventions.md` — header format per language
- `server/pyproject.toml` — the Python dependency set
- `web/package.json` — the web build (`npm run build` -> `web/dist`)
- The existing `docker/`, `docker-compose.yml`, `start.sh`, `start.bat` — all being replaced.

## Use the orch feature package
The operator explicitly asked for this: install and follow the **`containerized-web-service`**
feature package (`orch features show containerized-web-service`, or the
`/orch-feature-install` skill). Take its compose/env/CI/Portainer patterns and adapt them —
it targets a pure-React project, and this is a single Python image that *also* builds a
React bundle, so the Dockerfile shape differs. Record any adaptation you had to make as a
feature learning with `/orch-add-feature-learning`.

## Files to touch
- `docker/Dockerfile` — multi-stage: node builds `web/dist`, python runtime serves everything
- `docker/entrypoint.sh`
- `docker-compose.yml`, `docker-compose.dev.yml`
- `.dockerignore`
- `.env.example`
- `scripts/dev-build.sh` — `check` / `build` / `container` subcommands (other streams and the
  repo conventions reference this script; it does not exist yet)
- `.github/workflows/docker-ci.yml`
- `docs/deployment.md`
- Delete `docker/frontend.Dockerfile`, `docker/backend.Dockerfile`, `docker/nginx.conf`,
  `start.sh`, `start.bat`

## Requirements
- **Multi-stage build.** Stage 1: `node:22-alpine`, `npm ci` + `npm run build` in `web/`.
  Stage 2: `python:3.12-slim`, install `server/` deps, copy in `server/`,
  `src/androidtvremote2/`, and `web/dist` from stage 1. Run uvicorn. Non-root user.
  Layer-cache the dependency installs ahead of the source copies.
- **`network_mode: host`** in compose, with a comment explaining that mDNS is link-local
  multicast and cannot cross a Docker bridge — this is not optional decoration, it is why
  discovery works at all. Provide `docker-compose.dev.yml` as a bridge-network variant with
  `DISCOVERY_ENABLED=false` for machines where host mode is unavailable.
- **Volume: `/volumes/androidtvremote:/volumes/androidtvremote`**, matching the operator's
  existing `/volumes` NFS convention. `DATA_DIR` defaults there. This mount is the fix for
  pairing being lost on every rebuild — say so in a comment.
- The entrypoint must create `DATA_DIR` and `DATA_DIR/certs` and fail loudly with a clear
  message if they are not writable. A silent permission failure here reproduces the exact
  bug we are fixing.
- Every variable from the architecture doc's config table appears in `.env.example` with its
  default and a one-line explanation. `REMOTE_API_TOKEN` commented out, with a note that
  leaving it unset means no auth.
- `HEALTHCHECK` hitting `/healthz`.
- `scripts/dev-build.sh`:
  - `check` — `tsc -b` in `web/` plus `python -m compileall server/app` (and pytest if present)
  - `build` — full web build
  - `container` — `docker compose build`
  - Must exit non-zero on failure. Other streams' acceptance criteria call this script.
- `docs/deployment.md`: first run, where data lives, how to back it up, how to enable the
  token, the host-vs-bridge networking tradeoff, and how to recover if pairing is lost.

## Acceptance criteria
- [ ] `docker compose build` succeeds.
- [ ] `./scripts/dev-build.sh check` and `./scripts/dev-build.sh container` both exit 0.
- [ ] The image starts and `curl -fsS http://localhost:7433/healthz` returns 200.
      The backend is landing in parallel; if `server/app/main.py` is not on your branch yet,
      verify against a minimal throwaway ASGI app and say so in your report — do NOT commit
      a stub `main.py`, that file belongs to the backend stream.
- [ ] Restarting the container with a populated `/volumes/androidtvremote` preserves its
      contents. Demonstrate this — it is the headline fix.
- [ ] No secrets committed. `.env` is gitignored; only `.env.example` is tracked.
- [ ] Headers per conventions.md on the shell scripts and compose files.

## Out of scope
Anything under `server/app/`, `web/src/`, or `tray/`.
