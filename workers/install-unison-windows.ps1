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

function Find-Ollama {
  $command = Get-Command ollama -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
    (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

$adaptiveBackend = "transformers"
$adaptiveFastModel = "Qwen/Qwen2.5-1.5B-Instruct"
$adaptiveQualityModel = $adaptiveFastModel
$adaptiveHeavyModel = $adaptiveFastModel
$adaptiveVisionModel = "qwen2.5vl:3b"
$modelPlanner = Join-Path $PSScriptRoot "windows-model-plan.py"
$modelPlanPath = Join-Path $PSScriptRoot "text-model-plan.json"

if (Test-Path $modelPlanner) {
  Write-Host "Profiling this PC for adaptive local AI..."
  & uv run $modelPlanner | Out-Null

  if (Test-Path $modelPlanPath) {
    try {
      $plan = Get-Content $modelPlanPath -Raw | ConvertFrom-Json
      $ollama = Find-Ollama

      if (-not $ollama -and (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host "Installing the quantized local AI runtime..."
        winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent
        $env:Path =
          [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
          [Environment]::GetEnvironmentVariable("Path", "User")
        $ollama = Find-Ollama
      }

      if ($ollama) {
        $adaptiveBackend = "ollama"
        $adaptiveFastModel = [string]$plan.models.fast
        $adaptiveQualityModel = [string]$plan.models.quality
        $adaptiveHeavyModel = [string]$plan.models.heavy
    if ($plan.models.vision) { $adaptiveVisionModel = [string]$plan.models.vision }
        Write-Host "Adaptive model plan: Fast=$adaptiveFastModel Quality=$adaptiveQualityModel Heavy=$adaptiveHeavyModel"
        Write-Host "Fast will be fetched when first needed; larger models stay lazy until routed work requires them."
      } else {
        Write-Host "Ollama is unavailable; keeping the proven 1.5B Transformers fallback."
      }
    } catch {
      Write-Host "Adaptive model planning could not be applied: $($_.Exception.Message)"
      Write-Host "Continuing with the proven 1.5B fallback."
    }
  }
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
  "WINDOWS_TEXT_BACKEND" = $adaptiveBackend
  "WINDOWS_TEXT_FAST_MODEL_ID" = $adaptiveFastModel
  "WINDOWS_TEXT_QUALITY_MODEL_ID" = $adaptiveQualityModel
  "WINDOWS_TEXT_HEAVY_MODEL_ID" = $adaptiveHeavyModel
  "WINDOWS_VISION_MODEL_ID" = $adaptiveVisionModel
  "UNISON_LOCAL_CHAT_PORT" = "11436"
}

foreach ($entry in $values.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "User")
  Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value
}

$launcher = Join-Path $PSScriptRoot "start-unison-windows.ps1"
$hiddenLauncher = Join-Path $PSScriptRoot "start-unison-hidden.vbs"
$taskName = "CoOperative Unison Node"

$escapedLauncher = $launcher.Replace('"', '""')
$escapedQueueUrl = $QueueUrl.Replace('"', '""')
$escapedNodeName = $NodeName.Replace('"', '""')
$vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$escapedLauncher"" -QueueUrl ""$escapedQueueUrl"" -NodeName ""$escapedNodeName"" -IdleMinutes $IdleMinutes", 0, False
"@
Set-Content -Path $hiddenLauncher -Value $vbs -Encoding ASCII

$startupDir = [Environment]::GetFolderPath("Startup")
$startupLauncher = Join-Path $startupDir "CoOperative-Unison.vbs"
Copy-Item -Force $hiddenLauncher $startupLauncher

$legacyTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($legacyTask) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
}

$protocolRoot = "HKCU:\Software\Classes\cooperative-unison"
$commandKey = Join-Path $protocolRoot "shell\open\command"
New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:CoOperative Unison"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null

$control = Join-Path $PSScriptRoot "control-unison-windows.ps1"
$protocolCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$control`" `"%1`""
Set-Item -Path $commandKey -Value $protocolCommand

Write-Host ""
Write-Host "Unison node paired and installed."
Write-Host "Node ID: $existingNodeId"
Write-Host "Owner: $($pairing.ownerRef)"
Write-Host "Class: $($pairing.nodeClass)"
Write-Host "Startup: Windows Startup folder"
Write-Host "The worker will only claim new jobs after $IdleMinutes minute(s) of Windows inactivity."
Write-Host ""
Write-Host "Starting the node in the background..."
$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
& $wscript //B //Nologo $hiddenLauncher
Write-Host "Unison is installed and running in the background."
Write-Host "Log: $(Join-Path $PSScriptRoot 'unison.log')"
