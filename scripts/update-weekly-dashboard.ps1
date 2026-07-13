$ErrorActionPreference = "Stop"

$scriptRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $scriptRoot
$logDir = Join-Path $projectRoot "logs"
$logPath = Join-Path $logDir "weekly-sales-update.log"

if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Write-Log {
  param([string]$Message)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

Push-Location $projectRoot
try {
  Write-Log "Weekly update started."
  git pull --rebase origin main
  npm.cmd run generate:daas
} finally {
  Pop-Location
}

& (Join-Path $scriptRoot "fetch-whoau-images.ps1")

Push-Location $projectRoot
try {
  git add data/app-data.js data/image-map.js
  $hasChanges = -not (git diff --cached --quiet)
  if ($hasChanges) {
    git commit -m "Update weekly sales dashboard data"
    git push origin main
    Write-Log "Sales data changes committed and pushed."
  } else {
    Write-Log "No sales data changes to commit."
  }

  $vercel = Get-Command vercel.cmd -ErrorAction SilentlyContinue
  if ($vercel) {
    vercel.cmd --prod --yes
    Write-Log "Vercel production deployment completed."
  } else {
    Write-Log "vercel.cmd was not found; skipped deployment."
  }

  Write-Log "Weekly sales update finished."
} finally {
  Pop-Location
}
