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
$project = "E2E-HEX-TI143-$stamp"
$title = "E2E TI-143"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates"
  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected "Chiffrages" -Message "Estimates list"

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title $title -Date "2026-02-02" -Validite "30"

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates/$versionId"
  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected "Chiffrage" -Message "Detail page"

  Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected "Editer le chiffrage" -Message "Edit page"

  Open-EstimatePrint -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected "Apercu avant impression" -Message "Print page"

  Write-Host "TI-143 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
