<#
Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
repository root.

Windows PowerShell lifecycle control script for the Android TV Remote appliance's Docker
stacks, mirroring scripts/dev-server.sh command for command. Provides
start/stop/restart/status/logs/build/config over either the production stack
(docker-compose.yml) or the hot-reloading development stack (docker-compose.dev.yml),
bootstraps .env from .env.example, ensures the host data directory holding devices.db and
the per-device pairing certificates exists and is writable, and waits for /healthz so that
`start` only reports success once the appliance is answering. Note that network_mode: host
is a Linux-only Docker feature: on Docker Desktop for Windows the container still runs but
mDNS discovery cannot work, so set DISCOVERY_ENABLED=false in .env and add TVs by IP.
#>

[CmdletBinding()]
param(
    [switch]$Dev,
    [switch]$Prod,

    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs', 'build', 'config', 'help')]
    [string]$Command = 'help',

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$Rest = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

if ($Dev) {
    $Stack = 'dev'
    $ComposeFile = 'docker-compose.dev.yml'
    $Project = 'androidtv-remote-dev'
} else {
    $Stack = 'prod'
    $ComposeFile = 'docker-compose.yml'
    $Project = 'androidtv-remote'
}

function Show-Usage {
    @'
Usage: scripts\dev-server.ps1 [-Dev|-Prod] <command> [args...]

Commands:
  start           Build if needed, then start the stack and wait for /healthz
  stop            Stop and remove the stack's containers
  restart         stop followed by start
  status          Show container state, health, and the resolved data directory
  logs [service]  Follow logs (all services, or just the named one)
  build           Build (or rebuild) the appliance image
  config          Print the fully resolved compose configuration

Options:
  -Prod           Use docker-compose.yml (default). Host network, port 7433.
  -Dev            Use docker-compose.dev.yml. uvicorn --reload + Vite dev server.

Examples:
  scripts\dev-server.ps1 start
  scripts\dev-server.ps1 -Dev start
  scripts\dev-server.ps1 -Dev logs web
'@ | Write-Host
}

function Invoke-Compose {
    param([string[]]$Args)
    & docker compose -p $Project -f $ComposeFile @Args
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose $($Args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

# Read one value from .env with a fallback. Deliberately narrow: only the non-secret
# deployment knobs this script needs in order to report URLs and create the data dir.
function Get-EnvValue {
    param([string]$Key, [string]$Fallback)

    $envPath = Join-Path $RepoRoot '.env'
    if (Test-Path $envPath) {
        $line = Get-Content $envPath |
            Where-Object { $_ -match "^\s*$([regex]::Escape($Key))=" } |
            Select-Object -Last 1
        if ($line) {
            $value = ($line -split '=', 2)[1].Trim().Trim('"')
            if ($value) { return $value }
        }
    }
    return $Fallback
}

function Initialize-EnvFile {
    $envPath = Join-Path $RepoRoot '.env'
    if (-not (Test-Path $envPath)) {
        Write-Host '==> No .env found; creating one from .env.example (all defaults).'
        Copy-Item (Join-Path $RepoRoot '.env.example') $envPath
    }
}

# Pairing durability depends on the host side of the volume existing and being writable.
# Check it here so the failure is a clear message rather than a container that will not boot.
function Confirm-DataDir {
    if ($Stack -eq 'dev') {
        $dir = Join-Path $RepoRoot 'data'
    } else {
        $dir = Get-EnvValue -Key 'HOST_DATA_DIR' -Fallback '/volumes/androidtvremote'
    }

    if (-not (Test-Path $dir)) {
        Write-Host "==> Creating data directory $dir"
        try {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        } catch {
            throw "Could not create $dir. Create it yourself, or point HOST_DATA_DIR in .env at a writable path. Pairing certificates and devices.db live there; without it every pairing would be lost on restart."
        }
    }

    # Prove writability rather than trusting the directory's existence.
    $probe = Join-Path $dir '.write-probe'
    try {
        New-Item -ItemType File -Path $probe -Force | Out-Null
        Remove-Item $probe -Force
    } catch {
        throw "Data directory $dir is not writable. Fix its ownership/permissions before starting."
    }

    return $dir
}

function Wait-ForHealth {
    $port = Get-EnvValue -Key 'PORT' -Fallback '7433'
    $url = "http://127.0.0.1:$port/healthz"

    Write-Host "==> Waiting for $url"
    foreach ($attempt in 1..60) {
        try {
            Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing | Out-Null
            Write-Host "==> Healthy after ${attempt}s: $url"
            return
        } catch {
            Start-Sleep -Seconds 1
        }
    }

    Invoke-Compose @('logs', '--tail', '60')
    throw "Appliance did not answer $url within 60s."
}

switch ($Command) {
    'start' {
        Initialize-EnvFile
        $dataDir = Confirm-DataDir
        Write-Host "==> Starting $Stack stack ($ComposeFile); data dir: $dataDir"
        Invoke-Compose (@('up', '-d', '--build') + $Rest)
        Wait-ForHealth
        $port = Get-EnvValue -Key 'PORT' -Fallback '7433'
        Write-Host "==> Web remote:  http://127.0.0.1:$port/"
        Write-Host "==> REST + docs: http://127.0.0.1:$port/api/docs"
        if ($Stack -eq 'dev') {
            $webPort = Get-EnvValue -Key 'WEB_DEV_PORT' -Fallback '7434'
            Write-Host "==> Vite dev UI: http://127.0.0.1:$webPort/"
        }
    }

    'stop' {
        Write-Host "==> Stopping $Stack stack ($ComposeFile)"
        # No -v: the data volume holds the pairings and must never be removed by a stop.
        Invoke-Compose (@('down') + $Rest)
    }

    'restart' {
        $stackFlag = if ($Stack -eq 'dev') { '-Dev' } else { '-Prod' }
        & $PSCommandPath $stackFlag stop
        & $PSCommandPath $stackFlag start
    }

    'status' {
        Initialize-EnvFile
        Write-Host "==> Stack: $Stack ($ComposeFile)"
        if ($Stack -eq 'dev') {
            Write-Host "==> Data directory: $(Join-Path $RepoRoot 'data')"
        } else {
            Write-Host "==> Data directory: $(Get-EnvValue -Key 'HOST_DATA_DIR' -Fallback '/volumes/androidtvremote')"
        }
        Invoke-Compose (@('ps') + $Rest)
    }

    'logs'   { Invoke-Compose (@('logs', '-f', '--tail', '100') + $Rest) }
    'build'  { Initialize-EnvFile; Invoke-Compose (@('build') + $Rest) }
    'config' { Invoke-Compose (@('config') + $Rest) }
    default  { Show-Usage }
}
