# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Tests for the SQLite-backed device registry. Covers the durability guarantee that the
# rebuild exists to deliver: rows survive a full close/reopen cycle, the MAC-derived
# device id is the primary key so a DHCP host change never creates a duplicate or orphans
# a pairing, and the connection is opened in the NFS-safe TRUNCATE journal mode rather
# than WAL.
"""Tests for the SQLite-backed device registry."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.storage import DeviceRecord, Registry


def _record(device_id: str = "aabbccddeeff", host: str = "192.168.1.23") -> DeviceRecord:
    """Build a device record with sensible defaults for tests."""
    return DeviceRecord(
        id=device_id,
        name="Living Room TV",
        host=host,
        mac="aa:bb:cc:dd:ee:ff",
        mdns_name=None,
        model="BRAVIA 4K GB",
        paired=False,
        enabled=True,
        created_at=datetime.now(UTC),
    )


def test_registry_creates_database_under_data_dir(tmp_path: Path) -> None:
    """Opening the registry creates the database file inside the configured data dir."""
    db_path = tmp_path / "data" / "devices.db"
    registry = Registry(db_path)
    registry.open()
    try:
        assert db_path.is_file()
    finally:
        registry.close()


def test_rows_survive_close_and_reopen(tmp_path: Path) -> None:
    """A registered device is still there after the process-equivalent restart.

    This is the regression test for the bug where pairing state lived in the container's
    writable layer and vanished on every rebuild.
    """
    db_path = tmp_path / "data" / "devices.db"
    registry = Registry(db_path)
    registry.open()
    registry.insert(_record())
    registry.update("aabbccddeeff", paired=True)
    registry.close()

    reopened = Registry(db_path)
    reopened.open()
    try:
        devices = reopened.list()
        assert [d.id for d in devices] == ["aabbccddeeff"]
        assert devices[0].paired is True
    finally:
        reopened.close()


def test_journal_mode_is_truncate_not_wal(tmp_path: Path) -> None:
    """The connection uses TRUNCATE journaling because WAL corrupts over NFS."""
    registry = Registry(tmp_path / "devices.db")
    registry.open()
    try:
        mode = registry.connection.execute("PRAGMA journal_mode").fetchone()[0]
        assert mode.lower() == "truncate"
    finally:
        registry.close()


def test_host_is_mutable_but_id_is_not(tmp_path: Path) -> None:
    """A DHCP lease change updates ``host`` in place and never creates a second row.

    Keying by IP was the third of the four pairing-loss bugs; the MAC-derived id is the
    primary key, so re-seeing the same TV at a new address is an update, not an insert.
    """
    registry = Registry(tmp_path / "devices.db")
    registry.open()
    try:
        registry.insert(_record(host="192.168.1.23"))
        updated = registry.update("aabbccddeeff", host="192.168.1.99")
        assert updated.host == "192.168.1.99"
        assert updated.id == "aabbccddeeff"
        assert len(registry.list()) == 1
    finally:
        registry.close()


def test_inserting_a_duplicate_id_is_rejected(tmp_path: Path) -> None:
    """Two registrations of the same MAC cannot both land in the registry."""
    registry = Registry(tmp_path / "devices.db")
    registry.open()
    try:
        registry.insert(_record())
        with pytest.raises(sqlite3.IntegrityError):
            registry.insert(_record(host="192.168.1.99"))
    finally:
        registry.close()


def test_get_and_delete(tmp_path: Path) -> None:
    """``get`` returns the stored record and ``delete`` removes it."""
    registry = Registry(tmp_path / "devices.db")
    registry.open()
    try:
        registry.insert(_record())
        assert registry.get("aabbccddeeff") is not None
        assert registry.get("nosuchdevice") is None
        registry.delete("aabbccddeeff")
        assert registry.get("aabbccddeeff") is None
    finally:
        registry.close()
