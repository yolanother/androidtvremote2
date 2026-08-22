# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Environment-driven configuration for the Android TV Remote appliance. Defines the
# Settings model covering the NFS-backed data directory, HTTP bind address, optional
# bearer token, pairing client name, mDNS discovery behaviour, iframe embedding policy,
# and CORS origins, together with the derived paths for the SQLite database and
# per-device certificate directories. There is deliberately no config file: every knob is
# an environment variable so the container is configured entirely through compose.
"""Environment-driven configuration for the Android TV Remote appliance."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration resolved from the process environment.

    Defaults are chosen so that ``docker compose up`` with no ``.env`` produces a working,
    unauthenticated appliance on a trusted LAN.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    #: Root directory for the SQLite registry and per-device certificates. NFS-backed.
    data_dir: Path = Field(default=Path("/volumes/androidtvremote"))
    #: TCP port the HTTP server listens on.
    port: int = Field(default=7433, ge=1, le=65535)
    #: Address the HTTP server binds to.
    host: str = Field(default="0.0.0.0")
    #: When set, every ``/api`` and ``/mcp`` request must present this bearer token.
    remote_api_token: str | None = Field(default=None)
    #: Client name shown on the Android TV during the pairing handshake.
    client_name: str = Field(default="Android TV Remote")
    #: Whether to run the background mDNS browser. Useless on a Docker bridge network.
    discovery_enabled: bool = Field(default=True)
    #: Seconds between full mDNS rescans.
    discovery_interval: int = Field(default=60, ge=5)
    #: Public HTTPS origin this appliance is also reachable at, e.g.
    #: ``https://remote.example.net``. Purely advisory: the appliance never calls it. It
    #: exists so the web UI can point a phone at a secure origin, because a browser will
    #: not install a PWA or run a service worker from ``http://<lan-ip>``.
    public_url: str | None = Field(default=None)
    #: CSP ``frame-ancestors`` value governing which sites may iframe the embed view.
    frame_ancestors: str = Field(default="*")
    #: Log level passed to uvicorn and the application logger.
    log_level: str = Field(default="info")
    #: Comma-separated list of allowed CORS origins, or ``*`` for any.
    cors_origins: str = Field(default="*")

    @field_validator("data_dir", mode="before")
    @classmethod
    def _expand_data_dir(cls, value: str | Path) -> Path:
        """Expand ``~`` and resolve the configured data directory to an absolute path."""
        return Path(value).expanduser()

    @field_validator("public_url", mode="before")
    @classmethod
    def _clean_public_url(cls, value: str | None) -> str | None:
        """Normalise the advertised public origin, rejecting one that cannot be secure.

        An ``http://`` origin is refused rather than quietly accepted: the whole point of
        this setting is to name an origin a browser will treat as secure, and advertising
        a plaintext one would send the operator somewhere the install still cannot happen.

        :param value: Raw environment value, possibly empty or with a trailing slash.
        :returns: The origin without a trailing slash, or ``None`` when unset.
        :raises ValueError: If a non-empty value is not an ``https://`` URL.
        """
        if value is None:
            return None
        cleaned = value.strip().rstrip("/")
        if not cleaned:
            return None
        if not cleaned.startswith("https://"):
            raise ValueError("PUBLIC_URL must be an https:// origin, or left unset")
        return cleaned

    @property
    def database_path(self) -> Path:
        """Absolute path of the SQLite device registry.

        :returns: ``<data_dir>/devices.db``.
        """
        return self.data_dir / "devices.db"

    @property
    def certs_dir(self) -> Path:
        """Absolute path of the directory holding per-device certificate folders.

        :returns: ``<data_dir>/certs``.
        """
        return self.data_dir / "certs"

    def cert_paths(self, device_id: str) -> tuple[Path, Path]:
        """Resolve the certificate and key file paths for one device.

        Each device gets its own keypair; sharing one keypair across TVs was the bug that
        made pairing a second device silently invalidate the first.

        :param device_id: MAC-derived device identifier, e.g. ``aabbccddeeff``.
        :returns: A ``(certfile, keyfile)`` tuple of absolute paths.
        """
        directory = self.certs_dir / device_id
        return directory / "cert.pem", directory / "key.pem"

    @property
    def cors_origin_list(self) -> list[str]:
        """Parse :attr:`cors_origins` into the list form the CORS middleware expects.

        :returns: ``["*"]`` for the wildcard, otherwise the split, stripped origin list.
        """
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def auth_enabled(self) -> bool:
        """Whether bearer-token authentication is active.

        :returns: ``True`` when a non-empty ``REMOTE_API_TOKEN`` is configured.
        """
        return bool(self.remote_api_token)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings singleton.

    :returns: The cached :class:`Settings` instance built from the environment.
    """
    return Settings()
