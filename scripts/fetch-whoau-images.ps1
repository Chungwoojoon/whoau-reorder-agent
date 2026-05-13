$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$dataPath = Join-Path $root "data\app-data.js"
$outPath = Join-Path $root "data\image-map.js"

$raw = Get-Content -LiteralPath $dataPath -Raw -Encoding UTF8
$json = ($raw -replace "^window\.REORDER_DATA = ", "") -replace ";\s*$", ""
$data = $json | ConvertFrom-Json
$styles = @($data.summary | Select-Object -ExpandProperty styleCode -Unique)
$map = [ordered]@{}

function Normalize-ImageUrl($url) {
  if (-not $url) { return "" }
  $clean = $url -replace "&amp;", "&"
  if ($clean.StartsWith("//")) { return "https:$clean" }
  if ($clean.StartsWith("/")) { return "https://m.whoau.com$clean" }
  return $clean
}

foreach ($style in $styles) {
  $encoded = [uri]::EscapeDataString($style)
  $searchUrl = "https://m.whoau.com/product/search.html?banner_action=&keyword=$encoded"
  try {
    $response = Invoke-WebRequest -Uri $searchUrl -UseBasicParsing -TimeoutSec 20 -Headers @{
      "User-Agent" = "Mozilla/5.0"
      "Accept-Language" = "ko-KR,ko;q=0.9,en;q=0.8"
    }
    $content = $response.Content
    $sectionStart = $content.IndexOf("xans-search-result")
    if ($sectionStart -lt 0) { $sectionStart = 0 }
    $section = $content.Substring($sectionStart, [Math]::Min(9000, $content.Length - $sectionStart))
    $match = [regex]::Match($section, '<a href="([^"]+)">\s*<img src="([^"]+)"', "IgnoreCase")
    if ($match.Success) {
      $href = $match.Groups[1].Value
      $image = Normalize-ImageUrl $match.Groups[2].Value
      $productUrl = if ($href.StartsWith("http")) { $href } else { "https://m.whoau.com$href" }
      $map[$style] = [ordered]@{
        imageUrl = $image
        productUrl = $productUrl
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
  source = "https://m.whoau.com/product/search.html"
  images = $map
}

$content = "window.WHOAU_IMAGE_MAP = " + ($payload | ConvertTo-Json -Depth 6 -Compress) + ";"
Set-Content -LiteralPath $outPath -Value $content -Encoding UTF8
Write-Host "Generated $outPath"
Write-Host "mapped=$($map.Count) requested=$($styles.Count)"
