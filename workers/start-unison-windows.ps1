param(
  [string]$QueueUrl = "https://co-operative-mu.vercel.app",
  [string]$NodeName = $env:COMPUTERNAME,
  [int]$IdleMinutes = 5
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host "uv is required. Install it first with: winget install -e --id astral-sh.uv"
  exit 1
}

if (-not $env:INFERENCE_WORKER_TOKEN -and -not $env:UNISON_NODE_SHARED_SECRET) {
  throw "No Unison node token is configured. Run install-unison-windows.ps1 first."
}

if (-not $env:UNISON_NODE_ID) {
  throw "UNISON_NODE_ID is missing. Run install-unison-windows.ps1 first."
}

$env:COOPERATIVE_QUEUE_URL = $QueueUrl
$env:UNISON_NODE_NAME = $NodeName
$env:UNISON_IDLE_ONLY = "true"
$env:UNISON_IDLE_THRESHOLD_SECONDS = [string]([Math]::Max(0, $IdleMinutes) * 60)

Write-Host "Starting CoOperative Unison node $($env:UNISON_NODE_ID)"
Write-Host "Idle-only mode: $IdleMinutes minute(s)"
Write-Host "Queue: $QueueUrl"

$logPath = Join-Path $PSScriptRoot "unison.log"
Write-Host "Log: $logPath"

& uv run "$PSScriptRoot\hf-image-worker.py" 2>&1 |
  Tee-Object -FilePath $logPath -Append

exit $LASTEXITCODE
