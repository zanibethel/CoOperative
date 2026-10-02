param(
  [string]$ExpectedNodeId = "",
  [string]$QueueUrl = "https://co-operative-mu.vercel.app",
  [string]$Revision = "main"
)

$ErrorActionPreference = "Stop"

$machineNodeId = [Environment]::GetEnvironmentVariable("UNISON_NODE_ID", "Machine")
if ($machineNodeId) {
  if ($ExpectedNodeId -and $machineNodeId -ne $ExpectedNodeId) {
    throw "This repair targets node '$ExpectedNodeId', but this PC is paired machine-wide as '$machineNodeId'."
  }

  $machineRepair = Join-Path $env:TEMP "repair-cooperative-unison-machine.ps1"
  Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/zanibethel/CoOperative/$Revision/workers/repair-unison-windows-machine.ps1" -OutFile $machineRepair
  $argsLine = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -ExpectedNodeId "{1}" -QueueUrl "{2}" -Revision "{3}"' -f $machineRepair,$machineNodeId,$QueueUrl,$Revision
  $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $argsLine -Wait -PassThru
  exit $process.ExitCode
}

function Get-UserEnv([string]$Name) {
  return [Environment]::GetEnvironmentVariable($Name, "User")
}

function Set-UserEnv([string]$Name, [string]$Value) {
  [Environment]::SetEnvironmentVariable($Name, $Value, "User")
  Set-Item -Path "Env:$Name" -Value $Value
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

$installDir = Join-Path $env:LOCALAPPDATA "CoOperative\Unison"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

$nodeId = Get-UserEnv "UNISON_NODE_ID"
$nodeToken = Get-UserEnv "UNISON_NODE_TOKEN"

if (-not $nodeId -or -not $nodeToken) {
  throw "This Windows profile does not have a paired Unison node credential. Reinstall Unison from the CoOperative dashboard."
}

if ($ExpectedNodeId -and $nodeId -ne $ExpectedNodeId) {
  throw "This repair file targets node '$ExpectedNodeId', but this PC is paired as '$nodeId'. Open the dashboard on the intended PC."
}

$uvCandidate = Join-Path $env:USERPROFILE ".local\bin\uv.exe"
if (-not (Get-Command uv -ErrorAction SilentlyContinue) -and (Test-Path $uvCandidate)) {
  $uvDir = Split-Path $uvCandidate
  $env:Path = "$uvDir;$env:Path"
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Unison needs uv, and Windows Package Manager is not available to install it automatically."
  }

  Write-Host "Repairing runtime dependency..."
  winget install -e --id astral-sh.uv --accept-package-agreements --accept-source-agreements --silent

  $env:Path =
    [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [Environment]::GetEnvironmentVariable("Path", "User")

  if (-not (Get-Command uv -ErrorAction SilentlyContinue) -and (Test-Path $uvCandidate)) {
    $uvDir = Split-Path $uvCandidate
    $env:Path = "$uvDir;$env:Path"
  }
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw "uv could not be made available. Restart Windows and run Repair connection again."
}

$baseUrl = "https://raw.githubusercontent.com/zanibethel/CoOperative/$Revision/workers"
$workerFiles = @(
  "hf-image-worker.py",
  "windows-text-worker.py",
  "windows-local-chat.py",
  "windows-model-plan.py",
  "unison_runtime.py",
  "start-unison-windows.ps1",
  "control-unison-windows.ps1",
  "repair-unison-windows.ps1"
)

Write-Host "Refreshing CoOperative Unison files..."
$stageDir = Join-Path $installDir (".update-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

try {
  # Download the complete bundle before replacing any live file. This prevents a
  # failed network request from leaving an old/new mixed worker installation.
  foreach ($file in $workerFiles) {
    $staged = Join-Path $stageDir $file
    Invoke-WebRequest -Uri "$baseUrl/$file" -OutFile $staged -UseBasicParsing

    if (-not (Test-Path $staged) -or (Get-Item $staged).Length -le 0) {
      throw "Downloaded Unison worker file '$file' was empty or missing."
    }
  }

  foreach ($file in $workerFiles) {
    $staged = Join-Path $stageDir $file
    $target = Join-Path $installDir $file
    Move-Item -Force $staged $target
  }
}
finally {
  Remove-Item -Recurse -Force $stageDir -ErrorAction SilentlyContinue
}

$modelPlanner = Join-Path $installDir "windows-model-plan.py"
$modelPlanPath = Join-Path $installDir "text-model-plan.json"
if (Test-Path $modelPlanner) {
  Write-Host "Refreshing adaptive local AI plan..."
  & uv run $modelPlanner | Out-Null
  if (Test-Path $modelPlanPath) {
    try {
      $plan = Get-Content $modelPlanPath -Raw | ConvertFrom-Json
      $ollama = Find-Ollama

      if (-not $ollama -and (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host "Installing quantized local AI runtime..."
        winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent
        $env:Path =
          [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
          [Environment]::GetEnvironmentVariable("Path", "User")
        $ollama = Find-Ollama
      }

      if ($ollama) {
        Set-UserEnv "WINDOWS_TEXT_BACKEND" "ollama"
        Set-UserEnv "WINDOWS_TEXT_FAST_MODEL_ID" ([string]$plan.models.fast)
        Set-UserEnv "WINDOWS_TEXT_QUALITY_MODEL_ID" ([string]$plan.models.quality)
        Set-UserEnv "WINDOWS_TEXT_HEAVY_MODEL_ID" ([string]$plan.models.heavy)
        if ($plan.models.vision) { Set-UserEnv "WINDOWS_VISION_MODEL_ID" ([string]$plan.models.vision) }
        Write-Host "Adaptive text plan ready: Fast=$($plan.models.fast) Quality=$($plan.models.quality) Heavy=$($plan.models.heavy)"
      } else {
        Write-Host "Ollama is unavailable; preserving the current safe text backend."
      }
    } catch {
      Write-Host "Adaptive text planning warning: $($_.Exception.Message)"
    }
  }
}

$nodeName = Get-UserEnv "UNISON_NODE_NAME"
if (-not $nodeName) { $nodeName = $env:COMPUTERNAME }

$storedQueue = Get-UserEnv "COOPERATIVE_QUEUE_URL"
if ($storedQueue) { $QueueUrl = $storedQueue }

$idleSeconds = Get-UserEnv "UNISON_IDLE_THRESHOLD_SECONDS"
$idleMinutes = 5
if ($idleSeconds) {
  $parsedIdle = 0
  if ([int]::TryParse($idleSeconds, [ref]$parsedIdle)) {
    $idleMinutes = [Math]::Max(0, [Math]::Round($parsedIdle / 60))
  }
}

$launcher = Join-Path $installDir "start-unison-windows.ps1"
$hiddenLauncher = Join-Path $installDir "start-unison-hidden.vbs"
$taskName = "CoOperative Unison Node"

$escapedLauncher = $launcher.Replace('"', '""')
$escapedQueueUrl = $QueueUrl.Replace('"', '""')
$escapedNodeName = $nodeName.Replace('"', '""')
$vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$escapedLauncher"" -QueueUrl ""$escapedQueueUrl"" -NodeName ""$escapedNodeName"" -IdleMinutes $idleMinutes", 0, False
"@
Set-Content -Path $hiddenLauncher -Value $vbs -Encoding ASCII

$startupDir = [Environment]::GetFolderPath("Startup")
$startupLauncher = Join-Path $startupDir "CoOperative-Unison.vbs"
Copy-Item -Force $hiddenLauncher $startupLauncher

# Remove the older scheduled-task startup path only when it actually exists.
# A missing legacy task is normal and must never abort repair.
$legacyTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($legacyTask) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
}

$protocolRoot = "HKCU:\Software\Classes\cooperative-unison"
$commandKey = Join-Path $protocolRoot "shell\open\command"
New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:CoOperative Unison"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null

$control = Join-Path $installDir "control-unison-windows.ps1"
$protocolCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$control`" `"%1`""
Set-Item -Path $commandKey -Value $protocolCommand

Write-Host "Restarting Unison..."

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine -like "*CoOperative*Unison*" -and
    (
      $_.CommandLine -like "*hf-image-worker.py*" -or
      $_.CommandLine -like "*windows-text-worker.py*" -or
      $_.CommandLine -like "*windows-local-chat.py*" -or
      $_.CommandLine -like "*start-unison-windows.ps1*"
    )
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Start-Sleep -Seconds 1
$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
& $wscript //B //Nologo $hiddenLauncher

Write-Host ""
Write-Host "Repair complete."
Write-Host "Node: $nodeId"
Write-Host "Unison is starting in the background."
Write-Host "Return to the CoOperative dashboard and choose Refresh status."
