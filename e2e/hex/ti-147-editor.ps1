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

  Invoke-AB $Session "reload"
  Go-EditorTab -Session $Session
  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected "Chapitre 1" -Message "Chapter persisted"
  Assert-Contains -Text $text -Expected "Planches bois" -Message "Line persisted"

  Write-Host "TI-147 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
