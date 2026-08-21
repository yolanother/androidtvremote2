#!/bin/sh
# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Container entrypoint for the Android TV Remote appliance. Before starting the server it
# creates the DATA_DIR tree (the SQLite registry directory and the per-device certificate
# directory) on the mounted volume and PROVES it is writable, failing loudly with a
# remediation message if it is not. This check exists because the previous build silently
# wrote pairing certificates into the container's writable layer whenever the volume was
# missing, destroying every pairing on restart; a hard failure at boot is far better than
# a remote that appears to work and forgets its TVs. The container runs as a non-root
# user, so the most likely cause of a failure here is a host directory (or NFS export)
# owned by a different uid; the messages below say so explicitly. With no arguments it
# then execs uvicorn using HOST, PORT and LOG_LEVEL; any arguments replace that default.
set -eu

DATA_DIR="${DATA_DIR:-/volumes/androidtvremote}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-7433}"
LOG_LEVEL="${LOG_LEVEL:-info}"

CERTS_DIR="${DATA_DIR}/certs"

if ! mkdir -p "${CERTS_DIR}" 2>/dev/null; then
    echo "FATAL: cannot create ${CERTS_DIR}." >&2
    echo "       DATA_DIR must be a writable, MOUNTED volume. Check that the compose" >&2
    echo "       file bind-mounts a host directory onto ${DATA_DIR}, that the host path" >&2
    echo "       exists, and that it is writable by uid $(id -u):$(id -g)." >&2
    echo "       Either chown the host directory to that uid/gid, or set PUID/PGID in" >&2
    echo "       .env to an owner that can write it." >&2
    exit 1
fi

# mkdir can succeed against a read-only-ish NFS export that still refuses file creation,
# so probe an actual write rather than trusting the directory.
_probe="${DATA_DIR}/.write-probe"
if ! (: > "${_probe}") 2>/dev/null; then
    echo "FATAL: ${DATA_DIR} exists but is not writable by uid $(id -u):$(id -g)." >&2
    echo "       Pairing certificates and devices.db cannot be persisted, so every" >&2
    echo "       restart would lose all pairings. Refusing to start." >&2
    echo "       Fix: chown the host directory to $(id -u):$(id -g), or set PUID/PGID" >&2
    echo "       in .env to an owner that can write it. If ${DATA_DIR} is an NFS" >&2
    echo "       mount, check its root-squash settings too." >&2
    exit 1
fi
rm -f "${_probe}"

# Pairing material is private keys: keep it off other local accounts.
chmod 700 "${CERTS_DIR}" 2>/dev/null || true

echo "androidtv-remote: DATA_DIR=${DATA_DIR} is writable by uid $(id -u):$(id -g)"
echo "androidtv-remote:   registry=${DATA_DIR}/devices.db  certs=${CERTS_DIR}"

if [ "$#" -eq 0 ]; then
    set -- uvicorn app.main:app \
        --host "${HOST}" \
        --port "${PORT}" \
        --log-level "${LOG_LEVEL}"
fi

exec "$@"
