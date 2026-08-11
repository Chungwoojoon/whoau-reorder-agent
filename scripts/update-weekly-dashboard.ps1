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
  Sync-GitIfClean
  Invoke-Checked "node" @("scripts\generate-daas-data.mjs")
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
  Invoke-Checked "node" @("scripts\fetch-review-insights.mjs")
  Write-Log "Review insight update finished."

  Write-SalesStatus "success"
  Invoke-Checked "git" @("add", "data/app-data.js", "data/image-map.js", "data/review-insights.js", "data/sales-update-status.json")
  $hasChanges = -not (git diff --cached --quiet)
  if ($hasChanges) {
    Invoke-Checked "git" @("commit", "-m", "Update weekly sales dashboard data")
    Invoke-Checked "git" @("push", "origin", "main")
    Write-Log "Sales data changes committed and pushed."
  } else {
    Write-Log "No sales data changes to commit."
  }

  $vercel = Get-Command vercel.cmd -ErrorAction SilentlyContinue
  if ($vercel) {
    Invoke-Checked "vercel.cmd" @("--prod", "--yes")
    Write-Log "Vercel production deployment completed."
  } else {
    Write-Log "vercel.cmd was not found; skipped deployment."
  }

  Write-Log "Weekly sales update finished."
} finally {
  Pop-Location
}
