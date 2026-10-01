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

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Machine-wide Unison setup requires administrator approval."
}

function Set-MachineEnv([string]$Name, [string]$Value) {
  [Environment]::SetEnvironmentVariable($Name, $Value, "Machine")
  Set-Item -Path "Env:$Name" -Value $Value
}

function Protect-UnisonDirectory([string]$Path) {
  $systemSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-18")
  $adminsSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
  $usersSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-545")
  $inherit = [Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit"
  $none = [Security.AccessControl.PropagationFlags]::None
  $allow = [Security.AccessControl.AccessControlType]::Allow

  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, "FullControl", $inherit, $none, $allow))
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($adminsSid, "FullControl", $inherit, $none, $allow))
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($usersSid, "ReadAndExecute", $inherit, $none, $allow))
  Set-Acl -Path $Path -AclObject $acl
}

function Protect-CredentialFile([string]$Path) {
  $systemSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-18")
  $adminsSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
  $allow = [Security.AccessControl.AccessControlType]::Allow
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, "FullControl", $allow))
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($adminsSid, "FullControl", $allow))
  Set-Acl -Path $Path -AclObject $acl
}

$installDir = Join-Path $env:ProgramData "CoOperative\Unison"
$runtimeDir = Join-Path $installDir "runtime"
$uvExe = Join-Path $runtimeDir "uv\uv.exe"
$modelPlanner = Join-Path $installDir "windows-model-plan.py"
$modelPlanPath = Join-Path $installDir "text-model-plan.json"
$modelsDir = Join-Path $installDir "models"
$ollamaDir = Join-Path $runtimeDir "ollama"
$taskName = "CoOperative Unison Machine Node"

New-Item -ItemType Directory -Force -Path $installDir,$runtimeDir,$modelsDir | Out-Null
Protect-UnisonDirectory $installDir

if (-not (Test-Path $uvExe)) {
  throw "The shared Unison uv runtime is missing."
}

$existingNodeId = [Environment]::GetEnvironmentVariable("UNISON_NODE_ID", "Machine")
if (-not $existingNodeId) {
  $safeComputer = ($env:COMPUTERNAME -replace '[^A-Za-z0-9._:-]', '-').ToLowerInvariant()
  $existingNodeId = "$safeComputer-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
}

Write-Host "Pairing this PC as a machine-wide Unison node..."
$pairBody = @{
  pairingCode = $PairCode
  nodeId = $existingNodeId
  displayName = $NodeName
} | ConvertTo-Json

try {
  $pairing = Invoke-RestMethod -Method Post -Uri "$QueueUrl/api/unison/nodes/pair" -ContentType "application/json" -Body $pairBody
} catch {
  $detail = $_.ErrorDetails.Message
  if ($detail) { throw "Unison pairing failed: $detail" }
  throw
}

$nodeToken = [string]$pairing.nodeToken
if (-not $nodeToken) {
  throw "Pairing succeeded without a node credential. Installation stopped."
}

$env:UV_CACHE_DIR = Join-Path $runtimeDir "uv-cache"
$env:UV_PYTHON_INSTALL_DIR = Join-Path $runtimeDir "python"
New-Item -ItemType Directory -Force -Path $env:UV_CACHE_DIR,$env:UV_PYTHON_INSTALL_DIR | Out-Null

$adaptiveBackend = "transformers"
$adaptiveFastModel = "Qwen/Qwen2.5-1.5B-Instruct"
$adaptiveQualityModel = $adaptiveFastModel
$adaptiveHeavyModel = $adaptiveFastModel

if (Test-Path $modelPlanner) {
  Write-Host "Profiling this PC for its local AI model plan..."
  & $uvExe run $modelPlanner | Out-Null
  if (Test-Path $modelPlanPath) {
    $plan = Get-Content $modelPlanPath -Raw | ConvertFrom-Json
    $adaptiveFastModel = [string]$plan.models.fast
    $adaptiveQualityModel = [string]$plan.models.quality
    $adaptiveHeavyModel = [string]$plan.models.heavy
  }
}

$ollamaExe = Get-ChildItem -Path $ollamaDir -Filter "ollama.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName

if (-not $ollamaExe) {
  try {
    Write-Host "Installing the shared quantized AI runtime..."
    $asset = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "ollama-windows-arm64.zip" } else { "ollama-windows-amd64.zip" }
    $zip = Join-Path $env:TEMP $asset
    Invoke-WebRequest -Uri "https://github.com/ollama/ollama/releases/latest/download/$asset" -OutFile $zip -UseBasicParsing
    if (Test-Path $ollamaDir) { Remove-Item -Recurse -Force $ollamaDir }
    New-Item -ItemType Directory -Force -Path $ollamaDir | Out-Null
    Expand-Archive -Path $zip -DestinationPath $ollamaDir -Force
    Remove-Item -Force $zip -ErrorAction SilentlyContinue
    $ollamaExe = Get-ChildItem -Path $ollamaDir -Filter "ollama.exe" -Recurse | Select-Object -First 1 -ExpandProperty FullName
  } catch {
    Write-Host "Shared Ollama install warning: $($_.Exception.Message)"
  }
}

if ($ollamaExe) {
  $adaptiveBackend = "ollama"
  Write-Host "Adaptive text plan: Fast=$adaptiveFastModel Quality=$adaptiveQualityModel Heavy=$adaptiveHeavyModel"
} else {
  Write-Host "Quantized runtime unavailable; using the proven 1.5B fallback until repair can add it."
  $adaptiveFastModel = "Qwen/Qwen2.5-1.5B-Instruct"
  $adaptiveQualityModel = $adaptiveFastModel
  $adaptiveHeavyModel = $adaptiveFastModel
}

$credentialPath = Join-Path $installDir "node-credential.json"
@{
  nodeId = $existingNodeId
  nodeToken = $nodeToken
  ownerRef = [string]$pairing.ownerRef
  nodeClass = [string]$pairing.nodeClass
} | ConvertTo-Json | Set-Content -Path $credentialPath -Encoding UTF8
Protect-CredentialFile $credentialPath

# Never place the machine credential in a user-readable environment variable.
[Environment]::SetEnvironmentVariable("UNISON_NODE_TOKEN", $null, "Machine")
[Environment]::SetEnvironmentVariable("UNISON_NODE_OWNER_REF", $null, "Machine")

$values = @{
  "UNISON_NODE_ID" = $existingNodeId
  "UNISON_NODE_NAME" = $NodeName
  "UNISON_NODE_CLASS" = [string]$pairing.nodeClass
  "UNISON_CREDENTIAL_PATH" = $credentialPath
  "UNISON_INSTALL_SCOPE" = "machine"
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
  "UNISON_LOCAL_CHAT_PORT" = "11436"
  "UNISON_SHARED_UV_EXE" = $uvExe
  "UV_CACHE_DIR" = $env:UV_CACHE_DIR
  "UV_PYTHON_INSTALL_DIR" = $env:UV_PYTHON_INSTALL_DIR
  "OLLAMA_MODELS" = $modelsDir
  "UNISON_OLLAMA_URL" = "http://127.0.0.1:11435"
  "OLLAMA_HOST" = "127.0.0.1:11435"
}

if ($ollamaExe) {
  $values["UNISON_OLLAMA_EXE"] = $ollamaExe
}

foreach ($entry in $values.GetEnumerator()) {
  Set-MachineEnv $entry.Key ([string]$entry.Value)
}

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -like "*hf-image-worker.py*" -or
      $_.CommandLine -like "*windows-text-worker.py*" -or
      $_.CommandLine -like "*start-unison-windows.ps1*"
    )
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Get-ChildItem -Path (Join-Path $env:SystemDrive "Users") -Directory -ErrorAction SilentlyContinue |
  ForEach-Object {
    $legacy = Join-Path $_.FullName "AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\CoOperative-Unison.vbs"
    Remove-Item -Force $legacy -ErrorAction SilentlyContinue
  }

$launcher = Join-Path $installDir "start-unison-windows.ps1"
$argument = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -QueueUrl "{1}" -NodeName "{2}" -IdleMinutes {3}' -f $launcher,$QueueUrl,$NodeName,$IdleMinutes
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Description "CoOperative Unison machine-wide idle compute node" | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Verifying the machine-wide heartbeat..."
$verified = $false
$deadline = (Get-Date).AddMinutes(12)
while ((Get-Date) -lt $deadline) {
  try {
    $status = Invoke-RestMethod -Method Post -Uri "$QueueUrl/api/unison/nodes/self-status" -Headers @{ Authorization = "Bearer $nodeToken" } -ContentType "application/json" -Body (@{ nodeId = $existingNodeId } | ConvertTo-Json)
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
    Write-Host "Waiting for verified machine-wide heartbeat: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 4
}

if (-not $verified) {
  throw "Machine-wide Unison started, but a verified whole-PC-idle heartbeat was not received in time."
}

Write-Host ""
Write-Host "Machine-wide Unison node installed and verified."
Write-Host "Node ID: $existingNodeId"
Write-Host "Owner: $($pairing.ownerRef)"
Write-Host "Startup: Windows SYSTEM scheduled task"
Write-Host "Idle policy: the whole PC must be idle for $IdleMinutes minute(s)."
Write-Host "Install folder: $installDir"
