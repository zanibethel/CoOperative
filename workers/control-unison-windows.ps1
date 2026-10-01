param(
  [Parameter(Position = 0)]
  [string]$Uri = ""
)

$ErrorActionPreference = "Stop"

$installDir = Join-Path $env:LOCALAPPDATA "CoOperative\Unison"
$taskName = "CoOperative Unison Node"
$action = ""

if ($Uri -match "^cooperative-unison://([^/?#]+)") {
  $action = $Matches[1].ToLowerInvariant()
} elseif ($Uri) {
  $action = $Uri.ToLowerInvariant()
}

switch ($action) {
  "restart" {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.CommandLine -and
        $_.CommandLine -like "*CoOperative*Unison*" -and
        $_.CommandLine -like "*hf-image-worker.py*"
      } |
      ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }

    Start-Sleep -Seconds 1
    $launcher = Join-Path $installDir "start-unison-hidden.vbs"
    if (-not (Test-Path $launcher)) {
      throw "The Unison launcher is missing. Run Repair connection first."
    }

    $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
    & $wscript //B //Nologo $launcher
  }
  "repair" {
    $repair = Join-Path $installDir "repair-unison-windows.ps1"
    if (-not (Test-Path $repair)) {
      throw "The Unison repair tool is missing. Download Repair connection from the dashboard."
    }

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $repair
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }
  default {
    throw "Unknown CoOperative Unison action."
  }
}
