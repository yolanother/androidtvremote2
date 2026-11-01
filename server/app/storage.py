# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# SQLite-backed device registry for the Android TV Remote appliance. Persists one row per
# registered TV keyed by its MAC-derived device id, so that registrations and pairing
# state survive container restarts and rebuilds and so a DHCP lease change updates the
# mutable host column instead of orphaning a pairing. Also stores small appliance
# preferences such as optional-provider enablement. The connection is deliberately
# opened in TRUNCATE journal mode with synchronous=FULL because the data directory is an
# NFS mount, where SQLite's WAL mode requires shared-memory mmap and will corrupt.
"""SQLite-backed device registry for the Android TV Remote appliance."""

from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    host        TEXT NOT NULL,
    mac         TEXT NOT NULL,
    mdns_name   TEXT,
    model       TEXT,
    paired      INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

#: Columns callers are allowed to change after a device has been registered. ``id`` and
#: ``mac`` are the identity and are deliberately absent.
MUTABLE_COLUMNS = frozenset({"name", "host", "mdns_name", "model", "paired", "enabled"})


@dataclass(frozen=True)
class DeviceRecord:
    """One persisted device registration.

    This is the storage-layer view of a TV. The API-facing :class:`app.models.Device`
    adds the live :class:`app.models.DeviceState`, which is never persisted.
    """

    #: MAC address lowercased with colons stripped, e.g. ``aabbccddeeff``.
    id: str
    #: Operator-assigned display name.
    name: str
    #: Current IP address or hostname. Mutable; not part of the identity.
    host: str
    #: Colon-separated MAC address as reported by the TV's certificate.
    mac: str
    #: Full mDNS service instance name, when the TV has been seen by the browser.
    mdns_name: str | None
    #: Model string reported by the TV, when known.
    model: str | None
    #: Whether a usable certificate is stored for this device.
    paired: bool
    #: Whether the manager should hold a connection open to this device.
    enabled: bool
    #: When the device was first registered.
    created_at: datetime


class Registry:
    """Durable store of device registrations backed by a single SQLite file.

    :param path: Absolute path of the SQLite database file. Parent directories are
        created on :meth:`open`.
    """

    def __init__(self, path: Path) -> None:
        """Initialize the registry against a database path without opening it."""
        self.path = Path(path)
        self._connection: sqlite3.Connection | None = None
        # The connection is shared across the worker threads that asyncio.to_thread hands
        # calls to, so every statement is serialized behind this lock.
        self._lock = threading.Lock()

    @property
    def connection(self) -> sqlite3.Connection:
        """The live SQLite connection.

        :returns: The open connection.
        :raises RuntimeError: If the registry has not been opened.
        """
        if self._connection is None:
            raise RuntimeError("Registry is not open")
        return self._connection

    def open(self) -> None:
        """Create the data directory, open the database, and apply the schema.

        Journal mode is set to TRUNCATE rather than WAL: the data directory is an NFS
        mount and WAL requires shared-memory mmap, which NFS does not provide. There is
        exactly one writer process, so TRUNCATE with ``synchronous=FULL`` is safe.
        """
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=TRUNCATE")
        connection.execute("PRAGMA synchronous=FULL")
        connection.executescript(_SCHEMA)
        connection.commit()
        self._connection = connection

    def close(self) -> None:
        """Close the database connection if it is open.

        Taken under the same lock as every statement: closing a SQLite connection while
        another worker thread is mid-statement on it segfaults the interpreter.
        """
        with self._lock:
            if self._connection is not None:
                self._connection.close()
                self._connection = None

    def list(self) -> list[DeviceRecord]:
        """Return every registered device, oldest registration first.

        :returns: All device records ordered by ``created_at``.
        """
        with self._lock:
            rows = self.connection.execute("SELECT * FROM devices ORDER BY created_at").fetchall()
        return [_from_row(row) for row in rows]

    def get(self, device_id: str) -> DeviceRecord | None:
        """Look up one device by id.

        :param device_id: MAC-derived device identifier.
        :returns: The record, or ``None`` when no such device is registered.
        """
        with self._lock:
            row = self.connection.execute(
                "SELECT * FROM devices WHERE id = ?", (device_id,)
            ).fetchone()
        return _from_row(row) if row else None

    def insert(self, record: DeviceRecord) -> DeviceRecord:
        """Persist a new device registration.

        :param record: The record to store.
        :returns: The stored record, unchanged.
        :raises sqlite3.IntegrityError: If the device id is already registered.
        """
        with self._lock:
            self.connection.execute(
                "INSERT INTO devices (id, name, host, mac, mdns_name, model, paired,"
                " enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    record.id,
                    record.name,
                    record.host,
                    record.mac,
                    record.mdns_name,
                    record.model,
                    int(record.paired),
                    int(record.enabled),
                    record.created_at.astimezone(UTC).isoformat(),
                ),
            )
            self.connection.commit()
        return record

    def update(self, device_id: str, **fields: Any) -> DeviceRecord:
        """Change one or more mutable columns of a registered device.

        ``host`` is mutable by design: when a known TV appears at a new address the row is
        updated in place so the pairing certificate keyed by the unchanged id keeps working.

        :param device_id: MAC-derived device identifier.
        :param fields: Column/value pairs drawn from :data:`MUTABLE_COLUMNS`.
        :returns: The record as it now stands in the database.
        :raises ValueError: If a column outside :data:`MUTABLE_COLUMNS` was supplied.
        :raises KeyError: If no device with that id is registered.
        """
        supplied = {key: value for key, value in fields.items() if value is not None}
        unknown = set(supplied) - MUTABLE_COLUMNS
        if unknown:
            raise ValueError(f"Cannot update immutable or unknown columns: {sorted(unknown)}")
        if supplied:
            assignments = ", ".join(f"{column} = ?" for column in supplied)
            values = [int(v) if isinstance(v, bool) else v for v in supplied.values()]
            with self._lock:
                self.connection.execute(
                    f"UPDATE devices SET {assignments} WHERE id = ?", [*values, device_id]
                )
                self.connection.commit()
        record = self.get(device_id)
        if record is None:
            raise KeyError(device_id)
        return record

    def delete(self, device_id: str) -> None:
        """Remove a device registration.

        :param device_id: MAC-derived device identifier. Unknown ids are ignored.
        """
        with self._lock:
            self.connection.execute("DELETE FROM devices WHERE id = ?", (device_id,))
            self.connection.commit()

    def get_setting(self, key: str) -> str | None:
        """Read one non-secret appliance preference, or None when unset.

        :param key: Stable preference name.
        :returns: Persisted string value or None.
        """
        with self._lock:
            row = self.connection.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def set_setting(self, key: str, value: str) -> None:
        """Persist one non-secret preference using the registry's serialized writer.

        :param key: Stable preference name.
        :param value: String preference value; credentials are not stored here.
        """
        with self._lock:
            self.connection.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value),
            )
            self.connection.commit()


def _from_row(row: sqlite3.Row) -> DeviceRecord:
    """Convert a SQLite row into a :class:`DeviceRecord`.

    :param row: Row produced by a ``SELECT *`` against the devices table.
    :returns: The equivalent record, with the timestamp normalized to UTC.
    """
    created = datetime.fromisoformat(row["created_at"])
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return DeviceRecord(
        id=row["id"],
        name=row["name"],
        host=row["host"],
        mac=row["mac"],
        mdns_name=row["mdns_name"],
        model=row["model"],
        paired=bool(row["paired"]),
        enabled=bool(row["enabled"]),
        created_at=created,
    )


def with_changes(record: DeviceRecord, **fields: Any) -> DeviceRecord:
    """Return a copy of ``record`` with the supplied non-``None`` fields replaced.

    :param record: The record to copy.
    :param fields: Field/value pairs; ``None`` values are ignored.
    :returns: The updated copy.
    """
    return replace(record, **{key: value for key, value in fields.items() if value is not None})


def read_legacy_seeds(path: Path) -> list[tuple[str, str]]:
    """Read the old Flask build's ``paired_tvs.json`` so known TVs are not lost.

    The legacy file is keyed by IP address and records only a display name — it has no MAC,
    so its entries cannot become registry rows without fabricating an identity, which is
    the exact bug this rebuild removes. They are instead surfaced as discovery seeds so the
    operator's known TV appears in the UI ready to be registered and paired.

    :param path: Path of the legacy ``paired_tvs.json``. A missing or malformed file
        yields an empty list rather than raising.
    :returns: ``(host, name)`` pairs read from the file.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(raw, dict):
        return []
    seeds: list[tuple[str, str]] = []
    for host, entry in raw.items():
        name = entry.get("name") if isinstance(entry, dict) else None
        seeds.append((str(host), str(name or host)))
    return seeds
