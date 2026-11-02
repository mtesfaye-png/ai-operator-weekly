# AI Operator Weekly, Stage 3: one-time setup on Windows (Docker Desktop must be running).
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1             first install
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1 -SkipImport  rebuild/restart only (keeps n8n as you left it)
# What it does:
#   1. Creates deploy\windows\.env (asked once: Airtable token + base ID; generates the trigger token).
#      The file stays on this PC, is gitignored, and is readable only by your Windows user.
#   2. Builds the collector image and starts both containers (localhost only).
#   3. Imports the "AOW Trigger Token" credential and the RSS Collect workflow into n8n (inactive).
# It never creates an Airtable base and never contacts Anthropic or beehiiv.
param([switch]$SkipImport)

# 'Continue', not 'Stop': Windows PowerShell 5.1 turns any stderr text from docker into a fatal error under 'Stop'.
# Failures are caught by exit codes (Check) and explicit throws instead.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE). See the messages above." } }

Step 'Checking Docker Desktop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is not installed (no "docker" command). Install it, restart PowerShell, then run this script again.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is installed but its engine is not ready. Open Docker Desktop and wait until the bottom-left says "Engine running" (if it never does: Docker Desktop > Troubleshoot (bug icon) > Restart, or run "wsl --update" and restart Windows), then run this script again.' }

$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envFile)) {
  Step 'Creating .env (your secrets stay on this PC)'
  $sec = Read-Host 'Paste your Airtable personal access token (starts with pat; it will not be shown)' -AsSecureString
  $pat = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  if ($pat -notmatch '^pat[A-Za-z0-9.]{20,}$') { throw 'That does not look like an Airtable personal access token (it starts with "pat").' }
  $base = Read-Host 'Airtable base ID [press Enter for appYiy5hPq7BNDosa]'
  if (-not $base) { $base = 'appYiy5hPq7BNDosa' }
  if ($base -notmatch '^app[A-Za-z0-9]{14}$') { throw 'A base ID is "app" followed by 14 letters or digits.' }
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $trigger = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $lines = @(
    "AIRTABLE_TOKEN=$pat",
    "AIRTABLE_BASE_ID=$base",
    "AOW_TRIGGER_TOKEN=$trigger",
    '# Optional: a free Slack incoming-webhook URL for the collector''s own alerts.',
    'SLACK_WEBHOOK_URL='
  )
  [IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding $false))  # no BOM: Docker needs plain UTF-8
  icacls $envFile /inheritance:r /grant:r "$($env:USERNAME):(F)" *> $null
  Write-Host "Saved $envFile (only your Windows user can read it)."
} else {
  Write-Host '.env already exists: keeping it. Delete it and re-run to enter new values.'
}

Step 'Building the collector and starting the containers (first time: a few minutes)'
docker compose up -d --build
Check 'docker compose up'

Step 'Waiting for the collector and n8n to answer on localhost'
$deadline = (Get-Date).AddMinutes(3)
foreach ($url in 'http://127.0.0.1:8787/health', 'http://127.0.0.1:5678/healthz') {
  while ($true) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop $url *> $null; Write-Host "OK  $url"; break }
    catch { if ((Get-Date) -gt $deadline) { throw "$url did not answer. Run: docker compose logs" }; Start-Sleep -Seconds 3 }
  }
}

if (-not $SkipImport) {
  Step 'Importing the trigger-token credential and the RSS Collect workflow into n8n'
  $trigger = ((Get-Content $envFile | Where-Object { $_ -like 'AOW_TRIGGER_TOKEN=*' }) -split '=', 2)[1]
  $cred = ConvertTo-Json -Depth 5 -InputObject @(@{
    id = 'aowTriggerToken1'; name = 'AOW Trigger Token'; type = 'httpHeaderAuth'
    data = @{ name = 'Authorization'; value = "Bearer $trigger" }
  })
  # Piped straight into the container (no temp file on Windows); n8n stores it encrypted, then the plain copy is deleted.
  try {
    $cred | docker compose exec -T n8n sh -c 'umask 077; cat > /tmp/aow-cred.json'; Check 'Copying the credential'
    docker compose exec -T n8n n8n import:credentials --input=/tmp/aow-cred.json; Check 'Importing the credential'
  } finally {
    docker compose exec -T n8n rm -f /tmp/aow-cred.json *> $null
  }
  docker compose exec -T n8n n8n import:workflow --input=/import/rss-collect.json; Check 'Importing the workflow'
}

Step 'Done'
Write-Host 'Open the n8n editor: http://localhost:5678' -ForegroundColor Green
Write-Host 'Next: follow "Step 5" in docs\WINDOWS_LOCAL_SETUP.md (create your n8n owner login, then run the manual test).'
