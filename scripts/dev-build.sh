#!/usr/bin/env bash
# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Verification gate script for the Android TV Remote appliance, referenced by every
# workstream's acceptance criteria. `check` runs the fast static gates (TypeScript project
# build in web/ and tray/, byte-compilation of server/app, the server test suite when
# present, and compose-file validation); `build` produces the real SPA bundle in web/dist;
# `container` builds the appliance image via docker compose; `tray` builds the Tauri
# desktop app for the HOST platform only (Tauri cannot cross-compile). Each subcommand exits non-zero on the
# first failure so it can be used directly as a CI or pre-merge gate. Run with no
# arguments to execute check, build and container in that order.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

usage() {
    cat <<'USAGE'
Usage: scripts/dev-build.sh [check|build|container|tray|all]

  check      Static gates: web + tray `tsc -b`, `compileall server/app`, the server
             test suite, and `docker compose config` on both compose files.
  build      Full web build (`npm run build` in web/) -> web/dist
  container  `docker compose build` (the appliance image)
  tray       Tauri desktop app: frontend build + `cargo check`. HOST PLATFORM ONLY --
             run it on Windows for a Windows build, on macOS for a macOS build.
  all        check, then build, then container (default when no argument is given).
             `tray` is NOT included: it needs a Rust toolchain that CI and the
             appliance image do not have.

Exits non-zero on the first failure.
USAGE
}

step() { echo; echo "==> $*"; }

# Prefer the repo virtualenv. Without this the test gate falls back to a system python
# that has no pytest, silently SKIPS the whole server suite, and still reports OK -- a
# green gate that verified nothing.
resolve_python() {
    if [[ -x .venv/bin/python ]]; then echo .venv/bin/python
    elif [[ -x .venv/Scripts/python.exe ]]; then echo .venv/Scripts/python.exe
    else echo python3
    fi
}
PYTHON="$(resolve_python)"
skip() { echo "    (skipped: $*)"; }

# npm ci when the lockfile is newer than node_modules, npm install otherwise. Keeps
# repeated local runs fast without ever using a stale dependency tree in CI.
ensure_node_deps() {
    local dir="$1"
    if [[ ! -d "$dir/node_modules" ]]; then
        step "Installing $dir dependencies (npm ci)"
        (cd "$dir" && npm ci)
    elif [[ "$dir/package-lock.json" -nt "$dir/node_modules" ]]; then
        step "Lockfile changed; reinstalling $dir dependencies (npm ci)"
        (cd "$dir" && npm ci)
    fi
}

ensure_web_deps() {
    if [[ ! -d web/node_modules ]]; then
        step "Installing web dependencies (npm ci)"
        (cd web && npm ci)
    elif [[ web/package-lock.json -nt web/node_modules ]]; then
        step "Lockfile changed; reinstalling web dependencies (npm ci)"
        (cd web && npm ci)
    fi
}

run_check() {
    step "check: TypeScript project build (web/)"
    if [[ -f web/package.json ]]; then
        ensure_web_deps
        (cd web && npx tsc -b)
        echo "    tsc -b OK"
    else
        skip "web/package.json not present"
    fi

    step "check: TypeScript project build (tray/)"
    if [[ -f tray/package.json ]]; then
        ensure_node_deps tray
        (cd tray && npx tsc -b)
        echo "    tsc -b OK"
    else
        skip "tray/package.json not present"
    fi

    step "check: byte-compiling server/app"
    if [[ -d server/app ]]; then
        "$PYTHON" -m compileall -q server/app
        echo "    compileall OK"
    else
        skip "server/app not present"
    fi

    step "check: server test suite"
    # The backend and MCP streams own server/tests; it may not exist on every branch.
    if [[ -d server/tests ]] && "$PYTHON" -c 'import pytest' >/dev/null 2>&1; then
        (cd server && "../$PYTHON" -m pytest tests -q)
    elif [[ -d server/tests ]]; then
        skip "pytest not installed (create the venv: python3 -m venv .venv && .venv/bin/pip install -e 'server[dev]')"
    else
        skip "server/tests not present on this branch"
    fi

    step "check: compose file validation"
    # `docker compose config` resolves interpolation, so it needs a .env to exist.
    local created_env=0
    if [[ ! -f .env ]]; then
        cp .env.example .env
        created_env=1
    fi
    docker compose -f docker-compose.yml config >/dev/null
    docker compose -f docker-compose.dev.yml config >/dev/null
    [[ "$created_env" -eq 1 ]] && rm -f .env
    echo "    both compose files valid"
}

run_build() {
    step "build: web bundle (npm run build -> web/dist)"
    if [[ ! -f web/package.json ]]; then
        skip "web/package.json not present"
        return 0
    fi
    ensure_web_deps
    (cd web && npm run build)
    [[ -f web/dist/index.html ]] || { echo "ERROR: web/dist/index.html missing after build" >&2; exit 1; }
    echo "    web/dist/index.html present"
}

run_container() {
    step "container: docker compose build"
    docker compose -f docker-compose.yml build
    echo "    image built"
}

run_tray() {
    step "tray: frontend build"
    if [[ ! -f tray/package.json ]]; then
        skip "tray/package.json not present"
        return 0
    fi
    ensure_node_deps tray
    (cd tray && npm run build)

    step "tray: cargo check"
    if ! command -v cargo >/dev/null 2>&1; then
        echo "ERROR: cargo not found. Install Rust from https://rustup.rs to build the tray app." >&2
        exit 1
    fi
    (cd tray/src-tauri && cargo check)

    # Deliberately NOT running `npx tauri build` here. It produces a bundle for the HOST
    # platform only and takes minutes; the Windows installer must be built on Windows and
    # the macOS bundle on macOS. See .github/workflows/tray-build.yml for the CI matrix.
    echo
    echo "    Frontend and Rust shell both compile."
    echo "    To produce an installer for THIS platform: (cd tray && npx tauri build)"
}

case "${1:-all}" in
    check)     run_check ;;
    build)     run_build ;;
    container) run_container ;;
    tray)      run_tray ;;
    all)       run_check; run_build; run_container ;;
    -h|--help) usage; exit 0 ;;
    *)         echo "Unknown subcommand: $1" >&2; usage; exit 1 ;;
esac

echo
echo "==> OK"
