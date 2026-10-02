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

$installDir = Join-Path $env:LOCALAPPDATA "CoOperative\Unison"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Neither uv nor winget is available. Install uv, then rerun this bootstrap."
  }

  Write-Host "Installing uv..."
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
  throw "uv installation completed but uv is not available in PATH yet. Open a new PowerShell window and rerun the bootstrap."
}

Write-Host "Ensuring Git is available for Recovery Agent..."
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    try {
      winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements --silent | Out-Null
      $env:Path =
        [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
        [Environment]::GetEnvironmentVariable("Path", "User")
    } catch {
      Write-Host "Git install warning: $($_.Exception.Message)"
    }
  }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Recovery Agent warning: Git is unavailable, so repository repair will stay disabled until Git is installed."
}

$baseUrl = "https://raw.githubusercontent.com/zanibethel/CoOperative/$Revision/workers"
$workerFiles = @(
  "hf-image-worker.py",
  "repo-agent-worker.py",
  "windows-text-worker.py",
  "windows-local-chat.py",
  "windows-local-file-extract.py",
  "windows-local-voice.py",
  "windows-local-web-search.py",
  "windows-model-plan.py",
  "windows-text-benchmark.py",
  "unison_runtime.py",
  "start-unison-windows.ps1",
  "install-unison-windows.ps1",
  "control-unison-windows.ps1",
  "repair-unison-windows.ps1"
)

Write-Host "Downloading CoOperative Unison worker files..."
foreach ($file in $workerFiles) {
  Invoke-WebRequest `
    -Uri "$baseUrl/$file" `
    -OutFile (Join-Path $installDir $file) `
    -UseBasicParsing
}

$installer = Join-Path $installDir "install-unison-windows.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer `
  -PairCode $PairCode `
  -QueueUrl $QueueUrl `
  -NodeName $NodeName `
  -IdleMinutes $IdleMinutes `
  -MaxCpuPercent $MaxCpuPercent `
  -MaxGpuPercent $MaxGpuPercent `
  -MaxMemoryMb $MaxMemoryMb

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host "Install folder: $installDir"
Write-Host "Log: $(Join-Path $installDir 'unison.log')"
