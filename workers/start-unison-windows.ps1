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
  "WORKER_BIND_HOST",
  "WINDOWS_TEXT_FAST_MODEL_ID",
  "WINDOWS_TEXT_QUALITY_MODEL_ID"
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

$logPath = Join-Path $PSScriptRoot "unison.log"
$errorLogPath = Join-Path $PSScriptRoot "unison-error.log"
$textLogPath = Join-Path $PSScriptRoot "unison-text.log"
$textErrorLogPath = Join-Path $PSScriptRoot "unison-text-error.log"
$textReadyPath = Join-Path $PSScriptRoot "text-worker.ready"
$textBusyPath = Join-Path $PSScriptRoot "text-worker.busy"

Remove-Item -Force $textReadyPath,$textBusyPath -ErrorAction SilentlyContinue

function Send-StartupHeartbeat(
  [string]$WorkerVersion,
  [string[]]$Capabilities = @(),
  [string]$State = "online"
) {
  try {
    $allowImage = $Capabilities -contains "image_generation"
    $allowText = $Capabilities -contains "text_generation"
    $heartbeat = @{
      nodeId = $env:UNISON_NODE_ID
      displayName = $NodeName
      ownerRef = $(if ($env:UNISON_NODE_OWNER_REF) { $env:UNISON_NODE_OWNER_REF } else { "platform-private" })
      nodeClass = $(if ($env:UNISON_NODE_CLASS) { $env:UNISON_NODE_CLASS } else { "private" })
      state = $State
      platform = @{
        system = "Windows"
        release = [Environment]::OSVersion.VersionString
        machine = $env:PROCESSOR_ARCHITECTURE
      }
      capabilities = $Capabilities
      resources = @{}
      policy = @{
        idleOnly = $true
        idleThresholdSeconds = [Math]::Max(0, $IdleMinutes) * 60
        allowImage = $allowImage
        allowText = $allowText
      }
      workerVersion = $WorkerVersion
    } | ConvertTo-Json -Depth 6

    Invoke-RestMethod `
      -Method Post `
      -Uri "$QueueUrl/api/unison/nodes/heartbeat" `
      -Headers @{ Authorization = "Bearer $($env:UNISON_NODE_TOKEN)" } `
      -ContentType "application/json" `
      -Body $heartbeat | Out-Null
  } catch {
    Add-Content -Path $errorLogPath -Value "Heartbeat report failed: $($_.Exception.Message)"
  }
}

function Last-Diagnostic([string]$Primary, [string]$Fallback, [int]$ExitCode) {
  $tail = ""
  if (Test-Path $Primary) {
    $tail = (Get-Content $Primary -Tail 12 -ErrorAction SilentlyContinue) -join " | "
  }
  if (-not $tail -and (Test-Path $Fallback)) {
    $tail = (Get-Content $Fallback -Tail 12 -ErrorAction SilentlyContinue) -join " | "
  }
  $diagnostic = ($tail -replace "[\r\n]+", " " -replace "\s+", " ").Trim()
  if ($diagnostic.Length -gt 95) {
    $diagnostic = $diagnostic.Substring(0, 95)
  }
  if (-not $diagnostic) {
    $diagnostic = "Worker exited with code $ExitCode."
  }
  return $diagnostic
}

Write-Host "Starting CoOperative Unison node $($env:UNISON_NODE_ID)"
Write-Host "Idle-only mode: $IdleMinutes minute(s)"
Write-Host "Queue: $QueueUrl"
Write-Host "Log: $logPath"

Send-StartupHeartbeat -WorkerVersion "starting-windows-0.3" -Capabilities @("startup_phase:text-runtime")

$textWorkerPath = Join-Path $PSScriptRoot "windows-text-worker.py"
$textProcess = Start-Process `
  -FilePath $uvExe `
  -ArgumentList @("run", "`"$textWorkerPath`"") `
  -WorkingDirectory $PSScriptRoot `
  -RedirectStandardOutput $textLogPath `
  -RedirectStandardError $textErrorLogPath `
  -PassThru `
  -WindowStyle Hidden

$textStartedAt = Get-Date
$lastStartingHeartbeat = Get-Date
while (-not (Test-Path $textReadyPath) -and -not $textProcess.HasExited) {
  Start-Sleep -Seconds 3
  $textProcess.Refresh()

  if (((Get-Date) - $lastStartingHeartbeat).TotalSeconds -ge 20) {
    Send-StartupHeartbeat -WorkerVersion "starting-windows-0.3" -Capabilities @("startup_phase:text-runtime")
    $lastStartingHeartbeat = Get-Date
  }

  if (((Get-Date) - $textStartedAt).TotalMinutes -ge 10) {
    Stop-Process -Id $textProcess.Id -Force -ErrorAction SilentlyContinue
    Send-StartupHeartbeat `
      -WorkerVersion "startup-failed-windows-0.3" `
      -Capabilities @("startup_error:Text runtime startup timed out") `
      -State "paused"
    exit 1
  }
}

if ($textProcess.HasExited) {
  $diagnostic = Last-Diagnostic $textErrorLogPath $textLogPath $textProcess.ExitCode
  Send-StartupHeartbeat `
    -WorkerVersion "startup-failed-windows-0.3" `
    -Capabilities @("startup_exit_code:$($textProcess.ExitCode)", "startup_error:$diagnostic") `
    -State "paused"
  exit $textProcess.ExitCode
}

$textCapabilities = @(
  "text_generation",
  "text_fast_profile",
  "text_quality_profile",
  "async_queue"
)
Send-StartupHeartbeat -WorkerVersion "starting-windows-text-ready-0.3" -Capabilities $textCapabilities
Write-Host "Windows text runtime started."

$imageWorkerPath = Join-Path $PSScriptRoot "hf-image-worker.py"
$imageProcess = Start-Process `
  -FilePath $uvExe `
  -ArgumentList @("run", "`"$imageWorkerPath`"") `
  -WorkingDirectory $PSScriptRoot `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errorLogPath `
  -PassThru `
  -WindowStyle Hidden

$runtimeStarted = $false
$lastStartingHeartbeat = Get-Date

while (-not $imageProcess.HasExited -and -not $textProcess.HasExited) {
  Start-Sleep -Seconds 3
  $imageProcess.Refresh()
  $textProcess.Refresh()

  if (-not $runtimeStarted -and (Test-Path $logPath)) {
    $runtimeStarted = Select-String `
      -Path $logPath `
      -Pattern "UNISON_RUNTIME_STARTED" `
      -SimpleMatch `
      -Quiet `
      -ErrorAction SilentlyContinue

    if ($runtimeStarted) {
      Write-Host "Image runtime started. Combined Unison heartbeats are now active."
    }
  }

  if (-not $runtimeStarted -and ((Get-Date) - $lastStartingHeartbeat).TotalSeconds -ge 20) {
    Send-StartupHeartbeat `
      -WorkerVersion "starting-windows-0.3" `
      -Capabilities @(
        "text_generation",
        "text_fast_profile",
        "text_quality_profile",
        "async_queue",
        "startup_phase:image-runtime"
      )
    $lastStartingHeartbeat = Get-Date
  }
}

if (-not $imageProcess.HasExited) {
  Stop-Process -Id $imageProcess.Id -Force -ErrorAction SilentlyContinue
}
if (-not $textProcess.HasExited) {
  Stop-Process -Id $textProcess.Id -Force -ErrorAction SilentlyContinue
}

$failedProcess = if ($textProcess.HasExited) { $textProcess } else { $imageProcess }
$primaryError = if ($textProcess.HasExited) { $textErrorLogPath } else { $errorLogPath }
$fallbackLog = if ($textProcess.HasExited) { $textLogPath } else { $logPath }
$exitCode = $failedProcess.ExitCode
$diagnostic = Last-Diagnostic $primaryError $fallbackLog $exitCode

Send-StartupHeartbeat `
  -WorkerVersion "startup-failed-windows-0.3" `
  -Capabilities @("startup_exit_code:$exitCode", "startup_error:$diagnostic") `
  -State "paused"

exit $exitCode
