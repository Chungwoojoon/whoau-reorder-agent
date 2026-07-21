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

$today = (Get-Date).DayOfWeek
if ($today -eq "Saturday" -or $today -eq "Sunday") {
  Write-Log "Skipped daily sales update on weekend."
  exit 0
}

Push-Location $projectRoot
try {
  Write-Log "Daily sales update started."
  git pull --rebase origin main
  npm.cmd run generate:daily-sales
  & (Join-Path $scriptRoot "fetch-whoau-images.ps1")

  git add data/daily-sales-data.js data/image-map.js
  $hasChanges = -not (git diff --cached --quiet)
  if ($hasChanges) {
    git commit -m "Update daily sales data"
    git push origin main
    Write-Log "Daily sales data changes committed and pushed."
  } else {
    Write-Log "No daily sales data changes to commit."
  }

  $vercel = Get-Command vercel.cmd -ErrorAction SilentlyContinue
  if ($vercel) {
    vercel.cmd --prod --yes
    Write-Log "Vercel production deployment completed."
  } else {
    Write-Log "vercel.cmd was not found; skipped deployment."
  }

  Write-Log "Daily sales update finished."
} finally {
  Pop-Location
}
