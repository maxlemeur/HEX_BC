param(
  [string]$BaseUrl,
  [string]$Session
)

. "$PSScriptRoot/agent-browser.ps1"

$config = Get-E2EConfig -BaseUrl $BaseUrl -Session $Session
$BaseUrl = $config.BaseUrl
$Session = $config.Session

Require-AgentBrowser

try {
  Write-Host "E2E smoke starting: $BaseUrl"
  Invoke-AgentBrowser -Session $Session "open" $BaseUrl
  Invoke-AgentBrowser -Session $Session "wait" "--load" "networkidle"

  Invoke-AgentBrowser -Session $Session "find" "text" "Se connecter" "click"
  Invoke-AgentBrowser -Session $Session "wait" "--url" "**/login"

  Invoke-AgentBrowser -Session $Session "find" "label" "Email" "click"
  Invoke-AgentBrowser -Session $Session "find" "label" "Mot de passe" "click"

  Write-Host "E2E smoke passed."
} finally {
  Close-AgentBrowser -Session $Session
}
