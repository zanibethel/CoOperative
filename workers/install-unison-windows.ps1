param(
  [Parameter(Mandatory = $true)]
  [string]$PairCode,
  [string]$QueueUrl = "https://co-operative-mu.vercel.app",
  [string]$NodeName = $env:COMPUTERNAME,
  [int]$IdleMinutes = 5,
  [int]$MaxCpuPercent = 50,
  [int]$MaxGpuPercent = 80,
  [int]$MaxMemoryMb = 8192
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw "uv is required. Install it with: winget install -e --id astral-sh.uv"
}

$existingNodeId = [Environment]::GetEnvironmentVariable("UNISON_NODE_ID", "User")
if (-not $existingNodeId) {
  $safeComputer = ($env:COMPUTERNAME -replace '[^A-Za-z0-9._:-]', '-').ToLowerInvariant()
  $existingNodeId = "$safeComputer-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
}

Write-Host "Pairing this PC with CoOperative Unison..."
$pairBody = @{
  pairingCode = $PairCode
  nodeId = $existingNodeId
  displayName = $NodeName
} | ConvertTo-Json

try {
  $pairing = Invoke-RestMethod `
    -Method Post `
    -Uri "$QueueUrl/api/unison/nodes/pair" `
    -ContentType "application/json" `
    -Body $pairBody
} catch {
  $detail = $_.ErrorDetails.Message
  if ($detail) {
    throw "Unison pairing failed: $detail"
  }
  throw
}

$nodeToken = [string]$pairing.nodeToken
if (-not $nodeToken) {
  throw "Pairing succeeded without a node credential. Installation stopped."
}

$values = @{
  "UNISON_NODE_TOKEN" = $nodeToken
  "UNISON_NODE_ID" = $existingNodeId
  "UNISON_NODE_NAME" = $NodeName
  "UNISON_NODE_OWNER_REF" = [string]$pairing.ownerRef
  "UNISON_NODE_CLASS" = [string]$pairing.nodeClass
  "UNISON_IDLE_ONLY" = "true"
  "UNISON_IDLE_THRESHOLD_SECONDS" = [string]([Math]::Max(0, $IdleMinutes) * 60)
  "UNISON_MAX_CPU_PERCENT" = [string]([Math]::Min(100, [Math]::Max(1, $MaxCpuPercent)))
  "UNISON_MAX_GPU_PERCENT" = [string]([Math]::Min(100, [Math]::Max(1, $MaxGpuPercent)))
  "UNISON_MAX_MEMORY_MB" = [string]([Math]::Max(256, $MaxMemoryMb))
  "COOPERATIVE_QUEUE_URL" = $QueueUrl
  "PRELOAD_PROFILE" = "none"
  "WORKER_BIND_HOST" = "127.0.0.1"
}

foreach ($entry in $values.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "User")
  Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value
}

$launcher = Join-Path $PSScriptRoot "start-unison-windows.ps1"
$taskName = "CoOperative Unison Node"
$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$launcher`" -QueueUrl `"$QueueUrl`" -NodeName `"$NodeName`" -IdleMinutes $IdleMinutes"

schtasks.exe /Create /F /SC ONLOGON /TN $taskName /TR $taskCommand | Out-Null

Write-Host ""
Write-Host "Unison node paired and installed."
Write-Host "Node ID: $existingNodeId"
Write-Host "Owner: $($pairing.ownerRef)"
Write-Host "Class: $($pairing.nodeClass)"
Write-Host "Startup task: $taskName"
Write-Host "The worker will only claim new jobs after $IdleMinutes minute(s) of Windows inactivity."
Write-Host ""
Write-Host "Starting the node in the background..."
schtasks.exe /Run /TN $taskName | Out-Null
Write-Host "Unison is running. Log: $(Join-Path $PSScriptRoot 'unison.log')"
