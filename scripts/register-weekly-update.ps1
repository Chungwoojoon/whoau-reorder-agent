$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = "WHOAU Weekly Top 10 Data Update"
$updateScript = Join-Path $PSScriptRoot "update-weekly-dashboard.ps1"

if (-not (Test-Path -LiteralPath $updateScript)) {
  throw "Weekly update script was not found: $updateScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$updateScript`"" `
  -WorkingDirectory $projectRoot

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 8:00am
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Refreshes WHO.A.U weekly sales Top 20 data and official whoau.com images every Monday at 08:00." `
  -Force | Out-Null

Write-Host "Registered scheduled task: $taskName"
Write-Host "Schedule: every Monday at 08:00"
Write-Host "Script: $updateScript"
