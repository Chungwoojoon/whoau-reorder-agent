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
  $publishRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("whoau-daily-publish-" + (Get-Date -Format "yyyyMMddHHmmss"))
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
    Invoke-Checked "git" @("worktree", "remove", "--force", $publishRoot)
    Invoke-Checked "git" @("worktree", "prune")
  }
}

$today = (Get-Date).DayOfWeek
if ($today -eq "Saturday" -or $today -eq "Sunday") {
  Write-Log "Skipped daily sales update on weekend."
  exit 0
}

Push-Location $projectRoot
try {
  Write-Log "Daily sales update started."
  Invoke-Checked "node" @("scripts\generate-daily-sales-data.mjs")
  Write-Log "Daily sales data generation finished."
  try {
    & (Join-Path $scriptRoot "fetch-whoau-images.ps1")
    Write-Log "WHO.A.U image update finished."
  } catch {
    Write-Log "WHO.A.U image update failed and was skipped: $($_.Exception.Message)"
  }

  Publish-DataFiles @("data\daily-sales-data.js", "data\image-map.js") "Update daily sales data"

  Write-Log "Daily sales update finished."
} finally {
  Pop-Location
}
