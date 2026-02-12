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
$project = "E2E-HEX-TI140-$stamp"
$xlsxPath = "$env:USERPROFILE\.agent-browser\tmp\ti-140-$stamp.xlsx"
$csvPath = "$env:USERPROFILE\.agent-browser\tmp\ti-140-$stamp.csv"
$printPath = "$env:USERPROFILE\.agent-browser\tmp\ti-140-$stamp.pdf"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-140" -Date "2026-02-02" -Validite "30"
  Go-EditorTab -Session $Session
  Add-Chapter -Session $Session -Title "Chapitre 1"
  Add-Line -Session $Session -Designation "Planches bois"
  Set-LineValues -Session $Session -Quantity "2" -Unit "m2" -PriceFo "100" -TypeFo "Materiaux" -Kfo "1.2" -HoursMo "3" -Kmo "0.5"

  Go-ParamsTab -Session $Session
  Invoke-AB $Session "find" "label" "Marge (multiplicateur)" "fill" "1.2"
  Invoke-AB $Session "find" "label" "Remise (EUR HT)" "fill" "10"
  Invoke-AB $Session "find" "label" "TVA unique" "fill" "20"

  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected "Total TTC" -Message "Totals visible"

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates"
  $projectJson = ConvertTo-Json $project -Compress
  $js = @"
(() => {
  const rows = Array.from(document.querySelectorAll('tr'));
  const row = rows.find(r => r.innerText && r.innerText.includes($projectJson));
  if (!row) throw new Error('Project row not found');
  const btn = Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === 'Dupliquer');
  if (!btn) throw new Error('Duplicate button not found');
  btn.click();
})();
"@
  Invoke-AB $Session "eval" $js

  $dupUrl = Invoke-AB $Session "wait" "--url" "**/dashboard/estimates/**/edit**"
  $dupId = Get-VersionIdFromUrl -Url $dupUrl

  Invoke-AB $Session "find" "role" "button" "click" "--name" "Envoyer"
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Accepter"
  Invoke-AB $Session "reload"

  $js = "(() => { const inputs = Array.from(document.querySelectorAll('input')); return inputs.length ? inputs[1].disabled : false; })()"
  $disabled = Invoke-AB $Session "eval" $js
  if ($disabled -ne $true -and $disabled -ne "true") {
    throw "Accepted version not readonly"
  }

  Open-EstimatePrint -BaseUrl $BaseUrl -Session $Session -VersionId $dupId
  Invoke-AB $Session "pdf" $printPath
  if (-not (Test-Path $printPath)) { throw "Print PDF missing" }

  Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $dupId
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Exporter"
  Invoke-AB $Session "download" "text=Excel (.xlsx)" $xlsxPath
  Invoke-AB $Session "download" "text=Fichier CSV (.csv)" $csvPath

  if (-not (Test-Path $xlsxPath)) { throw "Excel export missing" }
  if (-not (Test-Path $csvPath)) { throw "CSV export missing" }

  Write-Host "TI-140 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
