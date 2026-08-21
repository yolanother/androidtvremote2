#!/usr/bin/env bash
# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Deploys the Android TV Remote appliance as a Portainer stack via the Portainer HTTP API.
# It creates the stack on first run and updates it in place on subsequent runs, pushing
# docker-compose.yml as the stack definition together with the non-secret deployment
# variables from .env. Portainer's Docker Standalone stacks are the supported path because
# the appliance needs `network_mode: host` for mDNS discovery, which Swarm stacks do not
# support. Configuration comes from PORTAINER_URL, PORTAINER_TOKEN and PORTAINER_ENDPOINT
# in the environment; the token is never echoed. Deploying from git instead is usually
# simpler — see docker/README.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STACK_NAME="${STACK_NAME:-androidtv-remote}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
PORTAINER_URL="${PORTAINER_URL:-}"
PORTAINER_TOKEN="${PORTAINER_TOKEN:-}"
PORTAINER_ENDPOINT="${PORTAINER_ENDPOINT:-1}"

if [[ -z "$PORTAINER_URL" || -z "$PORTAINER_TOKEN" ]]; then
    cat >&2 <<'USAGE'
ERROR: PORTAINER_URL and PORTAINER_TOKEN must be set.

  export PORTAINER_URL=https://portainer.example.lan
  export PORTAINER_TOKEN=ptr_...          # Portainer > My account > Access tokens
  export PORTAINER_ENDPOINT=1             # optional, defaults to 1 (the local Docker env)
  scripts/deploy-portainer.sh

Do NOT put the token in .env or pass it on the command line where it lands in shell
history; export it from your credential manager for the duration of the deploy.
USAGE
    exit 1
fi

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required." >&2; exit 1; }

API="${PORTAINER_URL%/}/api"
AUTH_HEADER="X-API-Key: ${PORTAINER_TOKEN}"

# Only the non-secret deployment knobs are forwarded. REMOTE_API_TOKEN is deliberately
# excluded: set it directly in Portainer's stack environment so it is not shipped from a
# developer workstation, and so it never appears in this script's output.
env_pairs() {
    local keys=(HOST_DATA_DIR IMAGE_NAME IMAGE_TAG PORT HOST CLIENT_NAME
                DISCOVERY_ENABLED DISCOVERY_INTERVAL FRAME_ANCESTORS LOG_LEVEL CORS_ORIGINS)
    local key line value
    for key in "${keys[@]}"; do
        [[ -f .env ]] || break
        line="$(grep -E "^[[:space:]]*${key}=" .env | tail -n 1 || true)"
        [[ -n "$line" ]] || continue
        value="${line#*=}"
        value="${value%\"}"; value="${value#\"}"
        [[ -n "$value" ]] || continue
        jq -n --arg n "$key" --arg v "$value" '{name: $n, value: $v}'
    done | jq -s '.'
}

STACK_ENV="$(env_pairs)"
STACK_BODY="$(cat "$COMPOSE_FILE")"

echo "==> Looking for an existing stack named '${STACK_NAME}'"
EXISTING_ID="$(curl -fsS -H "$AUTH_HEADER" "${API}/stacks" \
    | jq -r --arg n "$STACK_NAME" '.[] | select(.Name == $n) | .Id' | head -n 1)"

if [[ -n "$EXISTING_ID" ]]; then
    echo "==> Updating existing stack ${EXISTING_ID}"
    jq -n \
        --arg content "$STACK_BODY" \
        --argjson env "$STACK_ENV" \
        '{StackFileContent: $content, Env: $env, Prune: true, PullImage: true}' \
    | curl -fsS -X PUT \
        -H "$AUTH_HEADER" \
        -H 'Content-Type: application/json' \
        --data-binary @- \
        "${API}/stacks/${EXISTING_ID}?endpointId=${PORTAINER_ENDPOINT}" \
    | jq -r '"==> Updated stack \(.Name) (id \(.Id))"'
else
    echo "==> Creating a new stack"
    jq -n \
        --arg name "$STACK_NAME" \
        --arg content "$STACK_BODY" \
        --argjson env "$STACK_ENV" \
        '{Name: $name, StackFileContent: $content, Env: $env}' \
    | curl -fsS -X POST \
        -H "$AUTH_HEADER" \
        -H 'Content-Type: application/json' \
        --data-binary @- \
        "${API}/stacks/create/standalone/string?endpointId=${PORTAINER_ENDPOINT}" \
    | jq -r '"==> Created stack \(.Name) (id \(.Id))"'
fi

echo "==> Done. Verify with: curl -fsS http://<host>:${PORT:-7433}/healthz"
