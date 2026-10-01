param(
  [string]$ExpectedNodeId = "",
  [string]$QueueUrl = "https://co-operative-mu.vercel.app",
  [string]$Revision = "main"
)

$ErrorActionPreference = "Stop"

function Get-UserEnv([string]$Name) {
  return [Environment]::GetEnvironmentVariable($Name, "User")
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

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Unison needs uv, and Windows Package Manager is not available to install it automatically."
  }

  Write-Host "Repairing runtime dependency..."
  winget install -e --id astral-sh.uv --accept-package-agreements --accept-source-agreements --silent

  $env:Path =
    [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [Environment]::GetEnvironmentVariable("Path", "User")

  $uvCandidate = Join-Path $env:USERPROFILE ".local\bin\uv.exe"
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
  "unison_runtime.py",
  "start-unison-windows.ps1",
  "control-unison-windows.ps1",
  "repair-unison-windows.ps1"
)

Write-Host "Refreshing CoOperative Unison files..."
foreach ($file in $workerFiles) {
  $target = Join-Path $installDir $file
  $temp = "$target.download"
  Invoke-WebRequest -Uri "$baseUrl/$file" -OutFile $temp -UseBasicParsing
  Move-Item -Force $temp $target
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

$taskCommand = "wscript.exe //B //Nologo `"$hiddenLauncher`""
schtasks.exe /Create /F /SC ONLOGON /TN $taskName /TR $taskCommand | Out-Null

$protocolRoot = "HKCU:\Software\Classes\cooperative-unison"
$commandKey = Join-Path $protocolRoot "shell\open\command"
New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:CoOperative Unison"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null

$control = Join-Path $installDir "control-unison-windows.ps1"
$protocolCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$control`" `"%1`""
Set-Item -Path $commandKey -Value $protocolCommand

Write-Host "Restarting Unison..."
schtasks.exe /End /TN $taskName 2>$null | Out-Null
Start-Sleep -Seconds 2
schtasks.exe /Run /TN $taskName | Out-Null

Write-Host ""
Write-Host "Repair complete."
Write-Host "Node: $nodeId"
Write-Host "Unison is starting in the background."
Write-Host "Return to the CoOperative dashboard and choose Refresh status."
