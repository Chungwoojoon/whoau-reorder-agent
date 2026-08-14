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

function Copy-IfExists {
  param(
    [string]$Source,
    [string]$Destination
  )
  if (Test-Path -LiteralPath $Source) {
    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parent)) {
      New-Item -ItemType Directory -Path $parent | Out-Null
    }
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
  }
}

function Publish-DataFiles {
  param(
    [string[]]$RelativePaths,
    [string]$CommitMessage
  )

  Invoke-Checked "git" @("fetch", "origin", "main")
  $publishRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("whoau-weekly-publish-" + (Get-Date -Format "yyyyMMddHHmmss"))
  Invoke-Checked "git" @("worktree", "add", "--detach", $publishRoot, "origin/main")

  try {
    foreach ($relativePath in $RelativePaths) {
      Copy-IfExists (Join-Path $projectRoot $relativePath) (Join-Path $publishRoot $relativePath)
    }
    Copy-IfExists (Join-Path $projectRoot ".vercel\project.json") (Join-Path $publishRoot ".vercel\project.json")
    Copy-IfExists (Join-Path $projectRoot ".vercel\README.txt") (Join-Path $publishRoot ".vercel\README.txt")

    Push-Location $publishRoot
    try {
      Invoke-Checked "git" (@("add") + $RelativePaths)
      $hasChanges = -not (git diff --cached --quiet)
      if ($hasChanges) {
        Invoke-Checked "git" @("commit", "-m", $CommitMessage)
        Invoke-Checked "git" @("push", "origin", "HEAD:main")
        Write-Log "Data changes committed and pushed from clean publish worktree."
      } else {
        Write-Log "No data changes to commit."
      }

      $vercel = Get-Command vercel.cmd -ErrorAction SilentlyContinue
      if ($vercel) {
        Invoke-Checked "vercel.cmd" @("--prod", "--yes")
        Write-Log "Vercel production deployment completed."
      } else {
        Write-Log "vercel.cmd was not found; skipped deployment."
      }
    } finally {
      Pop-Location
    }
  } finally {
    try {
      & git @("worktree", "remove", "--force", $publishRoot) 2>&1 | ForEach-Object { Write-Log $_ }
      if ($LASTEXITCODE -ne 0) {
        Write-Log "Warning: failed to remove publish worktree. This does not affect the completed update."
      }
      & git @("worktree", "prune") 2>&1 | ForEach-Object { Write-Log $_ }
      if ($LASTEXITCODE -ne 0) {
        Write-Log "Warning: failed to prune worktrees. This does not affect the completed update."
      }
    } catch {
      Write-Log "Warning: publish worktree cleanup failed. This does not affect the completed update. $($_.Exception.Message)"
    }
  }
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
  Publish-DataFiles @("data\app-data.js", "data\image-map.js", "data\review-insights.js", "data\sales-update-status.json") "Update weekly sales dashboard data"

  Write-Log "Weekly sales update finished."
} finally {
  Pop-Location
}
