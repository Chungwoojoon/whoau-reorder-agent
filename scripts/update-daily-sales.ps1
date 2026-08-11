$ErrorActionPreference = "Stop"

$scriptRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $scriptRoot
$logDir = Join-Path $projectRoot "logs"
$logPath = Join-Path $logDir "daily-sales-update.log"

if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Write-Log {
  param([string]$Message)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

function Sync-GitIfClean {
  Invoke-Checked "git" @("fetch", "origin", "main")
  $dirty = -not (git diff --quiet) -or -not (git diff --cached --quiet) -or [bool](git ls-files --others --exclude-standard)
  if ($dirty) {
    Write-Log "Skipped git pull because local working tree has uncommitted changes."
    return
  }
  Invoke-Checked "git" @("pull", "--rebase", "origin", "main")
}

$today = (Get-Date).DayOfWeek
if ($today -eq "Saturday" -or $today -eq "Sunday") {
  Write-Log "Skipped daily sales update on weekend."
  exit 0
}

Push-Location $projectRoot
try {
  Write-Log "Daily sales update started."
  Sync-GitIfClean
  Invoke-Checked "node" @("scripts\generate-daily-sales-data.mjs")
  Write-Log "Daily sales data generation finished."
  try {
    & (Join-Path $scriptRoot "fetch-whoau-images.ps1")
    Write-Log "WHO.A.U image update finished."
  } catch {
    Write-Log "WHO.A.U image update failed and was skipped: $($_.Exception.Message)"
  }

  Invoke-Checked "git" @("add", "data/daily-sales-data.js", "data/image-map.js")
  $hasChanges = -not (git diff --cached --quiet)
  if ($hasChanges) {
    Invoke-Checked "git" @("commit", "-m", "Update daily sales data")
    Invoke-Checked "git" @("push", "origin", "main")
    Write-Log "Daily sales data changes committed and pushed."
  } else {
    Write-Log "No daily sales data changes to commit."
  }

  $vercel = Get-Command vercel.cmd -ErrorAction SilentlyContinue
  if ($vercel) {
    Invoke-Checked "vercel.cmd" @("--prod", "--yes")
    Write-Log "Vercel production deployment completed."
  } else {
    Write-Log "vercel.cmd was not found; skipped deployment."
  }

  Write-Log "Daily sales update finished."
} finally {
  Pop-Location
}
