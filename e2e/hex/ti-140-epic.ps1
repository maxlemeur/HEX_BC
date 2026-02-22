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
$tempDir = Get-E2ETempDir
$xlsxPath = Join-Path $tempDir "ti-140-$stamp.xlsx"
$csvPath = Join-Path $tempDir "ti-140-$stamp.csv"
$printPath = Join-Path $tempDir "ti-140-$stamp.pdf"

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

  $versionIdJson = ConvertTo-Json $versionId -Compress
$dupResult = Invoke-AB $Session "eval" @"
(async () => {
  const versionId = $versionIdJson;
  const response = await fetch('/api/estimates/' + versionId + '/duplicate', {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Duplicate failed (' + response.status + ')');
  }
  const payload = await response.json();
  const payloadText = JSON.stringify(payload);
  const match = payloadText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const duplicatedVersionId = match ? match[0] : null;
  if (!duplicatedVersionId) {
    throw new Error('Missing duplicated version id');
  }
  return duplicatedVersionId;
})();
"@
  $dupId = Get-VersionIdFromUrl -Url "$dupResult"
  Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $dupId

  Invoke-AB $Session "find" "role" "button" "click" "--name" "Envoyer"
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Accepter"
  Invoke-AB $Session "reload"

  Wait-ForUrlContains -Session $Session -Needle "/dashboard/estimates/$dupId/edit" -TimeoutSeconds 30 | Out-Null

  Open-EstimatePrint -BaseUrl $BaseUrl -Session $Session -VersionId $dupId
  Invoke-AB $Session "pdf" $printPath
  if (-not (Test-Path $printPath)) { throw "Print PDF missing" }

  Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $dupId
  try {
    Click-FirstEnabledButtonByText -Session $Session -ButtonText "Exporter" -ScopeSelector "main"
  } catch {
    Invoke-AB $Session "find" "role" "button" "click" "--name" "Exporter" | Out-Null
  }
  Invoke-AB $Session "download" "text=Excel (.xlsx)" $xlsxPath
  try {
    Click-FirstEnabledButtonByText -Session $Session -ButtonText "Exporter" -ScopeSelector "main"
  } catch {
    Invoke-AB $Session "find" "role" "button" "click" "--name" "Exporter" | Out-Null
  }
  try {
    Invoke-AB $Session "download" "text=Fichier CSV (.csv)" $csvPath
  } catch {
    Invoke-AB $Session "download" "text=CSV" $csvPath
  }

  if (-not (Test-Path $xlsxPath)) { throw "Excel export missing" }
  if (-not (Test-Path $csvPath)) { throw "CSV export missing" }

  Write-Host "TI-140 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
