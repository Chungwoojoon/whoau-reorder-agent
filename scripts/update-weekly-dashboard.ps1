$ErrorActionPreference = "Stop"

$scriptRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $scriptRoot

Push-Location $projectRoot
try {
  npm.cmd run generate:daas
} finally {
  Pop-Location
}
& (Join-Path $scriptRoot "fetch-whoau-images.ps1")

Push-Location $projectRoot
try {
  npm.cmd run generate:review-insights
} finally {
  Pop-Location
}
