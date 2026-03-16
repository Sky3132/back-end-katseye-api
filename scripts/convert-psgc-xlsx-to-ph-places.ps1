param(
  [Parameter(Mandatory = $true)]
  [string]$InputXlsx,
  [Parameter(Mandatory = $false)]
  [string]$OutputJson = "prisma/data/ph-places.json"
)

$ErrorActionPreference = "Stop"

function Get-SharedStrings([string]$sharedStringsPath) {
  [xml]$ss = Get-Content -Raw $sharedStringsPath
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($si in $ss.SelectNodes("//*[local-name()='si']")) {
    $textParts = @()
    foreach ($t in $si.SelectNodes(".//*[local-name()='t']")) {
      $textParts += $t."#text"
    }
    $out.Add(($textParts -join ""))
  }
  return $out
}

function Get-CellText($cell, $sharedStrings) {
  $t = $cell.GetAttribute("t")
  if ($t -eq "s") {
    $v = $cell.SelectSingleNode("./*[local-name()='v']")
    if ($null -eq $v) { return "" }
    $idx = [int]$v.InnerText
    if ($idx -ge 0 -and $idx -lt $sharedStrings.Count) { return $sharedStrings[$idx] }
    return ""
  }
  if ($t -eq "inlineStr") {
    $parts = @()
    foreach ($tn in $cell.SelectNodes(".//*[local-name()='t']")) {
      $parts += $tn.InnerText
    }
    return ($parts -join "")
  }
  $v2 = $cell.SelectSingleNode("./*[local-name()='v']")
  if ($null -ne $v2) { return $v2.InnerText }
  return ""
}

if (!(Test-Path $InputXlsx)) {
  throw "Input file not found: $InputXlsx"
}

$zipPath = Join-Path $PSScriptRoot "tmp_psgc.zip"
$extractDir = Join-Path $PSScriptRoot "tmp_psgc_extract"
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
Copy-Item $InputXlsx $zipPath -Force
New-Item -ItemType Directory -Force $extractDir | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$sharedStringsPath = Join-Path $extractDir "xl/sharedStrings.xml"
$workbookPath = Join-Path $extractDir "xl/workbook.xml"
$relsPath = Join-Path $extractDir "xl/_rels/workbook.xml.rels"
if (!(Test-Path $sharedStringsPath)) { throw "Missing sharedStrings.xml in xlsx" }
if (!(Test-Path $workbookPath)) { throw "Missing workbook.xml in xlsx" }
if (!(Test-Path $relsPath)) { throw "Missing workbook.xml.rels in xlsx" }

$sharedStrings = Get-SharedStrings $sharedStringsPath

# Find the sheet named "PSGC" (fallback to sheet4 if not found)
[xml]$wb = Get-Content -Raw $workbookPath
$nsmgr = New-Object System.Xml.XmlNamespaceManager($wb.NameTable)
$nsmgr.AddNamespace("ns", $wb.DocumentElement.NamespaceURI) | Out-Null
$nsmgr.AddNamespace("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships") | Out-Null
$targetRid = $null
foreach ($s in $wb.SelectNodes("//ns:sheets/ns:sheet", $nsmgr)) {
  if ($s.GetAttribute("name") -eq "PSGC") {
    $targetRid = $s.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
  }
}
if (!$targetRid) { $targetRid = "rId4" }

[xml]$rels = Get-Content -Raw $relsPath
$sheetTarget = $null
foreach ($rel in $rels.Relationships.Relationship) {
  if ($rel.Id -eq $targetRid) { $sheetTarget = $rel.Target }
}
if (!$sheetTarget) { throw "Could not resolve sheet target for $targetRid" }
$sheetPath = Join-Path (Join-Path $extractDir "xl") ($sheetTarget -replace "/", "\")
if (!(Test-Path $sheetPath)) { throw "Worksheet file not found: $sheetPath" }

$places = New-Object System.Collections.Generic.List[object]
$places.Add([pscustomobject]@{
  id = "PH"; type = "country"; parent_id = ""; country_code = "PH"; name = "Philippines"; code = $null; has_children = 1; sort_order = 1
})

$currentRegion = $null
$currentProvince = $null
$currentCity = $null
$rowsSeen = 0
$rowsWithKeys = 0

# Load the worksheet as XML (large, but reliable for this conversion).
[xml]$sheet = Get-Content -Raw $sheetPath
$rows = $sheet.SelectNodes("//*[local-name()='sheetData']/*[local-name()='row']")
foreach ($r in $rows) {
  $rowsSeen++
  $a = $null
  $b = $null
  $d = $null

  foreach ($c in $r.ChildNodes) {
    if ($null -eq $c -or $c.LocalName -ne "c") { continue }
    $cellRef = $c.GetAttribute("r")
    if (!$cellRef) { continue }
    if ($cellRef -match "^A\d+$") { $a = Get-CellText $c $sharedStrings }
    elseif ($cellRef -match "^B\d+$") { $b = Get-CellText $c $sharedStrings }
    elseif ($cellRef -match "^D\d+$") { $d = Get-CellText $c $sharedStrings }
  }


  $psgc = ($(if ($null -eq $a) { "" } else { $a })).Trim()
  $name = ($(if ($null -eq $b) { "" } else { $b })).Trim()
  $level = ($(if ($null -eq $d) { "" } else { $d })).Trim()
  if (!$psgc -or !$name -or !$level) { continue }
  $rowsWithKeys++

  $type = $null
  $parent = $null

  switch ($level) {
    "Reg" {
      $type = "region"
      $parent = "PH"
      $currentRegion = $psgc
      $currentProvince = $null
      $currentCity = $null
    }
    "Prov" {
      if (!$currentRegion) { continue }
      $type = "province"
      $parent = $currentRegion
      $currentProvince = $psgc
      $currentCity = $null
    }
    "City" { # city component
      if (!$currentProvince) { continue }
      $type = "city"
      $parent = $currentProvince
      $currentCity = $psgc
    }
    "Mun" { # municipality component
      if (!$currentProvince) { continue }
      $type = "city"
      $parent = $currentProvince
      $currentCity = $psgc
    }
    "Bgy" {
      if (!$currentCity) { continue }
      $type = "district"
      $parent = $currentCity
    }
    default {
      $type = $null
      $parent = $null
    }
  }
  if (!$type -or ($type -ne "region" -and !$parent)) { continue }

  $hasChildren = 1
  if ($type -eq "district") { $hasChildren = 0 }
  $places.Add([pscustomobject]@{
    id = $psgc
    type = $type
    parent_id = $parent
    country_code = "PH"
    name = $name
    code = $null
    has_children = $hasChildren
    sort_order = 0
  })
}

# Write JSON
$outPath = Resolve-Path (Join-Path (Get-Location) $OutputJson) -ErrorAction SilentlyContinue
if (!$outPath) {
  $dir = Split-Path $OutputJson -Parent
  if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $outPath = (Join-Path (Get-Location) $OutputJson)
} else {
  $outPath = $outPath.Path
}

$json = $places | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText(
  $outPath,
  $json,
  (New-Object System.Text.UTF8Encoding($false))
)
Write-Output "Wrote: $outPath"
Write-Output ("Places: " + $places.Count)
Write-Output ("Rows seen: " + $rowsSeen)
Write-Output ("Rows with A/B/D: " + $rowsWithKeys)
