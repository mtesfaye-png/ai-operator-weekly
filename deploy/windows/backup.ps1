# Copies everything that matters out of the Docker volumes into deploy\windows\backups\<date-time>\:
#   aow-data\            article archive, Airtable sync state, local API-call ledger, run log
#   n8n-workflows.json   your n8n workflows (re-importable)
#   n8n-home\            n8n's database and encryption key (contains your saved credentials: keep it private)
# Run it with the containers up:  powershell -ExecutionPolicy Bypass -File .\backup.ps1
# 'Continue', not 'Stop': Windows PowerShell 5.1 turns stderr text from docker into a fatal error under 'Stop'.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE). Are the containers running? (docker compose ps)" } }

$dest = Join-Path $PSScriptRoot ('backups\' + (Get-Date -Format 'yyyy-MM-dd_HHmm'))
New-Item -ItemType Directory -Force -ErrorAction Stop $dest | Out-Null

docker compose cp aow:/data "$dest\aow-data"; Check 'Copying the collector data'
docker compose exec -T n8n n8n export:workflow --all --output=/tmp/workflows.json; Check 'Exporting n8n workflows'
docker compose cp n8n:/tmp/workflows.json "$dest\n8n-workflows.json"; Check 'Copying n8n workflows'
docker compose cp n8n:/home/node/.n8n "$dest\n8n-home"; Check 'Copying the n8n database'
Write-Host "Backup saved to $dest" -ForegroundColor Green
