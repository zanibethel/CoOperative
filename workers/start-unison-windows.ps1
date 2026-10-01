param(
  [string]$QueueUrl = "https://co-operative-mu.vercel.app",
  [string]$NodeName = $env:COMPUTERNAME,
  [int]$IdleMinutes = 5
)

$ErrorActionPreference = "Stop"

foreach ($name in @(
  "UNISON_NODE_TOKEN",
  "UNISON_NODE_ID",
  "UNISON_NODE_NAME",
  "UNISON_NODE_OWNER_REF",
  "UNISON_NODE_CLASS",
  "UNISON_IDLE_ONLY",
  "UNISON_IDLE_THRESHOLD_SECONDS",
  "UNISON_MAX_CPU_PERCENT",
  "UNISON_MAX_GPU_PERCENT",
  "UNISON_MAX_MEMORY_MB",
  "COOPERATIVE_QUEUE_URL",
  "PRELOAD_PROFILE",
  "WORKER_BIND_HOST"
)) {
  $value = [Environment]::GetEnvironmentVariable($name, "User")
  if ($value) {
    Set-Item -Path "Env:$name" -Value $value
  }
}

$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
$uvCandidate = Join-Path $env:USERPROFILE ".local\bin\uv.exe"

if (-not $uvCommand -and (Test-Path $uvCandidate)) {
  $uvCommand = Get-Item $uvCandidate
}

if (-not $uvCommand) {
  Write-Host "uv is required but could not be found."
  exit 1
}

$uvExe = $uvCommand.Source
if (-not $uvExe) {
  $uvExe = $uvCommand.FullName
}

if (
  -not $env:UNISON_NODE_TOKEN -and
  -not $env:INFERENCE_WORKER_TOKEN -and
  -not $env:UNISON_NODE_SHARED_SECRET
) {
  throw "No Unison node token is configured. Run install-unison-windows.ps1 first."
}

if (-not $env:UNISON_NODE_ID) {
  throw "UNISON_NODE_ID is missing. Run install-unison-windows.ps1 first."
}

$env:COOPERATIVE_QUEUE_URL = $QueueUrl
$env:UNISON_NODE_NAME = $NodeName
$env:UNISON_IDLE_ONLY = "true"
$env:UNISON_IDLE_THRESHOLD_SECONDS = [string]([Math]::Max(0, $IdleMinutes) * 60)

try {
  $startupHeartbeat = @{
    nodeId = $env:UNISON_NODE_ID
    displayName = $NodeName
    ownerRef = $(if ($env:UNISON_NODE_OWNER_REF) { $env:UNISON_NODE_OWNER_REF } else { "platform-private" })
    nodeClass = $(if ($env:UNISON_NODE_CLASS) { $env:UNISON_NODE_CLASS } else { "private" })
    state = "online"
    platform = @{
      system = "Windows"
      release = [Environment]::OSVersion.VersionString
      machine = $env:PROCESSOR_ARCHITECTURE
    }
    capabilities = @()
    resources = @{}
    policy = @{
      idleOnly = $true
      idleThresholdSeconds = [Math]::Max(0, $IdleMinutes) * 60
      allowImage = $false
      allowText = $false
    }
    workerVersion = "starting-windows-0.1"
  } | ConvertTo-Json -Depth 6

  Invoke-RestMethod `
    -Method Post `
    -Uri "$QueueUrl/api/unison/nodes/heartbeat" `
    -Headers @{ Authorization = "Bearer $($env:UNISON_NODE_TOKEN)" } `
    -ContentType "application/json" `
    -Body $startupHeartbeat | Out-Null
} catch {
  Write-Host "Startup check-in failed: $($_.Exception.Message)"
}

Write-Host "Starting CoOperative Unison node $($env:UNISON_NODE_ID)"
Write-Host "Idle-only mode: $IdleMinutes minute(s)"
Write-Host "Queue: $QueueUrl"

$logPath = Join-Path $PSScriptRoot "unison.log"
Write-Host "Log: $logPath"

& $uvExe run "$PSScriptRoot\hf-image-worker.py" 2>&1 |
  Tee-Object -FilePath $logPath -Append

exit $LASTEXITCODE
