param(
  [string]$ExpectedNodeId = "",
  [string]$QueueUrl = "https://co-operative-mu.vercel.app",
  [string]$Revision = "main"
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Machine-wide Unison repair requires administrator approval."
}

function Get-MachineEnv([string]$Name) {
  return [Environment]::GetEnvironmentVariable($Name, "Machine")
}

function Set-MachineEnv([string]$Name, [string]$Value) {
  [Environment]::SetEnvironmentVariable($Name, $Value, "Machine")
  Set-Item -Path "Env:$Name" -Value $Value
}

$installDir = Join-Path $env:ProgramData "CoOperative\Unison"
$runtimeDir = Join-Path $installDir "runtime"
$uvExe = Get-MachineEnv "UNISON_SHARED_UV_EXE"
$taskName = "CoOperative Unison Machine Node"

$credentialPath = Get-MachineEnv "UNISON_CREDENTIAL_PATH"
if (-not $credentialPath) {
  $credentialPath = Join-Path $installDir "node-credential.json"
}
if (-not (Test-Path $credentialPath)) {
  throw "This PC does not have a protected machine-wide Unison credential."
}
$credential = Get-Content $credentialPath -Raw | ConvertFrom-Json
$nodeId = [string]$credential.nodeId
$nodeToken = [string]$credential.nodeToken
if (-not $nodeId -or -not $nodeToken) {
  throw "The protected machine-wide Unison credential is incomplete."
}
if ($ExpectedNodeId -and $nodeId -ne $ExpectedNodeId) {
  throw "This repair targets node '$ExpectedNodeId', but this PC is paired as '$nodeId'."
}
if (-not $uvExe -or -not (Test-Path $uvExe)) {
  throw "The shared Unison runtime is missing. Reinstall the machine-wide setup."
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
  "repair-unison-windows-machine.ps1",
  "install-unison-windows-machine.ps1"
)

$stageDir = Join-Path $installDir (".update-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
try {
  Write-Host "Refreshing machine-wide Unison files..."
  foreach ($file in $workerFiles) {
    $staged = Join-Path $stageDir $file
    Invoke-WebRequest -Uri "$baseUrl/$file" -OutFile $staged -UseBasicParsing
    if (-not (Test-Path $staged) -or (Get-Item $staged).Length -le 0) {
      throw "Downloaded Unison worker file '$file' was empty or missing."
    }
  }

  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -like "*hf-image-worker.py*" -or
        $_.CommandLine -like "*windows-text-worker.py*" -or
        $_.CommandLine -like "*start-unison-windows.ps1*"
      )
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  foreach ($file in $workerFiles) {
    Move-Item -Force (Join-Path $stageDir $file) (Join-Path $installDir $file)
  }
}
finally {
  Remove-Item -Recurse -Force $stageDir -ErrorAction SilentlyContinue
}

$env:UV_CACHE_DIR = Get-MachineEnv "UV_CACHE_DIR"
$env:UV_PYTHON_INSTALL_DIR = Get-MachineEnv "UV_PYTHON_INSTALL_DIR"
$modelPlanner = Join-Path $installDir "windows-model-plan.py"
$modelPlanPath = Join-Path $installDir "text-model-plan.json"
if (Test-Path $modelPlanner) {
  Write-Host "Refreshing adaptive model plan..."
  & $uvExe run $modelPlanner | Out-Null
  if (Test-Path $modelPlanPath) {
    $plan = Get-Content $modelPlanPath -Raw | ConvertFrom-Json
    Set-MachineEnv "WINDOWS_TEXT_FAST_MODEL_ID" ([string]$plan.models.fast)
    Set-MachineEnv "WINDOWS_TEXT_QUALITY_MODEL_ID" ([string]$plan.models.quality)
    Set-MachineEnv "WINDOWS_TEXT_HEAVY_MODEL_ID" ([string]$plan.models.heavy)
  }
}

$ollamaExe = Get-MachineEnv "UNISON_OLLAMA_EXE"
if (-not $ollamaExe -or -not (Test-Path $ollamaExe)) {
  try {
    Write-Host "Repairing shared quantized AI runtime..."
    $ollamaDir = Join-Path $runtimeDir "ollama"
    $asset = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "ollama-windows-arm64.zip" } else { "ollama-windows-amd64.zip" }
    $zip = Join-Path $env:TEMP $asset
    Invoke-WebRequest -Uri "https://github.com/ollama/ollama/releases/latest/download/$asset" -OutFile $zip -UseBasicParsing
    if (Test-Path $ollamaDir) { Remove-Item -Recurse -Force $ollamaDir }
    New-Item -ItemType Directory -Force -Path $ollamaDir | Out-Null
    Expand-Archive -Path $zip -DestinationPath $ollamaDir -Force
    Remove-Item -Force $zip -ErrorAction SilentlyContinue
    $ollamaExe = Get-ChildItem -Path $ollamaDir -Filter "ollama.exe" -Recurse | Select-Object -First 1 -ExpandProperty FullName
    Set-MachineEnv "UNISON_OLLAMA_EXE" $ollamaExe
    Set-MachineEnv "WINDOWS_TEXT_BACKEND" "ollama"
  } catch {
    Write-Host "Shared Ollama repair warning: $($_.Exception.Message)"
  }
}

$nodeName = Get-MachineEnv "UNISON_NODE_NAME"
if (-not $nodeName) { $nodeName = $env:COMPUTERNAME }
$storedQueue = Get-MachineEnv "COOPERATIVE_QUEUE_URL"
if ($storedQueue) { $QueueUrl = $storedQueue }
$idleSeconds = Get-MachineEnv "UNISON_IDLE_THRESHOLD_SECONDS"
$idleMinutes = 5
if ($idleSeconds) {
  $parsedIdle = 0
  if ([int]::TryParse($idleSeconds, [ref]$parsedIdle)) {
    $idleMinutes = [Math]::Max(0, [Math]::Round($parsedIdle / 60))
  }
}

$launcher = Join-Path $installDir "start-unison-windows.ps1"
$argument = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -QueueUrl "{1}" -NodeName "{2}" -IdleMinutes {3}' -f $launcher,$QueueUrl,$nodeName,$idleMinutes
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Description "CoOperative Unison machine-wide idle compute node" | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Verifying repaired machine-wide heartbeat..."
$verified = $false
$deadline = (Get-Date).AddMinutes(12)
while ((Get-Date) -lt $deadline) {
  try {
    $status = Invoke-RestMethod -Method Post -Uri "$QueueUrl/api/unison/nodes/self-status" -Headers @{ Authorization = "Bearer $nodeToken" } -ContentType "application/json" -Body (@{ nodeId = $nodeId } | ConvertTo-Json)
    $caps = @($status.capabilities)
    if ([string]$status.workerVersion -like "startup-failed-*") {
      $startupError = $caps | Where-Object { $_ -like "startup_error:*" } | Select-Object -First 1
      if ($startupError) { throw $startupError.Substring("startup_error:".Length) }
      throw "The machine-wide worker reported a startup failure."
    }
    if (
      $status.fresh -eq $true -and
      [string]$status.workerVersion -like "windows-unison-1.*" -and
      $caps -contains "text_generation" -and
      $caps -contains "machine_wide" -and
      $caps -contains "whole_pc_idle"
    ) {
      $verified = $true
      break
    }
  } catch {
    Write-Host "Waiting for repaired machine-wide heartbeat: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 4
}

if (-not $verified) {
  throw "Machine-wide repair restarted Unison, but a verified whole-PC-idle heartbeat was not received in time."
}

Write-Host ""
Write-Host "Machine-wide Unison repair complete and verified."
Write-Host "Node: $nodeId"
Write-Host "Whole-PC idle detection remains enabled."
