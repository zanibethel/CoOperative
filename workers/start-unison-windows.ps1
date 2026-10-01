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
  $lines = @()
  if (Test-Path $Primary) {
    $lines = @(Get-Content $Primary -Tail 40 -ErrorAction SilentlyContinue)
  }
  if ($lines.Count -eq 0 -and (Test-Path $Fallback)) {
    $lines = @(Get-Content $Fallback -Tail 40 -ErrorAction SilentlyContinue)
  }

  $diagnostic = $lines |
    ForEach-Object { ($_ -replace "[\r\n]+", " " -replace "\s+", " ").Trim() } |
    Where-Object { $_ } |
    Select-Object -Last 1

  if ($diagnostic -and $diagnostic.Length -gt 140) {
    $diagnostic = $diagnostic.Substring(0, 140)
  }
  if (-not $diagnostic) {
    $diagnostic = "Worker exited with code $ExitCode."
  }
  return $diagnostic
}

function Start-TextRuntime([int]$MaxAttempts = 3) {
  $textWorkerPath = Join-Path $PSScriptRoot "windows-text-worker.py"

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Remove-Item -Force $textReadyPath,$textBusyPath -ErrorAction SilentlyContinue

    if ($attempt -gt 1) {
      Add-Content -Path $textErrorLogPath -Value "Retrying Windows text runtime startup (attempt $attempt of $MaxAttempts)."
      Start-Sleep -Seconds 3
    }

    $process = Start-Process `
      -FilePath $uvExe `
      -ArgumentList @("run", "`"$textWorkerPath`"") `
      -WorkingDirectory $PSScriptRoot `
      -RedirectStandardOutput $textLogPath `
      -RedirectStandardError $textErrorLogPath `
      -PassThru `
      -WindowStyle Hidden

    $startedAt = Get-Date
    $lastHeartbeat = Get-Date

    while (-not (Test-Path $textReadyPath) -and -not $process.HasExited) {
      Start-Sleep -Seconds 2
      $process.Refresh()

      if (((Get-Date) - $lastHeartbeat).TotalSeconds -ge 20) {
        Send-StartupHeartbeat -WorkerVersion "starting-windows-0.4" -Capabilities @(
          "startup_phase:text-runtime",
          "startup_attempt:$attempt"
        )
        $lastHeartbeat = Get-Date
      }

      if (((Get-Date) - $startedAt).TotalMinutes -ge 10) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        break
      }
    }

    if (-not $process.HasExited -and (Test-Path $textReadyPath)) {
      Start-Sleep -Seconds 2
      $process.Refresh()
      if (-not $process.HasExited) {
        return $process
      }
    }

    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }

    try { $process.WaitForExit() } catch {}
    $exitCode = 1
    try { $exitCode = $process.ExitCode } catch {}
    $diagnostic = Last-Diagnostic $textErrorLogPath $textLogPath $exitCode
    Add-Content -Path $textErrorLogPath -Value "Text runtime attempt $attempt exited: $diagnostic"

    Send-StartupHeartbeat `
      -WorkerVersion "starting-windows-0.4" `
      -Capabilities @(
        "startup_phase:text-runtime-retry",
        "startup_attempt:$attempt",
        "startup_error:$diagnostic"
      )
  }

  return $null
}

Write-Host "Starting CoOperative Unison node $($env:UNISON_NODE_ID)"
Write-Host "Idle-only mode: $IdleMinutes minute(s)"
Write-Host "Queue: $QueueUrl"
Write-Host "Log: $logPath"

Send-StartupHeartbeat -WorkerVersion "starting-windows-0.4" -Capabilities @("startup_phase:text-runtime")

$textProcess = Start-TextRuntime -MaxAttempts 3
if (-not $textProcess) {
  $diagnostic = Last-Diagnostic $textErrorLogPath $textLogPath 1
  Send-StartupHeartbeat `
    -WorkerVersion "startup-failed-windows-0.4" `
    -Capabilities @("startup_exit_code:1", "startup_error:$diagnostic") `
    -State "paused"
  exit 1
}

$textCapabilities = @(
  "text_generation",
  "text_fast_profile",
  "text_quality_profile",
  "async_queue"
)
Send-StartupHeartbeat -WorkerVersion "starting-windows-text-ready-0.5" -Capabilities $textCapabilities
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
      -WorkerVersion "starting-windows-0.4" `
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

# Capture which runtime actually exited before stopping its peer. The previous
# launcher stopped the healthy text worker first and then accidentally blamed it
# for an image-runtime exit, producing misleading diagnostics such as
# UNISON_TEXT_RUNTIME_STARTED.
$textExitedFirst = $textProcess.HasExited
$imageExitedFirst = $imageProcess.HasExited

if ($textExitedFirst) {
  $exitCode = $textProcess.ExitCode
  $diagnostic = Last-Diagnostic $textErrorLogPath $textLogPath $exitCode

  if (-not $imageProcess.HasExited) {
    Stop-Process -Id $imageProcess.Id -Force -ErrorAction SilentlyContinue
  }

  Send-StartupHeartbeat `
    -WorkerVersion "startup-failed-windows-0.5" `
    -Capabilities @("startup_exit_code:$exitCode", "startup_error:$diagnostic") `
    -State "paused"

  exit $exitCode
}

if ($imageExitedFirst) {
  $imageExitCode = $imageProcess.ExitCode
  $imageDiagnostic = Last-Diagnostic $errorLogPath $logPath $imageExitCode
  Add-Content -Path $errorLogPath -Value "Image runtime exited while text remained healthy: $imageDiagnostic"

  # Keep useful text compute online even when the image side needs repair.
  # The text worker continues enforcing idle-only policy before claiming jobs.
  $degradedCapabilities = @(
    "text_generation",
    "text_fast_profile",
    "text_quality_profile",
    "async_queue",
    "degraded:image-runtime",
    "image_error:$imageDiagnostic"
  )

  while (-not $textProcess.HasExited) {
    $state = if (Test-Path $textBusyPath) { "busy" } else { "online" }
    Send-StartupHeartbeat `
      -WorkerVersion "windows-unison-0.9.2-text-only" `
      -Capabilities $degradedCapabilities `
      -State $state

    Start-Sleep -Seconds 20
    $textProcess.Refresh()
  }

  $textExitCode = $textProcess.ExitCode
  $textDiagnostic = Last-Diagnostic $textErrorLogPath $textLogPath $textExitCode
  Send-StartupHeartbeat `
    -WorkerVersion "startup-failed-windows-0.5" `
    -Capabilities @("startup_exit_code:$textExitCode", "startup_error:$textDiagnostic") `
    -State "paused"

  exit $textExitCode
}

Send-StartupHeartbeat `
  -WorkerVersion "startup-failed-windows-0.5" `
  -Capabilities @("startup_error:Combined runtime ended unexpectedly") `
  -State "paused"
exit 1
