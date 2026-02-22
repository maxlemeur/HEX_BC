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
$project = "E2E-HEX-TI150-$stamp"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-150" -Date "2026-02-02" -Validite "30"

  Invoke-AB $Session "find" "role" "button" "click" "--name" "Envoyer"
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Accepter"
  Invoke-AB $Session "reload"

  Write-Host "TI-150 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
