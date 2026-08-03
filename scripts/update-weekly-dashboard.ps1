$ErrorActionPreference = "Stop"

$scriptRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $scriptRoot
$logDir = Join-Path $projectRoot "logs"
$logPath = Join-Path $logDir "weekly-sales-update.log"
$statusPath = Join-Path $projectRoot "data\sales-update-status.json"

if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Write-Log {
  param([string]$Message)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Write-SalesStatus {
  param([string]$Status)
  $payload = [ordered]@{
    status = $Status
    businessDate = (Get-Date).ToString("yyyy-MM-dd")
    updatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    source = "local-windows-scheduler"
  }
  $json = $payload | ConvertTo-Json -Depth 3
  [System.IO.File]::WriteAllText($statusPath, $json, [System.Text.UTF8Encoding]::new($false))
}

Push-Location $projectRoot
try {
  Write-Log "Weekly update started."
  git pull --rebase origin main
  npm.cmd run generate:daas
  Write-Log "Weekly sales data generation finished."
} finally {
  Pop-Location
}

try {
  & (Join-Path $scriptRoot "fetch-whoau-images.ps1")
  Write-Log "WHO.A.U image update finished."
} catch {
  Write-Log "WHO.A.U image update failed and was skipped: $($_.Exception.Message)"
}

Push-Location $projectRoot
try {
  Write-Log "Review insight update started after weekly sales data."
  npm.cmd run generate:review-insights
  Write-Log "Review insight update finished."

  Write-SalesStatus "success"
  git add data/app-data.js data/image-map.js data/review-insights.js
  git add data/sales-update-status.json
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
