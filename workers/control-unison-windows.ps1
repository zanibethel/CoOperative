param(
  [Parameter(Position = 0)]
  [string]$Uri = ""
)

$ErrorActionPreference = "Stop"

$machineNodeId = [Environment]::GetEnvironmentVariable("UNISON_NODE_ID", "Machine")
$machineWide = -not [string]::IsNullOrWhiteSpace($machineNodeId)
$installDir = if ($machineWide) {
  Join-Path $env:ProgramData "CoOperative\Unison"
} else {
  Join-Path $env:LOCALAPPDATA "CoOperative\Unison"
}
$taskName = if ($machineWide) { "CoOperative Unison Machine Node" } else { "CoOperative Unison Node" }
$action = ""

if ($Uri -match "^cooperative-unison://([^/?#]+)") {
  $action = $Matches[1].ToLowerInvariant()
} elseif ($Uri) {
  $action = $Uri.ToLowerInvariant()
}

if ($machineWide) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    $self = $MyInvocation.MyCommand.Path
    $argsLine = '-NoProfile -ExecutionPolicy Bypass -File "{0}" "{1}"' -f $self,$Uri
    $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $argsLine -Wait -PassThru
    exit $process.ExitCode
  }
}

switch ($action) {
  "restart" {
    if ($machineWide) {
      Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
          $_.CommandLine -and (
            $_.CommandLine -like "*hf-image-worker.py*" -or
            $_.CommandLine -like "*windows-text-worker.py*" -or
            $_.CommandLine -like "*start-unison-windows.ps1*"
          )
        } |
        ForEach-Object {
          Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }

      Start-Sleep -Seconds 1
      Start-ScheduledTask -TaskName $taskName
      break
    }

    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.CommandLine -and
        $_.CommandLine -like "*CoOperative*Unison*" -and
        (
          $_.CommandLine -like "*hf-image-worker.py*" -or
          $_.CommandLine -like "*windows-text-worker.py*" -or
          $_.CommandLine -like "*start-unison-windows.ps1*"
        )
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
    $repairName = if ($machineWide) { "repair-unison-windows-machine.ps1" } else { "repair-unison-windows.ps1" }
    $repair = Join-Path $installDir $repairName
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
