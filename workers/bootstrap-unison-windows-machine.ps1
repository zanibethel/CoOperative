param(
  [Parameter(Mandatory = $true)]
  [string]$PairCode,
  [string]$NodeName = $env:COMPUTERNAME,
  [int]$IdleMinutes = 5,
  [int]$MaxCpuPercent = 50,
  [int]$MaxGpuPercent = 80,
  [int]$MaxMemoryMb = 8192,
  [string]$QueueUrl = "https://co-operative-mu.vercel.app",
  [string]$Revision = "main"
)

$ErrorActionPreference = "Stop"

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

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Machine-wide Unison setup requires administrator approval."
}

$installDir = Join-Path $env:ProgramData "CoOperative\Unison"
$runtimeDir = Join-Path $installDir "runtime"
$uvDir = Join-Path $runtimeDir "uv"
$uvExe = Join-Path $uvDir "uv.exe"

New-Item -ItemType Directory -Force -Path $installDir,$runtimeDir,$uvDir | Out-Null
Protect-UnisonDirectory $installDir

if (-not (Test-Path $uvExe)) {
  Write-Host "Installing the shared Unison Python runtime..."
  $previousUnmanaged = $env:UV_UNMANAGED_INSTALL
  $previousNoModify = $env:UV_NO_MODIFY_PATH
  try {
    $env:UV_UNMANAGED_INSTALL = $uvDir
    $env:UV_NO_MODIFY_PATH = "1"
    Invoke-RestMethod "https://astral.sh/uv/install.ps1" | Invoke-Expression
  }
  finally {
    $env:UV_UNMANAGED_INSTALL = $previousUnmanaged
    $env:UV_NO_MODIFY_PATH = $previousNoModify
  }
}

if (-not (Test-Path $uvExe)) {
  throw "The shared uv runtime could not be installed."
}

$env:UV_CACHE_DIR = Join-Path $runtimeDir "uv-cache"
$env:UV_PYTHON_INSTALL_DIR = Join-Path $runtimeDir "python"
New-Item -ItemType Directory -Force -Path $env:UV_CACHE_DIR,$env:UV_PYTHON_INSTALL_DIR | Out-Null

$baseUrl = "https://raw.githubusercontent.com/zanibethel/CoOperative/$Revision/workers"
$workerFiles = @(
  "hf-image-worker.py",
  "windows-text-worker.py",
  "windows-local-chat.py",
  "windows-local-file-extract.py",
  "windows-local-voice.py",
  "windows-local-web-search.py",
  "windows-model-plan.py",
  "windows-text-benchmark.py",
  "unison_runtime.py",
  "start-unison-windows.ps1",
  "control-unison-windows.ps1",
  "repair-unison-windows-machine.ps1",
  "install-unison-windows-machine.ps1"
)

Write-Host "Downloading machine-wide Unison worker files..."
foreach ($file in $workerFiles) {
  Invoke-WebRequest -Uri "$baseUrl/$file" -OutFile (Join-Path $installDir $file) -UseBasicParsing
}

$installer = Join-Path $installDir "install-unison-windows-machine.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -PairCode $PairCode -QueueUrl $QueueUrl -NodeName $NodeName -IdleMinutes $IdleMinutes -MaxCpuPercent $MaxCpuPercent -MaxGpuPercent $MaxGpuPercent -MaxMemoryMb $MaxMemoryMb

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Machine-wide Unison bootstrap complete."
Write-Host "Install folder: $installDir"
Write-Host "The node runs independently of Windows user profiles."
