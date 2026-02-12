param(
  [string]$BaseUrl,
  [string]$Session
)

. "$PSScriptRoot/common.ps1"

$config = Get-HexConfig -BaseUrl $BaseUrl -Session $Session
$BaseUrl = $config.BaseUrl
$Session = $config.Session

Require-AgentBrowser

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$project = "E2E-HEX-TI152-$stamp"
$xlsxPath = "$env:USERPROFILE\.agent-browser\tmp\ti-152-$stamp.xlsx"
$csvPath = "$env:USERPROFILE\.agent-browser\tmp\ti-152-$stamp.csv"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-152" -Date "2026-02-02" -Validite "30"
  Go-EditorTab -Session $Session
  Add-Chapter -Session $Session -Title "Chapitre 1"
  Add-Line -Session $Session -Designation "Planches bois"
  Set-LineValues -Session $Session -Quantity "2" -Unit "m2" -PriceFo "100" -TypeFo "Materiaux" -Kfo "1.2" -HoursMo "3" -Kmo "0.5"

  Invoke-AB $Session "find" "role" "button" "click" "--name" "Exporter"
  Invoke-AB $Session "download" "text=Excel (.xlsx)" $xlsxPath
  Invoke-AB $Session "download" "text=Fichier CSV (.csv)" $csvPath

  if (-not (Test-Path $xlsxPath)) { throw "Missing Excel export" }
  if (-not (Test-Path $csvPath)) { throw "Missing CSV export" }

  & node -e "const xlsx=require('xlsx'); const wb=xlsx.readFile('$xlsxPath'); if(!wb.SheetNames.includes('Recap')||!wb.SheetNames.includes('Lignes')){process.exit(1);}"
  if ($LASTEXITCODE -ne 0) { throw "Excel export missing expected sheets" }

  Write-Host "TI-152 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
