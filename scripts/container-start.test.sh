#!/usr/bin/env bash
# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Integration smoke test for the Android TV Remote appliance container. Builds the image,
# starts the production stack against a disposable data directory, waits for /healthz, and
# then verifies the property this whole rebuild exists to guarantee: that a file written
# into DATA_DIR — a pairing certificate and a devices.db stand-in — is still present after
# `docker compose down` and a fresh `up`, proving the pairing state lives on the mounted
# volume rather than in the container's writable layer. Run from the repository root or
# via scripts/dev-server.sh; it cleans up the stack and the temporary data directory on
# exit whether it passes or fails.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT="androidtv-remote-smoke"
COMPOSE_FILE="docker-compose.yml"
PORT="${PORT:-7533}"
DATA_DIR_HOST="$(mktemp -d "${TMPDIR:-/tmp}/androidtv-smoke-XXXXXX")"

pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*" >&2; exit 1; }

compose() {
    HOST_DATA_DIR="$DATA_DIR_HOST" PORT="$PORT" \
        docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
    echo "==> Cleaning up"
    compose down --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$DATA_DIR_HOST"
}
trap cleanup EXIT

wait_for_health() {
    local attempt
    for attempt in $(seq 1 90); do
        if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
            echo "  (healthy after ${attempt}s)"
            return 0
        fi
        sleep 1
    done
    echo "Container did not become healthy in time. Logs:" >&2
    compose logs --tail 100 >&2 || true
    return 1
}

echo "==> Data directory for this run: ${DATA_DIR_HOST}"

echo
echo "==> [1/6] Building the appliance image"
compose build

echo
echo "==> [2/6] Starting the stack"
compose up -d
wait_for_health
pass "/healthz answered on port ${PORT}"

echo
echo "==> [3/6] Verifying the entrypoint created the data layout on the MOUNTED volume"
[[ -d "${DATA_DIR_HOST}/certs" ]] \
    || fail "certs/ was not created in the host data directory (volume not mounted?)"
pass "certs/ exists on the host side at ${DATA_DIR_HOST}/certs"

echo
echo "==> [4/6] Writing pairing state into the volume"
# Stand-ins for what DeviceManager writes: a per-device keypair and the SQLite registry.
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" exec -T androidtv-remote sh -c '
    set -e
    mkdir -p "$DATA_DIR/certs/aabbccddeeff"
    echo "SMOKE-TEST-CERT" > "$DATA_DIR/certs/aabbccddeeff/cert.pem"
    echo "SMOKE-TEST-KEY"  > "$DATA_DIR/certs/aabbccddeeff/key.pem"
    echo "SMOKE-TEST-DB"   > "$DATA_DIR/devices.db"
'
grep -q SMOKE-TEST-CERT "${DATA_DIR_HOST}/certs/aabbccddeeff/cert.pem" \
    || fail "cert written inside the container did not appear on the host volume"
pass "container writes are visible on the host volume"

echo
echo "==> [5/6] Destroying and recreating the container"
compose down
[[ ! "$(docker ps -aq -f name=androidtv-remote$)" ]] || fail "container still exists after down"
compose up -d
wait_for_health
pass "stack came back up"

echo
echo "==> [6/6] Verifying pairing state SURVIVED the restart"
survived="$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" exec -T androidtv-remote \
    sh -c 'cat "$DATA_DIR/certs/aabbccddeeff/cert.pem" 2>/dev/null || echo MISSING')"
[[ "$survived" == *SMOKE-TEST-CERT* ]] \
    || fail "pairing certificate did NOT survive the restart (got: ${survived})"
pass "cert.pem survived: ${survived}"

survived_db="$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" exec -T androidtv-remote \
    sh -c 'cat "$DATA_DIR/devices.db" 2>/dev/null || echo MISSING')"
[[ "$survived_db" == *SMOKE-TEST-DB* ]] \
    || fail "devices.db did NOT survive the restart (got: ${survived_db})"
pass "devices.db survived: ${survived_db}"

echo
echo "==> ALL CHECKS PASSED — pairing state is durable across container recreation."
