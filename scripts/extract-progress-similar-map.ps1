$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$outJson = Join-Path $root "data\progress-similar-map.json"
$outJs = Join-Path $root "data\progress-similar-map.js"

$files = @(
  "C:\Users\chung_woojoon01\Downloads\26SS 진행판_티셔츠맨투맨_260429(1).xlsx",
  "C:\Users\chung_woojoon01\Downloads\26SS 진행판_하의_260414(1).xlsx",
  "C:\Users\chung_woojoon01\Downloads\26SS 진행판_아우터_260202xlsx (2)(1).xlsx",
  "C:\Users\chung_woojoon01\Downloads\26SS 진행판_잡화_260427(1).xlsx",
  "C:\Users\chung_woojoon01\Downloads\26SS 진행판_스웨터(4-6P)_260507(1).xlsx",
  "C:\Users\chung_woojoon01\Downloads\26SS 진행판_셔츠,원피스_260414(1).xlsx"
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipText($zip, $entryName) {
  $entry = $zip.GetEntry($entryName)
  if (-not $entry) { return "" }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}

function ColumnIndex($cellRef) {
  $letters = ([regex]::Match($cellRef, "^[A-Z]+")).Value
  $n = 0
  foreach ($ch in $letters.ToCharArray()) { $n = ($n * 26) + ([int][char]$ch - [int][char]'A' + 1) }
  return $n
}

function Read-SharedStrings($zip) {
  $text = Read-ZipText $zip "xl/sharedStrings.xml"
  if (-not $text) { return @() }
  $xml = [xml]$text
  $strings = @()
  foreach ($si in $xml.sst.si) {
    if ($si.t) {
      $strings += [string]$si.t
    } else {
      $parts = @()
      foreach ($r in $si.r) { if ($r.t) { $parts += [string]$r.t } }
      $strings += ($parts -join "")
    }
  }
  return $strings
}

function CellValue($cell, $sharedStrings) {
  if ($cell.t -eq "s") {
    $idx = [int]$cell.v
    if ($idx -ge 0 -and $idx -lt $sharedStrings.Count) { return $sharedStrings[$idx] }
    return ""
  }
  if ($cell.t -eq "inlineStr") { return [string]$cell.is.t }
  if ($cell.v) { return [string]$cell.v }
  return ""
}

function Read-SheetRows($zip, $sheetPath, $sharedStrings) {
  $text = Read-ZipText $zip $sheetPath
  if (-not $text) { return @{} }
  $xml = [xml]$text
  $rows = @{}
  foreach ($row in $xml.worksheet.sheetData.row) {
    $rowNum = [int]$row.r
    $map = @{}
    foreach ($cell in $row.c) {
      $col = ColumnIndex $cell.r
      $value = CellValue $cell $sharedStrings
      if ($value) { $map[$col] = $value.Trim() }
    }
    if ($map.Count -gt 0) { $rows[$rowNum] = $map }
  }
  return $rows
}

function Read-SheetMap($zip) {
  $wb = [xml](Read-ZipText $zip "xl/workbook.xml")
  $rels = [xml](Read-ZipText $zip "xl/_rels/workbook.xml.rels")
  $relMap = @{}
  foreach ($rel in $rels.Relationships.Relationship) {
    $relMap[$rel.Id] = "xl/" + $rel.Target.TrimStart("/")
  }
  $sheets = @()
  foreach ($sheet in $wb.workbook.sheets.sheet) {
    $rid = $sheet.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
    if ($relMap.ContainsKey($rid)) {
      $sheets += [ordered]@{ name = [string]$sheet.name; path = $relMap[$rid] }
    }
  }
  return $sheets
}

function Is-CurrentStyle($code) {
  if ($code -notmatch "^WH[A-Z0-9]{7,}$") { return $false }
  return $code.Length -ge 5 -and $code.Substring(4, 1) -eq "G"
}

function Is-PriorStyle($code) {
  return $code -match "^WH[A-Z0-9]{7,}$" -and -not (Is-CurrentStyle $code)
}

$mapping = [ordered]@{}
$evidence = @()

foreach ($file in $files) {
  if (-not (Test-Path $file)) { continue }
  Write-Host "Scanning $([IO.Path]::GetFileName($file))"
  $zip = [System.IO.Compression.ZipFile]::OpenRead($file)
  try {
    $sharedStrings = @(Read-SharedStrings $zip)
    $sheets = @(Read-SheetMap $zip)
    foreach ($sheet in $sheets) {
      $rows = Read-SheetRows $zip $sheet.path $sharedStrings
      if ($rows.Count -eq 0) { continue }
      foreach ($rowKey in $rows.Keys) {
        $rowNum = [int]$rowKey
        foreach ($colKey in $rows[$rowNum].Keys) {
          $colNum = [int]($colKey | Select-Object -First 1)
          $current = [string]$rows[$rowNum][$colNum]
          if (-not (Is-CurrentStyle $current)) { continue }
          $prior = ""
          if ($rows.ContainsKey($rowNum + 1) -and $rows[$rowNum + 1].ContainsKey($colNum)) {
            $candidate = [string]$rows[$rowNum + 1][$colNum]
            if (Is-PriorStyle $candidate) { $prior = $candidate }
          }
          if (-not $prior) {
            foreach ($lookCol in @(($colNum - 1), ($colNum + 1), ($colNum + 2))) {
              if ($rows.ContainsKey($rowNum + 1) -and $rows[$rowNum + 1].ContainsKey($lookCol)) {
                $candidate = [string]$rows[$rowNum + 1][$lookCol]
                if (Is-PriorStyle $candidate) { $prior = $candidate; break }
              }
            }
          }
          if ($prior) {
            if (-not $mapping.Contains($current)) {
              $mapping[$current] = $prior
            }
            $evidence += [ordered]@{
              currentStyle = $current
              priorStyle = $prior
              file = [IO.Path]::GetFileName($file)
              sheet = $sheet.name
              row = $rowNum
              col = $colNum
            }
          }
        }
      }
    }
  } finally {
    $zip.Dispose()
  }
}

$payload = [ordered]@{
  generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  count = $mapping.Count
  map = $mapping
  evidence = $evidence
}

$json = $payload | ConvertTo-Json -Depth 8
Set-Content -LiteralPath $outJson -Value $json -Encoding UTF8
Set-Content -LiteralPath $outJs -Value ("window.PROGRESS_SIMILAR_MAP = " + ($payload | ConvertTo-Json -Depth 8 -Compress) + ";") -Encoding UTF8
Write-Host "Generated $outJson"
Write-Host "mapped=$($mapping.Count) evidence=$($evidence.Count)"
