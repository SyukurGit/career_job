param(
  [ValidateSet("Register", "Unregister", "Status")]
  [string]$Action = "Status",
  [string]$Time = "08:00",
  [string]$TaskName = "DreamkurJobDailyScan"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$NodeExe = (Get-Command node -ErrorAction Stop).Source
$ScanScript = Join-Path $Root "scan.mjs"

if (-not (Test-Path $ScanScript)) {
  throw "scan.mjs tidak ditemukan di $ScanScript"
}

switch ($Action) {
  "Status" {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
      Write-Output "Status: Belum terdaftar ($TaskName)."
      Write-Output "Untuk mengaktifkan scan harian pukul $Time WIB:"
      Write-Output "  pwsh -File `"$PSCommandPath`" -Action Register -Time `"$Time`""
    } else {
      $info = Get-ScheduledTaskInfo -TaskName $TaskName
      Write-Output "Status: Terdaftar ($TaskName) - State=$($task.State) NextRun=$($info.NextRunTime) LastResult=$($info.LastTaskResult)"
    }
  }
  "Register" {
    $parsedTime = [DateTime]::ParseExact($Time, "HH:mm", [System.Globalization.CultureInfo]::InvariantCulture)
    $trigger = New-ScheduledTaskTrigger -Daily -At $parsedTime
    $taskAction = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$ScanScript`" --fresh" -WorkingDirectory $Root
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Trigger $trigger -Action $taskAction -Settings $settings -Description "dreamkur -job: Scan lowongan harian otomatis (Aceh & Remote)" -Force | Out-Null
    Write-Output "Berhasil mendaftarkan task '$TaskName' setiap hari pukul $Time WIB."
  }
  "Unregister" {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Task '$TaskName' telah dihapus."
  }
}
