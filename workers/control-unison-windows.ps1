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
    schtasks.exe /End /TN $taskName 2>$null | Out-Null
    Start-Sleep -Seconds 2
    schtasks.exe /Run /TN $taskName | Out-Null
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
