$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$dataPath = Join-Path $root "data\app-data.js"
$outPath = Join-Path $root "data\image-map.js"

$raw = Get-Content -LiteralPath $dataPath -Raw -Encoding UTF8
$json = ($raw -replace "^window\.REORDER_DATA = ", "") -replace ";\s*$", ""
$data = $json | ConvertFrom-Json
$itemGroups = @(
  @{ id = "all"; codes = $null },
  @{ id = "outer"; codes = @("JD", "JE", "JJ", "JK", "JL", "JP", "JT", "JW", "VW") },
  @{ id = "knitTop"; codes = @("HA", "HS", "HW", "LA", "LS", "LW", "MA", "MH", "MW", "MZ", "RA", "RN", "RP", "RS", "RW") },
  @{ id = "sweater"; codes = @("CK", "KA", "KV", "KW") },
  @{ id = "shirt"; codes = @("BL", "YA", "YC", "YJ", "YS", "YW") },
  @{ id = "bottom"; codes = @("TA", "TC", "TH", "TJ", "TM") },
  @{ id = "skirt"; codes = @("OJ", "OM", "ON", "OW", "WH", "WJ", "WK", "WM") },
  @{ id = "knitBottom"; codes = @("TM") },
  @{ id = "wovenBottom"; codes = @("TA", "TC", "TH") },
  @{ id = "denimBottom"; codes = @("TJ") },
  @{ id = "goods"; codes = @("AB", "AC", "AG", "AK", "AM", "AP", "AQ", "AR", "AW", "AY", "BG", "BM", "HM", "PG", "PP") }
)
$metrics = @("weeklyQty", "weeklyAmount", "weeklyRate", "normalQty", "normalAmount", "normalRate")
$needed = [ordered]@{}

function Get-ItemCode($styleCode) {
  $text = [string]$styleCode
  if ($text.Length -lt 4) { return "" }
  return $text.Substring(2, 2).ToUpperInvariant()
}

function Get-WeekRow($style) {
  $label = [string]$data.latestWeekLabel
  $weekly = @($style.weekly)
  $exact = @($weekly | Where-Object { $_.label -eq $label } | Select-Object -First 1)
  if ($exact.Count -gt 0) { return $exact[0] }
  if ($weekly.Count -gt 0) { return $weekly[-1] }
  return [pscustomobject]@{ actualQty = 0; normalQty = 0 }
}

foreach ($group in $itemGroups) {
  $rows = @()
  foreach ($style in @($data.styles)) {
    $itemCode = Get-ItemCode $style.styleCode
    if ($group.codes -and -not ($group.codes -contains $itemCode)) { continue }
    $week = Get-WeekRow $style
    $weeklyQty = if ($null -ne $week.actualQty) { [double]$week.actualQty } else { 0.0 }
    $normalQty = if ($null -ne $week.normalQty) { [double]$week.normalQty } else { 0.0 }
    $weeklyAmount = if ($null -ne $week.salesAmount) { [double]$week.salesAmount } else { 0.0 }
    $normalAmount = if ($null -ne $week.normalAmount) { [double]$week.normalAmount } else { 0.0 }
    $inboundQty = if ($null -ne $style.inboundQty) { [double]$style.inboundQty } else { 0.0 }
    $rows += [pscustomobject]@{
      styleCode = [string]$style.styleCode
      weeklyQty = $weeklyQty
      weeklyAmount = $weeklyAmount
      weeklyRate = if ($inboundQty -gt 0) { $weeklyQty / $inboundQty } else { 0 }
      normalQty = $normalQty
      normalAmount = $normalAmount
      normalRate = if ($inboundQty -gt 0) { $normalQty / $inboundQty } else { 0 }
    }
  }
  foreach ($metric in $metrics) {
    $top = @($rows | Sort-Object @{ Expression = $metric; Descending = $true }, @{ Expression = "weeklyQty"; Descending = $true } | Select-Object -First 10)
    foreach ($row in $top) {
      if ($row.styleCode -and -not $needed.Contains($row.styleCode)) { $needed[$row.styleCode] = $true }
    }
  }
}

$styles = @($needed.Keys)
$map = [ordered]@{}

function Normalize-ImageUrl($url) {
  if (-not $url) { return "" }
  $clean = $url -replace "&amp;", "&"
  if ($clean.StartsWith("//")) { return "https:$clean" }
  if ($clean.StartsWith("/")) { return "https://whoau.com$clean" }
  return $clean
}

foreach ($style in $styles) {
  $encoded = [uri]::EscapeDataString($style)
  $searchUrl = "https://whoau.com/product/search.html?banner_action=&keyword=$encoded"
  try {
    $response = Invoke-WebRequest -Uri $searchUrl -UseBasicParsing -TimeoutSec 20 -Headers @{
      "User-Agent" = "Mozilla/5.0"
      "Accept-Language" = "ko-KR,ko;q=0.9,en;q=0.8"
    }
    $content = $response.Content
    $sectionStart = $content.IndexOf("xans-search-result")
    if ($sectionStart -lt 0) { $sectionStart = 0 }
    $section = $content.Substring($sectionStart, [Math]::Min(9000, $content.Length - $sectionStart))
    $match = [regex]::Match($section, '<a href="([^"]+)"[^>]*>\s*<img[^>]*class="origin"[^>]*src="([^"]+)"', "IgnoreCase")
    if (-not $match.Success) {
      $match = [regex]::Match($section, '<a href="([^"]+)"[^>]*>\s*<img[^>]*src="([^"]+)"', "IgnoreCase")
    }
    if ($match.Success) {
      $href = $match.Groups[1].Value
      $image = Normalize-ImageUrl $match.Groups[2].Value
      $productUrl = if ($href.StartsWith("http")) { $href -replace "^https://m\.whoau\.com", "https://whoau.com" } else { "https://whoau.com$href" }
      $map[$style] = [ordered]@{
        imageUrl = $image
        productUrl = $productUrl
        source = $searchUrl
      }
      Write-Host "OK $style"
    } else {
      Write-Host "MISS $style"
    }
  } catch {
    Write-Host "ERR $style $($_.Exception.Message)"
  }
  Start-Sleep -Milliseconds 80
}

$payload = [ordered]@{
  generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  source = "https://whoau.com/product/search.html"
  images = $map
}

$content = "window.WHOAU_IMAGE_MAP = " + ($payload | ConvertTo-Json -Depth 6 -Compress) + ";"
Set-Content -LiteralPath $outPath -Value $content -Encoding UTF8
Write-Host "Generated $outPath"
Write-Host "mapped=$($map.Count) requested=$($styles.Count)"
