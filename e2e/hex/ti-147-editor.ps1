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
$project = "E2E-HEX-TI147-$stamp"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-147" -Date "2026-02-02" -Validite "30"
  Go-EditorTab -Session $Session

  Add-Chapter -Session $Session -Title "Chapitre 1"
  Add-Line -Session $Session -Designation "Planches bois"
  Set-LineValues -Session $Session -Quantity "2" -Unit "m2" -PriceFo "100" -TypeFo "Materiaux" -Kfo "1.2" -HoursMo "3" -Kmo "0.5"

  Invoke-AB $Session "eval" "document.activeElement && typeof document.activeElement.blur === 'function' ? document.activeElement.blur() : null" | Out-Null
  Start-Sleep -Milliseconds 500
  Invoke-AB $Session "reload"
  Go-EditorTab -Session $Session
  $countsJson = Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const sectionCount = document.querySelectorAll('.estimate-row--section').length;
  const lineCount = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-line-checkbox'));
  }).length;
  return { sectionCount, lineCount };
})())
"@
  $countsText = [string]$countsJson
  $countsText = $countsText.Trim().Trim('"')
  if ($countsText.Contains('\"')) {
    $countsText = $countsText.Replace('\"', '"')
  }
  $counts = $countsText | ConvertFrom-Json
  if ([int]$counts.sectionCount -lt 1) {
    throw "Missing expected content: Chapter persisted"
  }
  if ([int]$counts.lineCount -lt 1) {
    throw "Missing expected content: Line persisted"
  }

  Write-Host "TI-147 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
