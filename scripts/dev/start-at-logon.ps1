# Start the local stack when Windows logs in.
#
# Run by the "Alaap dev stack" scheduled task, at logon. It does what you would
# otherwise type after every restart -- node scripts/dev/up.mjs -- but waits for
# Docker first: Docker Desktop starts itself at login, but its engine takes a
# minute or two to answer, and up.mjs fails straight away if it is not there.
#
# Output goes to .dev-logs/logon-start.log, beside the services' own logs.
#
# To stop it running at logon:
#   Unregister-ScheduledTask -TaskName "Alaap dev stack" -Confirm:$false

$ErrorActionPreference = 'Continue'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$LogDir = Join-Path $Root '.dev-logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'logon-start.log'

function Write-Log([string]$Message) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $Log -Value $line -Encoding UTF8
}

Write-Log 'logon: starting'

# Wait for the Docker engine, up to ten minutes.
$deadline = (Get-Date).AddMinutes(10)
$ready = $false
while ((Get-Date) -lt $deadline) {
    & docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 10
}
if (-not $ready) {
    Write-Log 'docker did not answer within 10 minutes; not starting the stack. Is Docker Desktop set to start at login?'
    exit 1
}
Write-Log 'docker is up'

# node on PATH, or where it is installed on this machine.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'D:\nodejs\node.exe' }

Push-Location $Root
try {
    # Appended by cmd, straight to the file. Not through a PowerShell pipe:
    # Node on Windows aborts on exit (a libuv assertion) when its output is a
    # pipe, and not with *>>, which writes UTF-16 in Windows PowerShell and
    # would garble the UTF-8 lines above.
    & cmd.exe /d /c "`"$node`" scripts/dev/up.mjs >> `"$Log`" 2>&1"
    Write-Log ('up.mjs finished with exit code {0}' -f $LASTEXITCODE)

    # up.mjs reports a service that did not come up but still exits 0, so check
    # the one thing sign-in needs: the gateway answering.
    try {
        Invoke-WebRequest -Uri 'http://127.0.0.1:8080/healthz' -UseBasicParsing -TimeoutSec 5 | Out-Null
        Write-Log 'gateway answering on :8080 -- the stack is up'
        exit 0
    } catch {
        Write-Log 'gateway NOT answering on :8080 -- see the service logs in .dev-logs'
        exit 1
    }
} finally {
    Pop-Location
}
