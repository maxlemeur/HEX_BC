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
$project = "E2E-HEX-TI145-$stamp"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-145" -Date "2026-02-02" -Validite "30"
  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected "Brouillon" -Message "Default status"
  Assert-Contains -Text $text -Expected "Version" -Message "Version label"

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates"
  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected $project -Message "List entry"

  Write-Host "TI-145 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
