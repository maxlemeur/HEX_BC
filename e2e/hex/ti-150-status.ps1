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

  $js = "(() => { const inputs = Array.from(document.querySelectorAll('input')); return inputs.length ? inputs[1].disabled : false; })()"
  $disabled = Invoke-AB $Session "eval" $js
  if ($disabled -ne $true -and $disabled -ne "true") {
    throw "Inputs are not readonly after accept"
  }

  Write-Host "TI-150 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
