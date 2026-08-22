---
name: build
description: "Build, test, run, and verify the Android TV Remote appliance — server, web SPA, embed view, Docker image, and the Tauri desktop tray app. Use for any build/test/run/verify request: 'build it', 'run the tests', 'does it compile', 'start the appliance', 'build the Windows tray app', 'build the container', 'is it working', or before opening a PR or merging."
visibility: public
allowed-tools: Bash, Read, Grep, Glob
argument-hint: "[check|build|container|tray|run|verify] "
---

# Building the Android TV Remote appliance

Four buildable components in one repo. Know which one you are touching before you run
anything.

| Path | What it is | Toolchain |
|---|---|---|
| `server/` | FastAPI appliance + MCP server | Python 3.11+ |
| `web/` | React SPA **and** the `/embed` iframe remote (two Vite entries) | Node 22+ |
| `tray/` | Tauri v2 desktop tray remote | Node 22+ **and** Rust 1.77.2+ |
| `docker/` | Single appliance image serving all of the above | Docker |
| `src/androidtvremote2/` | Vendored protocol library — **DO NOT MODIFY** | — |

## The one command that matters

```sh
./scripts/dev-build.sh check
```

Static gates: `tsc -b` in `web/` and `tray/`, `compileall server/app`, the full server test
suite, and `docker compose config` on both compose files. Exits non-zero on first failure.
**Run this before every commit and every merge.**

| Subcommand | Does |
|---|---|
| `check` | All static gates above |
| `build` | `npm run build` in `web/` → `web/dist` (both the SPA and embed entries) |
| `container` | `docker compose build` |
| `tray` | Tauri frontend build + `cargo check`. Host platform only. |
| `all` | check → build → container. **Excludes `tray`** (needs Rust, which CI and the image lack). |

### First-time Python setup

The test gate needs a virtualenv or it skips the entire suite and still reports OK:

```sh
python3 -m venv .venv
.venv/bin/pip install -e "server[dev]"
```

`dev-build.sh` prefers `.venv/bin/python` (or `.venv/Scripts/python.exe`) automatically.
If `check` prints `(skipped: pytest not installed ...)`, the gate verified nothing — fix it
before trusting a green run.

## Per-component commands
### On Windows

`dev-build.sh` is bash — run it from Git Bash or WSL. PowerShell users should use the
per-component commands below instead; they are plain `npm` and `cargo` and need no shell
shim. `scripts/dev-server.ps1` covers starting and stopping the dev services.

Nothing about the tray build requires bash: `cd tray; npm ci; npm run tauri build` is the
whole flow.


### Server

```sh
cd server && ../.venv/bin/python -m pytest tests -q          # 161 tests, ~10s
../.venv/bin/python -c "from app.main import create_app; create_app()"
../.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 7433
```

`DATA_DIR` (default `/volumes/androidtvremote`) must exist and be writable, or the app
refuses to start. Point it at a temp dir for local runs.

### Web

```sh
cd web
npm ci
npm run build      # tsc -b && vite build -> dist/index.html + dist/embed.html
npm run dev        # port 7434, proxies /api and /healthz to 127.0.0.1:7433
npx oxlint
```

`web/src/lib/api-types.ts` is the **frozen** contract mirror. Import it; do not edit it
without updating `docs/design/api-contract.md` and every consumer.

### Container

```sh
docker compose build
docker compose up -d
docker compose logs -f androidtv-remote
docker compose down
```

Production compose uses `network_mode: host` — required, because mDNS is link-local
multicast and cannot cross a Docker bridge. Do not "clean it up" to a bridge with a `ports:`
mapping; discovery will return an empty list forever with no error. Use
`docker-compose.dev.yml` (bridge, `DISCOVERY_ENABLED=false`) only where host mode is
unavailable.

### Tray (Tauri) — read the cross-compilation rule

```sh
./scripts/dev-build.sh tray          # compile check, any platform
cd tray && npx tauri dev             # live development
cd tray && npx tauri build           # installer for THIS platform only
```

**Tauri cannot cross-compile.** A Windows installer must be built on Windows, a macOS
bundle on macOS. Building on Linux produces `.deb`/`.AppImage` and proves the project
compiles — it does **not** produce or validate a Windows or macOS artifact. Never report a
Windows build as done from another OS.

Prerequisites: Node 20+, Rust 1.77.2+, plus per platform —

- **Windows**: Microsoft C++ Build Tools with the "Desktop development with C++" workload;
  WebView2 (preinstalled on Windows 11).
- **macOS**: `xcode-select --install`.
- **Linux**: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

Artifacts land in `tray/src-tauri/target/release/bundle/` — `nsis/*-setup.exe` and
`msi/*.msi` on Windows, `dmg/*.dmg` on macOS.

Builds are **unsigned**: SmartScreen and Gatekeeper will warn. `tray/README.md` documents
how users get past that.

For real Windows/macOS installers without those machines, run
`.github/workflows/tray-build.yml` via `workflow_dispatch` or a `tray-v*` tag.

## Verifying it actually works

Compiling is not working. Before claiming a change works:

```sh
curl -fsS http://localhost:7433/healthz
curl -fsS http://localhost:7433/api/discovery      # should list TVs on the LAN
curl -fsS "http://localhost:7433/embed?device=x" | grep -o '<title>[^<]*'   # expect "Remote"
curl -fsS http://localhost:7433/ | grep -o '<title>[^<]*'                   # expect "Android TV Remote"
```

`/embed` must serve `embed.html`, **not** `index.html`. It is a separate Vite entry, and a
regression there silently serves the entire SPA inside a 240px panel iframe.

For UI changes, drive the real page with the Playwright or chrome-devtools MCP tools at a
390px mobile viewport and a desktop one. For `/embed`, load it inside a real `<iframe>` at
240×320 — testing the route in a full window does not exercise what the deliverable is for.

## Gotchas that have already cost time

- **File headers are enforced by a pre-commit hook.** Python needs a leading `#` comment
  block with the copyright and purpose; a module docstring alone is REJECTED. TypeScript
  and CSS use `/** */`; Markdown uses `<!-- -->`. See `docs/design/conventions.md`.
- **Never `git add -A`.** Orch syncs `.claude/settings.json`, `.orchestrator/hooks.json` and
  friends into the working tree; sweeping them into a commit has already regressed live
  config once. Stage explicit paths.
- **SQLite lives on NFS.** `journal_mode=TRUNCATE`, `synchronous=FULL`. WAL does not work
  over NFS — it will appear to work and then corrupt.
- **Port 7433** is the only port the appliance uses. If a host firewall is active with a
  DROP policy, the appliance answers locally and is invisible to the LAN, which reads as a
  broken container. See `docs/deployment.md`.
- `docker compose config` needs a `.env`; `dev-build.sh` creates and removes a temporary one.

## Where the docs are

| Question | File |
|---|---|
| How is this put together, and why? | `docs/design/architecture.md` |
| What is the exact API/WS/MCP contract? | `docs/design/api-contract.md` |
| Header format, file ownership, gates | `docs/design/conventions.md` |
| Deploying, data, firewall, recovery | `docs/deployment.md` |
| Embedding in a home panel | `docs/embedding.md` |
| Wiring the MCP server to an agent | `docs/mcp.md` |
| Tray app specifics and signing | `tray/README.md` |
