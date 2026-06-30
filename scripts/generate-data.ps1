$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$sourceDir = "C:\Users\chung_woojoon01\Downloads\후아유 데이터"
$weeklyWorkbookPath = Join-Path $sourceDir "후아유 주차별 데이터(2).xlsx"
$skuWorkbookPath = Join-Path $sourceDir "컬러별, 사이즈별 소진(2).xlsx"
$progressMapPath = Join-Path (Split-Path -Parent $PSScriptRoot) "data\progress-similar-map.json"
$productionPath = Join-Path $sourceDir "후아유 생산정보.csv"
$legacySalesPath = Join-Path $sourceDir "후아유 주차별 매출.csv"
$costWorkbookPath = "C:\Users\chung_woojoon01\Desktop\스판재(S) (16-31-17)(1).xlsx"
$outPath = Join-Path (Split-Path -Parent $PSScriptRoot) "data\app-data.js"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function To-Number($value) {
  if ($null -eq $value -or $value -eq "") { return 0.0 }
  if ($value -is [double] -or $value -is [int] -or $value -is [decimal]) { return [double]$value }
  $text = ([string]$value).Replace(",", "").Trim()
  if ($text -eq "" -or $text -eq "#") { return 0.0 }
  $num = 0.0
  if ([double]::TryParse($text, [ref]$num)) { return $num }
  return 0.0
}

function Normalize-Name($value) {
  $text = ([string]$value).ToLowerInvariant()
  $text = $text -replace "\[[^\]]*\]", ""
  $text = $text -replace "\(공홈단독\)|공홈단독", ""
  $text = $text -replace "\([^)]*\)", ""
  $text = $text -replace "[^a-z0-9가-힣]+", " "
  $text = $text -replace "\s+", " "
  return $text.Trim()
}

function Get-Tokens($value) {
  $name = Normalize-Name $value
  if (-not $name) { return @() }
  return @($name.Split(" ") | Where-Object { $_.Length -ge 2 })
}

function Similarity($a, $b) {
  $ta = if ($a -is [System.Collections.IDictionary] -and $a.Contains("tokens")) { @($a.tokens) } else { @(Get-Tokens $a) }
  $tb = if ($b -is [System.Collections.IDictionary] -and $b.Contains("tokens")) { @($b.tokens) } else { @(Get-Tokens $b) }
  if ($ta.Count -eq 0 -or $tb.Count -eq 0) { return 0.0 }
  $setA = @{}; foreach ($t in $ta) { $setA[$t] = 1 }
  $setB = @{}; foreach ($t in $tb) { $setB[$t] = 1 }
  $intersection = 0
  foreach ($t in $setA.Keys) { if ($setB.ContainsKey($t)) { $intersection++ } }
  $union = @{}; foreach ($t in $setA.Keys) { $union[$t] = 1 }; foreach ($t in $setB.Keys) { $union[$t] = 1 }
  return $intersection / [Math]::Max(1, $union.Count)
}

function ColumnIndex($cellRef) {
  $letters = ([regex]::Match($cellRef, "^[A-Z]+")).Value
  $n = 0
  foreach ($ch in $letters.ToCharArray()) { $n = ($n * 26) + ([int][char]$ch - [int][char]'A' + 1) }
  return $n
}

function Read-ZipText($zip, $entryName) {
  $entry = $zip.GetEntry($entryName)
  if (-not $entry) { throw "Missing xlsx entry: $entryName" }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}

function Read-SharedStrings($zip) {
  $entry = $zip.GetEntry("xl/sharedStrings.xml")
  if (-not $entry) { return @() }
  $xml = [xml](Read-ZipText $zip "xl/sharedStrings.xml")
  $strings = @()
  foreach ($si in $xml.GetElementsByTagName("si")) {
    $textNodes = @($si.GetElementsByTagName("t"))
    if ($textNodes.Count -eq 1) {
      $strings += [string]$textNodes[0].InnerText
    } else {
      $parts = @()
      foreach ($t in $textNodes) { $parts += [string]$t.InnerText }
      $strings += ($parts -join "")
    }
  }
  return $strings
}

function CellValue($cell, $sharedStrings) {
  $type = if ($cell -is [System.Xml.XmlElement]) { $cell.GetAttribute("t") } else { [string]$cell.t }
  $vNode = @($cell.GetElementsByTagName("v") | Select-Object -First 1)
  $value = if ($vNode.Count -gt 0) { [string]$vNode[0].InnerText } elseif ($cell.v) { [string]$cell.v } else { "" }
  if ($type -eq "s") {
    $idx = [int]$value
    if ($idx -ge 0 -and $idx -lt $sharedStrings.Count) { return $sharedStrings[$idx] }
    return ""
  }
  if ($type -eq "inlineStr") {
    $parts = @()
    foreach ($t in $cell.GetElementsByTagName("t")) { $parts += [string]$t.InnerText }
    return ($parts -join "")
  }
  return $value
}

function Read-SheetRows($zip, $sheetPath, $sharedStrings) {
  $xml = [xml](Read-ZipText $zip $sheetPath)
  $rows = @{}
  foreach ($row in $xml.GetElementsByTagName("row")) {
    $rowNum = [int]$row.GetAttribute("r")
    $map = @{}
    foreach ($cell in $row.GetElementsByTagName("c")) {
      $col = ColumnIndex $cell.GetAttribute("r")
      $map[$col] = CellValue $cell $sharedStrings
    }
    $rows[$rowNum] = $map
  }
  return $rows
}

function Get-Cell($rows, [int]$row, [int]$col) {
  if ($rows.ContainsKey($row) -and $rows[$row].ContainsKey($col)) { return $rows[$row][$col] }
  return ""
}

function Find-MetricStart($rows, $metricName, [int]$maxCol) {
  for ($c = 1; $c -le $maxCol; $c++) {
    if ((Get-Cell $rows 3 $c) -eq $metricName) { return $c }
  }
  throw "Metric '$metricName' was not found."
}

function Classify-Category($name) {
  $n = ([string]$name).ToLowerInvariant()
  if ($n -match "t-shirt|tee|티셔츠") { return "티셔츠" }
  if ($n -match "hood|sweatshirt|맨투맨|후드") { return "스웨트/후드" }
  if ($n -match "windbreaker|jumper|jacket|점퍼|자켓") { return "아우터" }
  if ($n -match "shirt|셔츠") { return "셔츠" }
  if ($n -match "pants|short|denim|jean|팬츠|바지") { return "팬츠" }
  if ($n -match "skirt|스커트") { return "스커트" }
  if ($n -match "cap|hat|bucket|볼캡|모자") { return "모자" }
  if ($n -match "bag|backpack|가방") { return "가방" }
  if ($n -match "sandal|flip|shoes|슬리퍼|신발") { return "신발" }
  return "기타"
}

function Get-WeekColumns($rows, $metricName, [int]$maxCol) {
  $start = Find-MetricStart $rows $metricName $maxCol
  $next = $maxCol + 1
  for ($c = $start + 1; $c -le $maxCol; $c++) {
    $metric = Get-Cell $rows 3 $c
    if ($metric -and $metric -ne $metricName) { $next = $c; break }
  }
  $weeks = @()
  for ($c = $start + 1; $c -lt $next; $c++) {
    $label = Get-Cell $rows 4 $c
    if ($label -and $label -ne "전체 결과") { $weeks += [ordered]@{ col = $c; label = $label } }
  }
  return @{ totalCol = $start; weeks = $weeks }
}

function Extract-StyleSheet($rows, [int]$year) {
  $maxCol = ($rows.Values | ForEach-Object { $_.Keys | Measure-Object -Maximum | Select-Object -ExpandProperty Maximum } | Measure-Object -Maximum).Maximum
  $maxRow = ($rows.Keys | Measure-Object -Maximum).Maximum
  $sales = Get-WeekColumns $rows "기간 판매량" $maxCol
  $normalSales = Get-WeekColumns $rows "기간 정상판매량" $maxCol
  $salesAmount = Get-WeekColumns $rows "기간 판매액[외형매출]" $maxCol
  $normalAmount = Get-WeekColumns $rows "기간 정상판매액" $maxCol
  $orderAmount = Get-WeekColumns $rows "발주액[정상가]" $maxCol
  $records = @()

  for ($r = 9; $r -le $maxRow; $r++) {
    $code = Get-Cell $rows $r 7
    $name = Get-Cell $rows $r 8
    if ($code -notmatch "^WH[A-Z0-9]{6,}" -or $name -eq "결과") { continue }
    $weekly = @()
    for ($i = 0; $i -lt $sales.weeks.Count; $i++) {
      $weekly += [ordered]@{
        index = $i
        label = $sales.weeks[$i].label
        actualQty = [math]::Round((To-Number (Get-Cell $rows $r $sales.weeks[$i].col)))
        normalQty = if ($i -lt $normalSales.weeks.Count) { [math]::Round((To-Number (Get-Cell $rows $r $normalSales.weeks[$i].col))) } else { 0 }
        salesAmount = if ($i -lt $salesAmount.weeks.Count) { [math]::Round((To-Number (Get-Cell $rows $r $salesAmount.weeks[$i].col))) } else { 0 }
        normalAmount = if ($i -lt $normalAmount.weeks.Count) { [math]::Round((To-Number (Get-Cell $rows $r $normalAmount.weeks[$i].col))) } else { 0 }
      }
    }
    $totalQty = To-Number (Get-Cell $rows $r $sales.totalCol)
    $totalNormalQty = To-Number (Get-Cell $rows $r $normalSales.totalCol)
    $price = To-Number (Get-Cell $rows $r 11)
    if ($price -le 0) { $price = To-Number (Get-Cell $rows $r 10) }
    if ($price -le 0) { $price = To-Number (Get-Cell $rows $r 9) }
    $records += [ordered]@{
      year = $year
      styleCode = $code
      styleName = $name
      normalizedName = Normalize-Name $name
      tokens = @(Get-Tokens $name)
      price = [math]::Round($price)
      firstInboundDate = Get-Cell $rows $r 12
      lastInboundDate = Get-Cell $rows $r 13
      firstShipDate = Get-Cell $rows $r 14
      lastShipDate = Get-Cell $rows $r 15
      orderAmountFromWeekly = [math]::Round((To-Number (Get-Cell $rows $r $orderAmount.totalCol)))
      totalQty = [math]::Round($totalQty)
      totalNormalQty = [math]::Round($totalNormalQty)
      totalSalesAmount = [math]::Round((To-Number (Get-Cell $rows $r $salesAmount.totalCol)))
      totalNormalAmount = [math]::Round((To-Number (Get-Cell $rows $r $normalAmount.totalCol)))
      normalRate = if ($totalQty -gt 0) { [math]::Round($totalNormalQty / $totalQty, 4) } else { 0.0 }
      weekly = $weekly
    }
  }
  return $records
}

function Extract-SkuSheet($rows) {
  $maxCol = ($rows.Values | ForEach-Object { $_.Keys | Measure-Object -Maximum | Select-Object -ExpandProperty Maximum } | Measure-Object -Maximum).Maximum
  $maxRow = ($rows.Keys | Measure-Object -Maximum).Maximum
  $groups = @()
  for ($c = 7; $c -le $maxCol; $c++) {
    if ((Get-Cell $rows 5 $c) -eq "판매량" -and (Get-Cell $rows 3 $c) -match "^2026-") {
      $normalCol = $c + 1
      $sellCol = $c + 2
      if ($sellCol -le $maxCol -and (Get-Cell $rows 5 $sellCol) -eq "소진율") {
        $groups += [ordered]@{ salesCol = $c; normalCol = $normalCol; sellCol = $sellCol; week = Get-Cell $rows 3 $c; label = Get-Cell $rows 4 $c }
      }
    }
  }
  $recentGroups = @($groups | Select-Object -Last 4)
  $latestGroup = if ($groups.Count -gt 0) { $groups[-1] } else { $null }
  $byStyle = @{}
  for ($r = 7; $r -le $maxRow; $r++) {
    $styleCode = Get-Cell $rows $r 2
    if ($styleCode -notmatch "^WH[A-Z0-9]{6,}") { continue }
    $styleName = Get-Cell $rows $r 3
    $colorCode = Get-Cell $rows $r 4
    $colorName = Get-Cell $rows $r 5
    $size = Get-Cell $rows $r 6
    if (-not $colorCode -or -not $size -or $colorCode -eq "결과" -or $size -eq "결과") { continue }
    $recentSales = 0.0
    foreach ($g in $recentGroups) { $recentSales += To-Number (Get-Cell $rows $r $g.salesCol) }
    $latestSales = if ($latestGroup) { To-Number (Get-Cell $rows $r $latestGroup.salesCol) } else { 0.0 }
    $normalRate = if ($latestGroup) { To-Number (Get-Cell $rows $r $latestGroup.normalCol) } else { 0.0 }
    $sellThrough = if ($latestGroup) { To-Number (Get-Cell $rows $r $latestGroup.sellCol) } else { 0.0 }
    if (($recentSales + $latestSales + $normalRate + $sellThrough) -le 0) { continue }
    if (-not $byStyle.ContainsKey($styleCode)) { $byStyle[$styleCode] = @() }
    $byStyle[$styleCode] += [ordered]@{
      styleCode = $styleCode
      styleName = $styleName
      colorCode = $colorCode
      colorName = $colorName
      size = $size
      recentSales = [math]::Round($recentSales)
      latestSales = [math]::Round($latestSales)
      normalRate = [math]::Round($normalRate, 2)
      sellThrough = [math]::Round($sellThrough, 2)
    }
  }
  return $byStyle
}

function Build-SkuPlan($styleCode, $reorderTotal, $skuByStyle) {
  if (-not $skuByStyle.ContainsKey($styleCode) -or $reorderTotal -le 0) { return @() }
  $items = @($skuByStyle[$styleCode])
  if ($items.Count -eq 0) { return @() }
  $sumRecent = ($items | ForEach-Object { [double]$_.recentSales } | Measure-Object -Sum).Sum
  $sumSell = ($items | ForEach-Object { [Math]::Max(0, [double]$_.sellThrough) } | Measure-Object -Sum).Sum
  $sumNormal = ($items | ForEach-Object { [Math]::Max(0, [double]$_.normalRate) } | Measure-Object -Sum).Sum
  $weighted = @()
  foreach ($item in $items) {
    $recentShare = if ($sumRecent -gt 0) { [double]$item.recentSales / $sumRecent } else { 1.0 / $items.Count }
    $sellShare = if ($sumSell -gt 0) { [Math]::Max(0, [double]$item.sellThrough) / $sumSell } else { $recentShare }
    $normalShare = if ($sumNormal -gt 0) { [Math]::Max(0, [double]$item.normalRate) / $sumNormal } else { $recentShare }
    $weight = (0.6 * $recentShare) + (0.3 * $sellShare) + (0.1 * $normalShare)
    $weighted += [ordered]@{ item = $item; weight = $weight }
  }
  $sumWeight = ($weighted | ForEach-Object { [double]$_.weight } | Measure-Object -Sum).Sum
  $plan = @()
  foreach ($w in $weighted) {
    $qty = if ($sumWeight -gt 0) { [math]::Round($reorderTotal * ([double]$w.weight / $sumWeight)) } else { 0 }
    if ($qty -gt 0) {
      $plan += [ordered]@{
        colorCode = $w.item.colorCode
        colorName = $w.item.colorName
        size = $w.item.size
        recentSales = $w.item.recentSales
        latestSales = $w.item.latestSales
        normalRate = $w.item.normalRate
        sellThrough = $w.item.sellThrough
        recommendedQty = [int]$qty
      }
    }
  }
  return @($plan | Sort-Object @{ Expression = "recommendedQty"; Descending = $true })
}

function Extract-CostRates($rows) {
  $byStyle = @{}
  $maxRow = ($rows.Keys | Measure-Object -Maximum).Maximum
  for ($r = 1; $r -le $maxRow; $r++) {
    $styleCode = [string](Get-Cell $rows $r 4)
    if ($styleCode -notmatch "^WH[A-Z0-9]{7,}") { continue }
    $rate = To-Number (Get-Cell $rows $r 77)
    if ($rate -le 0) {
      $postCost = To-Number (Get-Cell $rows $r 59)
      $inboundAmount = To-Number (Get-Cell $rows $r 20)
      if ($postCost -gt 0 -and $inboundAmount -gt 0) {
        $rate = ($postCost / $inboundAmount / 1.1) * 100
      }
    }
    if ($rate -gt 0) {
      $byStyle[$styleCode] = [ordered]@{
        costRate = [math]::Round($rate, 1)
        preCost = [math]::Round((To-Number (Get-Cell $rows $r 58)))
        postCost = [math]::Round((To-Number (Get-Cell $rows $r 59)))
        preCostPerUnit = [math]::Round((To-Number (Get-Cell $rows $r 60)))
        postCostPerUnit = [math]::Round((To-Number (Get-Cell $rows $r 61)))
      }
    }
  }
  return $byStyle
}

function FirstActiveIndex($weekly) {
  for ($i = 0; $i -lt $weekly.Count; $i++) { if (($weekly[$i].actualQty + $weekly[$i].normalQty) -gt 0) { return $i } }
  return 0
}

function RecentAverage($weekly) {
  $active = @($weekly | Where-Object { $_.actualQty -gt 0 })
  if ($active.Count -eq 0) { return 0.0 }
  $tail = @($active | Select-Object -Last 4)
  $weights = @(0.1, 0.2, 0.3, 0.4)
  $offset = $weights.Count - $tail.Count
  $sum = 0.0; $weightSum = 0.0
  for ($i = 0; $i -lt $tail.Count; $i++) { $w = $weights[$offset + $i]; $sum += $tail[$i].actualQty * $w; $weightSum += $w }
  if ($weightSum -eq 0) { return 0.0 }
  return $sum / $weightSum
}

function Find-SimilarStyle($style, $priorStyles) {
  $best = $null; $bestScore = 0.0
  $styleTokens = @($style.tokens)
  if ($style.normalizedName) {
    foreach ($prior in $priorStyles) {
      if ($prior.normalizedName -eq $style.normalizedName) {
        return [ordered]@{ style = $prior; score = 1.0 }
      }
    }
  }
  foreach ($prior in $priorStyles) {
    $sharedHint = $false
    foreach ($token in $styleTokens) {
      if (@($prior.tokens) -contains $token) { $sharedHint = $true; break }
    }
    if (-not $sharedHint) { continue }
    $score = Similarity $style $prior
    if ($score -gt $bestScore) { $bestScore = $score; $best = $prior }
  }
  if ($bestScore -lt 0.35) { return $null }
  return [ordered]@{ style = $best; score = [math]::Round($bestScore, 4) }
}

function Find-MappedSimilarStyle($style, $priorByCode, $progressMap) {
  if ($progressMap -and $progressMap.ContainsKey($style.styleCode)) {
    $priorCode = [string]$progressMap[$style.styleCode]
    if ($priorByCode.ContainsKey($priorCode)) {
      return [ordered]@{ style = $priorByCode[$priorCode]; score = 1.0; source = "progress-board" }
    }
  }
  return $null
}

function Build-Forecast($style, $similar) {
  $recent = RecentAverage $style.weekly
  $currentQuality = if ($style.normalRate -gt 0) { [Math]::Max(0.65, [Math]::Min(1.08, 0.72 + ($style.normalRate * 0.36))) } else { 0.72 }
  $forecast = @(); $priorSeries = @()
  $activeStart = FirstActiveIndex $style.weekly
  $latestActive = 0
  for ($i = 0; $i -lt $style.weekly.Count; $i++) { if ($style.weekly[$i].actualQty -gt 0 -or $style.weekly[$i].normalQty -gt 0) { $latestActive = $i } }
  $lifeIndex = [Math]::Max(0, $latestActive - $activeStart)
  $prior = $null; $priorStart = 0; $priorQuality = 0.75
  if ($similar) { $prior = $similar.style; $priorStart = FirstActiveIndex $prior.weekly; $priorQuality = [Math]::Max(0.45, [Math]::Min(1.0, $prior.normalRate)) }
  for ($i = 0; $i -lt 26; $i++) {
    $decayTarget = $recent * [Math]::Pow(0.88, $i) * $currentQuality
    if ($i -gt 8) { $decayTarget = $decayTarget * [Math]::Pow(0.92, $i - 8) }
    $priorTarget = 0.0
    if ($prior) {
      $priorIndex = $priorStart + $lifeIndex + $i + 1
      if ($priorIndex -lt $prior.weekly.Count) {
        $priorWeek = $prior.weekly[$priorIndex]
        $orderScale = if ($prior.orderAmountFromWeekly -gt 0) { [Math]::Max(0.35, [Math]::Min(2.5, $style.orderAmountFromWeekly / $prior.orderAmountFromWeekly)) } else { 1.0 }
        $priorTarget = (0.35 * $priorWeek.actualQty + 0.65 * $priorWeek.normalQty) * (0.55 + 0.45 * $priorQuality) * $orderScale
      }
      $priorSeries += [ordered]@{ offset = $i + 1; label = "전년+" + ($i + 1); actualQty = [math]::Round($priorTarget) }
    }
    $blendWeight = 0.0
    if ($priorTarget -gt 0) {
      $source = if ($similar.Contains("source")) { $similar.source } else { "name-match" }
      $blendWeight = if ($source -eq "progress-board") { 0.72 } else { [Math]::Min(0.65, 0.35 + ($similar.score * 0.30)) }
      if ($priorTarget -gt $decayTarget) { $blendWeight = [Math]::Min(0.85, $blendWeight + 0.10) }
    }
    $target = ($decayTarget * (1 - $blendWeight)) + ($priorTarget * $blendWeight)
    $target = [math]::Round([Math]::Max(0, $target))
    $forecast += [ordered]@{ offset = $i + 1; week = "W+" + ($i + 1); label = "W+" + ($i + 1); targetQty = [int]$target; priorSimilarQty = if ($priorTarget -gt 0) { [math]::Round($priorTarget) } else { 0 } }
    if ($target -lt 1 -and $i -gt 4) { break }
  }
  return @{ forecast = $forecast; priorSeries = $priorSeries }
}

function Build-FullTrend($style, $similar, $forecast) {
  $actual = @()
  $start = FirstActiveIndex $style.weekly
  $prior = if ($similar) { $similar.style } else { $null }
  $priorStart = if ($prior) { FirstActiveIndex $prior.weekly } else { 0 }
  $orderScale = if ($prior -and $prior.orderAmountFromWeekly -gt 0) { [Math]::Max(0.35, [Math]::Min(2.5, $style.orderAmountFromWeekly / $prior.orderAmountFromWeekly)) } else { 1.0 }
  for ($i = $start; $i -lt $style.weekly.Count; $i++) {
    $w = $style.weekly[$i]
    $lifeIndex = [Math]::Max(0, $i - $start)
    $predictedQty = 0
    if ($prior) {
      $priorIndex = $priorStart + $lifeIndex
      if ($priorIndex -lt $prior.weekly.Count) {
        $pw = $prior.weekly[$priorIndex]
        $predictedQty = [math]::Round((0.4 * $pw.actualQty + 0.6 * $pw.normalQty) * $orderScale)
      }
    }
    $targetQty = if ($w.normalQty -gt 0) { $w.normalQty } elseif ($predictedQty -gt 0) { $predictedQty } else { $w.actualQty }
    $actual += [ordered]@{
      index = $actual.Count
      label = $w.label
      actualQty = $w.actualQty
      targetQty = [math]::Round($targetQty)
      predictedQty = [math]::Round($predictedQty)
    }
  }
  $lastActual = if ($actual.Count -gt 0) { $actual[-1].actualQty } else { 0 }
  $currentLife = [Math]::Max(0, $style.weekly.Count - 1 - $start)

  for ($i = 0; $i -lt $forecast.Count; $i++) {
    $priorPred = 0
    if ($prior) {
      $priorIndex = $priorStart + $currentLife + $i + 1
      if ($priorIndex -lt $prior.weekly.Count) {
        $pw = $prior.weekly[$priorIndex]
        $priorPred = [math]::Round((0.4 * $pw.actualQty + 0.6 * $pw.normalQty) * $orderScale)
      }
    }
    $actual += [ordered]@{
      index = $actual.Count
      label = $forecast[$i].label
      actualQty = 0
      targetQty = $forecast[$i].targetQty
      predictedQty = $priorPred
    }
  }
  return $actual
}

function Get-PreviousCompleteWeekLabel([datetime]$Reference = (Get-Date)) {
  $today = $Reference.Date
  $daysSinceMonday = (([int]$today.DayOfWeek + 6) % 7)
  $currentMonday = $today.AddDays(-1 * $daysSinceMonday)
  $previousMonday = $currentMonday.AddDays(-7)
  $previousSunday = $currentMonday.AddDays(-1)
  return "{0:MM/dd}~{1:MM/dd}" -f $previousMonday, $previousSunday
}

function Get-WeekRowForLabel($weekly, [string]$label) {
  $exact = @($weekly | Where-Object { $_.label -eq $label } | Select-Object -First 1)
  if ($exact.Count -gt 0) { return $exact[0] }
  $fallback = @($weekly | Select-Object -Last 1)
  if ($fallback.Count -gt 0) { return $fallback[0] }
  return [ordered]@{ label = ""; actualQty = 0; normalQty = 0; salesAmount = 0; normalAmount = 0 }
}

$metadataByStyle = @{}

$productionByStyle = @{}
Import-Csv -LiteralPath $productionPath | ForEach-Object {
  $style = $_.스타일코드
  if (-not $style) { return }
  if (-not $productionByStyle.ContainsKey($style)) { $productionByStyle[$style] = [ordered]@{ inboundQty = 0.0; orderQty = 0.0; colors = @{} } }
  $entry = $productionByStyle[$style]
  $inbound = To-Number $_.입고수량; $order = To-Number $_.발주수량
  $entry.inboundQty += $inbound; $entry.orderQty += $order
  $colorKey = if ($_.스타일컬러코드) { $_.스타일컬러코드 } else { "$style$($_.컬러코드)" }
  if (-not $entry.colors.ContainsKey($colorKey)) { $entry.colors[$colorKey] = [ordered]@{ colorCode = $_.컬러코드; styleColorCode = $colorKey; inboundQty = 0.0; orderQty = 0.0 } }
  $entry.colors[$colorKey].inboundQty += $inbound; $entry.colors[$colorKey].orderQty += $order
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($weeklyWorkbookPath)
try {
  $sharedStrings = @(Read-SharedStrings $zip)
  $rows2026 = Read-SheetRows $zip "xl/worksheets/sheet1.xml" $sharedStrings
  $rows2025 = Read-SheetRows $zip "xl/worksheets/sheet2.xml" $sharedStrings
} finally { $zip.Dispose() }

$styles2026 = @(Extract-StyleSheet $rows2026 2026)
$styles2025 = @(Extract-StyleSheet $rows2025 2025)
$priorByCode = @{}
foreach ($prior in $styles2025) { $priorByCode[$prior.styleCode] = $prior }

$progressMap = @{}
if (Test-Path $progressMapPath) {
  $progressPayload = Get-Content -LiteralPath $progressMapPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($prop in $progressPayload.map.PSObject.Properties) {
    $progressMap[$prop.Name] = [string]$prop.Value
  }
}

$skuZip = [System.IO.Compression.ZipFile]::OpenRead($skuWorkbookPath)
try {
  $skuSharedStrings = @(Read-SharedStrings $skuZip)
  $skuRows = Read-SheetRows $skuZip "xl/worksheets/sheet1.xml" $skuSharedStrings
} finally { $skuZip.Dispose() }
$skuByStyle = Extract-SkuSheet $skuRows

$costByStyle = @{}
if (Test-Path $costWorkbookPath) {
  $costZip = [System.IO.Compression.ZipFile]::OpenRead($costWorkbookPath)
  try {
    $costSharedStrings = @(Read-SharedStrings $costZip)
    $costRows = Read-SheetRows $costZip "xl/worksheets/sheet2.xml" $costSharedStrings
  } finally { $costZip.Dispose() }
  $costByStyle = Extract-CostRates $costRows
}

$stylePayload = @(); $recommendations = @(); $summaryRows = @()
$targetWeekLabel = Get-PreviousCompleteWeekLabel
foreach ($style in $styles2026) {
  $similar = Find-MappedSimilarStyle $style $priorByCode $progressMap
  if (-not $similar) { $similar = Find-SimilarStyle $style $styles2025 }
  $built = Build-Forecast $style $similar
  $forecast = @($built.forecast)
  $fullTrend = @(Build-FullTrend $style $similar $forecast)
  $plcNeed = 0.0; foreach ($point in $forecast) { $plcNeed += $point.targetQty }
  $production = if ($productionByStyle.ContainsKey($style.styleCode)) { $productionByStyle[$style.styleCode] } else { [ordered]@{ inboundQty = 0.0; orderQty = 0.0; colors = @{} } }
  $xlsxOrderQty = if ($style.price -gt 0) { [math]::Round($style.orderAmountFromWeekly / $style.price) } else { 0 }
  if ($production.inboundQty -le 0 -and $xlsxOrderQty -gt 0) { $production.inboundQty = $xlsxOrderQty }
  if ($production.orderQty -le 0 -and $xlsxOrderQty -gt 0) { $production.orderQty = $xlsxOrderQty }
  $estimatedStock = [math]::Round($production.inboundQty - $style.totalQty)
  $reorderTotal = [math]::Max(0, [math]::Round($plcNeed - $estimatedStock))
  $skuPlan = @(Build-SkuPlan $style.styleCode $reorderTotal $skuByStyle)
  $forecast5 = @($forecast | Select-Object -First 5)
  $need5 = 0.0; foreach ($point in $forecast5) { $need5 += $point.targetQty }
  $allocBase = if ($need5 -gt 0) { $need5 } else { 1 }
  $colorRows = @(); $colorSourceTotal = 0.0
  foreach ($color in $production.colors.Values) { $colorSourceTotal += $color.inboundQty }
  if ($colorSourceTotal -le 0) { foreach ($color in $production.colors.Values) { $colorSourceTotal += $color.orderQty } }
  foreach ($color in $production.colors.Values) {
    $basis = if ($color.inboundQty -gt 0) { $color.inboundQty } else { $color.orderQty }
    $ratio = if ($colorSourceTotal -gt 0) { $basis / $colorSourceTotal } else { 0 }
    $colorRows += [ordered]@{ colorCode = $color.colorCode; styleColorCode = $color.styleColorCode; ratio = [math]::Round($ratio, 4); recommendedQty = [math]::Round($reorderTotal * $ratio) }
  }
  $fallbackCategory = Classify-Category $style.styleName
  $meta = if ($metadataByStyle.ContainsKey($style.styleCode)) { $metadataByStyle[$style.styleCode] } else { [ordered]@{ season = "26"; categoryLarge = $fallbackCategory; categoryMid = $fallbackCategory; categorySmall = $fallbackCategory; material = "" } }
  $cost = if ($costByStyle.ContainsKey($style.styleCode)) { $costByStyle[$style.styleCode] } else { [ordered]@{ costRate = 0; preCost = 0; postCost = 0; preCostPerUnit = 0; postCostPerUnit = 0 } }
  if ($reorderTotal -gt 0) {
    for ($bucket = 0; $bucket -lt 5; $bucket++) {
      $target = if ($bucket -lt $forecast5.Count) { $forecast5[$bucket].targetQty } else { 0 }
      $qty = [math]::Round($reorderTotal * ($target / $allocBase))
      if ($target -gt 0 -and $qty -eq 0) { $qty = 1 }
      if ($qty -gt 0) {
        $recommendations += [ordered]@{ weekOffset = $bucket; weekLabel = "W+" + $bucket; styleCode = $style.styleCode; styleName = $style.styleName; season = $meta.season; category = $meta.categoryMid; subCategory = $meta.categorySmall; neededQty = [int]$qty; forecastQty = [int]$target; estimatedStock = [int]$estimatedStock; price = [int]$style.price; orderAmount = [math]::Round($qty * $style.price); colors = @($colorRows | Where-Object { $_.recommendedQty -gt 0 } | Select-Object -First 6) }
      }
    }
    $lastWeek = Get-WeekRowForLabel $style.weekly $targetWeekLabel
    $summaryRows += [ordered]@{ season = $meta.season; category = $meta.categoryMid; styleCode = $style.styleCode; styleName = $style.styleName; orderAmount = [math]::Round($reorderTotal * $style.price); inboundAmount = [math]::Round($production.inboundQty * $style.price); weekSalesAmount = [math]::Round($lastWeek.actualQty * $style.price); cumulativeSalesAmount = [math]::Round($style.totalSalesAmount); regularSalesAmount = [math]::Round($style.totalNormalAmount); reorderTotal = [int]$reorderTotal; similarStyleCode = if ($similar) { $similar.style.styleCode } else { "" }; similarStyleName = if ($similar) { $similar.style.styleName } else { "" }; similarScore = if ($similar) { $similar.score } else { 0 }; similarSource = if ($similar -and $similar.Contains("source")) { $similar.source } else { "name-match" }; normalRate = $style.normalRate }
  }
  $stylePayload += [ordered]@{ styleCode = $style.styleCode; styleName = $style.styleName; productName = $style.styleName; season = $meta.season; categoryLarge = $meta.categoryLarge; categoryMid = $meta.categoryMid; categorySmall = $meta.categorySmall; price = [int]$style.price; inboundQty = [math]::Round($production.inboundQty); orderQty = [math]::Round($production.orderQty); orderAmount = [math]::Round($style.orderAmountFromWeekly); totalQty = [math]::Round($style.totalQty); totalNormalQty = [math]::Round($style.totalNormalQty); totalSalesAmount = [math]::Round($style.totalSalesAmount); totalNormalAmount = [math]::Round($style.totalNormalAmount); normalRate = $style.normalRate; costRate = $cost.costRate; preCost = $cost.preCost; postCost = $cost.postCost; preCostPerUnit = $cost.preCostPerUnit; postCostPerUnit = $cost.postCostPerUnit; stock = [int]$estimatedStock; reorderTotal = [int]$reorderTotal; plcWeekOffset = if ($forecast.Count -gt 0) { [int]$forecast[-1].offset } else { 0 }; weekly = @($style.weekly | Select-Object -Last 14); trend = @($fullTrend); forecast = @($forecast | Select-Object -First 12); priorSeries = @($built.priorSeries | Select-Object -First 12); similarStyle = if ($similar) { [ordered]@{ styleCode = $similar.style.styleCode; styleName = $similar.style.styleName; score = $similar.score; source = if ($similar.Contains("source")) { $similar.source } else { "name-match" }; normalRate = $similar.style.normalRate; totalQty = $similar.style.totalQty; totalNormalQty = $similar.style.totalNormalQty; orderAmount = $similar.style.orderAmountFromWeekly } } else { $null }; colors = @($colorRows); skuPlan = @($skuPlan) }
}

$recommendedStyleSet = @{}; foreach ($row in $summaryRows) { $recommendedStyleSet[$row.styleCode] = 1 }
$latestLabel = if ($styles2026.Count -gt 0) { (@($styles2026[0].weekly | Select-Object -Last 1)[0].label) } else { "" }
$targetExists = $false
if ($styles2026.Count -gt 0) {
  $targetExists = @($styles2026[0].weekly | Where-Object { $_.label -eq $targetWeekLabel }).Count -gt 0
}
$dataWeekLabel = if ($targetExists) { $targetWeekLabel } else { $latestLabel }
$payload = [ordered]@{ generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"); targetWeekLabel = $targetWeekLabel; dataWeekLabel = $dataWeekLabel; latestWeek = $dataWeekLabel; latestWeekLabel = $dataWeekLabel; sourceDir = $sourceDir; sourceWorkbook = $weeklyWorkbookPath; skuWorkbook = $skuWorkbookPath; costWorkbook = $costWorkbookPath; progressMap = $progressMapPath; stats = [ordered]@{ productionStyles = $styles2026.Count; joinedStyles = $styles2026.Count; priorStyles = $styles2025.Count; progressMappedStyles = $progressMap.Count; skuStyles = $skuByStyle.Count; costStyles = $costByStyle.Count; recommendedStyles = $recommendedStyleSet.Count; recommendationRows = $recommendations.Count }; recommendations = @($recommendations | Sort-Object weekOffset, @{ Expression = "neededQty"; Descending = $true }); summary = @($summaryRows | Sort-Object @{ Expression = "orderAmount"; Descending = $true }); styles = @($stylePayload) }

$json = $payload | ConvertTo-Json -Depth 14 -Compress
Set-Content -LiteralPath $outPath -Value "window.REORDER_DATA = $json;" -Encoding UTF8
Write-Host "Generated $outPath"
Write-Host "2026Styles=$($styles2026.Count) priorStyles=$($styles2025.Count) recommendedStyles=$($payload.stats.recommendedStyles) recommendationRows=$($payload.stats.recommendationRows) target=$targetWeekLabel dataWeek=$dataWeekLabel"
