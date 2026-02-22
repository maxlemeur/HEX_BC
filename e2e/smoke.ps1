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

  try {
    Invoke-AgentBrowser -Session $Session "find" "role" "link" "click" "--name" "Se connecter"
  } catch {
    Invoke-AgentBrowser -Session $Session "find" "role" "button" "click" "--name" "Se connecter"
  }
  Wait-ForUrlContains -Session $Session -Needle "/login" | Out-Null

  Invoke-AgentBrowser -Session $Session "find" "label" "Email" "click"
  Invoke-AgentBrowser -Session $Session "click" "#password"

  Write-Host "E2E smoke passed."
} finally {
  Close-AgentBrowser -Session $Session
}
