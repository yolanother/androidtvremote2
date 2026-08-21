#!/usr/bin/env bash
# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Lifecycle control script for the Android TV Remote appliance's Docker stacks. Provides
# start/stop/restart/status/logs/build over either the production stack
# (docker-compose.yml) or the hot-reloading development stack (docker-compose.dev.yml),
# selected with --dev/--prod. It bootstraps .env from .env.example on first run, creates
# and write-checks the host data directory that holds devices.db and the per-device
# pairing certificates before starting, and waits for /healthz so `start` only reports
# success once the appliance is actually answering. scripts/dev-server.ps1 is the
# equivalent for Windows PowerShell.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STACK="prod"
COMPOSE_FILE="docker-compose.yml"
PROJECT="androidtv-remote"

usage() {
    cat <<'USAGE'
Usage: scripts/dev-server.sh [--dev|--prod] <command> [args...]

Commands:
  start           Build if needed, then start the stack and wait for /healthz
  stop            Stop and remove the stack's containers
  restart         stop followed by start
  status          Show container state, health, and the resolved data directory
  logs [service]  Follow logs (all services, or just the named one)
  build           Build (or rebuild) the appliance image
  config          Print the fully resolved compose configuration

Options:
  --prod          Use docker-compose.yml (default). Host network, port 7433.
  --dev           Use docker-compose.dev.yml. uvicorn --reload + Vite dev server.
  -h, --help      Show this help

Examples:
  scripts/dev-server.sh start
  scripts/dev-server.sh --dev start
  scripts/dev-server.sh --dev logs web
  scripts/dev-server.sh restart
USAGE
}

# --- argument parsing ------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dev)
            STACK="dev"
            COMPOSE_FILE="docker-compose.dev.yml"
            PROJECT="androidtv-remote-dev"
            shift
            ;;
        --prod)
            STACK="prod"
            COMPOSE_FILE="docker-compose.yml"
            PROJECT="androidtv-remote"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

COMMAND="${1:-}"
shift || true

if [[ -z "$COMMAND" ]]; then
    usage
    exit 1
fi

compose() {
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"
}

# --- environment -----------------------------------------------------------------------

# Read a value from .env, falling back to a default. Deliberately narrow: it only reads
# the two non-secret deployment knobs this script needs to report and to mkdir.
env_value() {
    local key="$1" fallback="$2" line
    if [[ -f .env ]]; then
        line="$(grep -E "^[[:space:]]*${key}=" .env | tail -n 1 || true)"
        if [[ -n "$line" ]]; then
            local value="${line#*=}"
            value="${value%\"}"
            value="${value#\"}"
            [[ -n "$value" ]] && { printf '%s\n' "$value"; return; }
        fi
    fi
    printf '%s\n' "$fallback"
}

bootstrap_env() {
    if [[ ! -f .env ]]; then
        echo "==> No .env found; creating one from .env.example (all defaults)."
        cp .env.example .env
    fi
}

# The whole point of this appliance's rebuild is that pairing survives restarts, which
# only holds if the host side of the volume actually exists and is writable. Check it
# here so the failure is a clear message rather than a container that will not boot.
ensure_data_dir() {
    local dir
    if [[ "$STACK" == "dev" ]]; then
        dir="$REPO_ROOT/data"
    else
        dir="$(env_value HOST_DATA_DIR /volumes/androidtvremote)"
    fi

    if [[ ! -d "$dir" ]]; then
        echo "==> Creating data directory $dir"
        if ! mkdir -p "$dir" 2>/dev/null; then
            echo "ERROR: could not create $dir." >&2
            echo "       Create it yourself with appropriate ownership, or point" >&2
            echo "       HOST_DATA_DIR in .env at a writable path. Pairing" >&2
            echo "       certificates and devices.db are stored there; without it" >&2
            echo "       every pairing would be lost on restart." >&2
            exit 1
        fi
    fi

    if [[ ! -w "$dir" ]]; then
        echo "ERROR: data directory $dir is not writable by $(id -un)." >&2
        echo "       Fix its ownership/permissions before starting." >&2
        exit 1
    fi

    DATA_DIR_RESOLVED="$dir"
}

wait_for_health() {
    local port url attempt
    port="$(env_value PORT 7433)"
    url="http://127.0.0.1:${port}/healthz"

    echo "==> Waiting for ${url}"
    for attempt in $(seq 1 60); do
        if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
            echo "==> Healthy after ${attempt}s: $url"
            return 0
        fi
        sleep 1
    done

    echo "ERROR: appliance did not answer ${url} within 60s. Recent logs:" >&2
    compose logs --tail 60 >&2 || true
    return 1
}

# --- commands --------------------------------------------------------------------------

case "$COMMAND" in
    start)
        bootstrap_env
        ensure_data_dir
        echo "==> Starting ${STACK} stack (${COMPOSE_FILE}); data dir: ${DATA_DIR_RESOLVED}"
        compose up -d --build "$@"
        wait_for_health
        echo "==> Web remote:  http://127.0.0.1:$(env_value PORT 7433)/"
        echo "==> REST + docs: http://127.0.0.1:$(env_value PORT 7433)/api/docs"
        if [[ "$STACK" == "dev" ]]; then
            echo "==> Vite dev UI: http://127.0.0.1:$(env_value WEB_DEV_PORT 7434)/"
        fi
        ;;

    stop)
        echo "==> Stopping ${STACK} stack (${COMPOSE_FILE})"
        # No -v: the data volume/bind-mount holds the pairings and must never be removed
        # as part of an ordinary stop.
        compose down "$@"
        ;;

    restart)
        "$0" "--${STACK}" stop
        "$0" "--${STACK}" start
        ;;

    status)
        bootstrap_env
        echo "==> Stack: ${STACK} (${COMPOSE_FILE})"
        if [[ "$STACK" == "dev" ]]; then
            echo "==> Data directory: ${REPO_ROOT}/data"
        else
            echo "==> Data directory: $(env_value HOST_DATA_DIR /volumes/androidtvremote)"
        fi
        compose ps "$@"
        ;;

    logs)
        compose logs -f --tail 100 "$@"
        ;;

    build)
        bootstrap_env
        echo "==> Building ${STACK} image (${COMPOSE_FILE})"
        compose build "$@"
        ;;

    config)
        compose config "$@"
        ;;

    *)
        echo "Unknown command: ${COMMAND}" >&2
        usage
        exit 1
        ;;
esac
