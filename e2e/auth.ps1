param(
  [string]$BaseUrl,
  [string]$Session,
  [string]$Email = $env:E2E_LOGIN_EMAIL,
  [string]$Password = $env:E2E_LOGIN_PASSWORD,
  [string]$AuthStatePath = $env:E2E_AUTH_STATE
)

if (-not $Session) {
  $Session = "e2e-auth"
}

. "$PSScriptRoot/agent-browser.ps1"

$config = Get-E2EConfig -BaseUrl $BaseUrl -Session $Session
$BaseUrl = $config.BaseUrl
$Session = $config.Session

if (-not $Email -or -not $Password) {
  throw "E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD must be set."
}

if (-not $AuthStatePath) {
  $AuthStatePath = "e2e/.auth.json"
}

$authDir = Split-Path -Parent $AuthStatePath
if ($authDir -and -not (Test-Path $authDir)) {
  New-Item -ItemType Directory -Force $authDir | Out-Null
}

Require-AgentBrowser

try {
  Write-Host "Saving auth state to $AuthStatePath"
  $maxLoginAttempts = 2

  for ($attempt = 1; $attempt -le $maxLoginAttempts; $attempt++) {
    Invoke-AgentBrowser -Session $Session "open" "$BaseUrl/login"
    Invoke-AgentBrowser -Session $Session "wait" "--load" "networkidle"

    Invoke-AgentBrowser -Session $Session "find" "label" "Email" "fill" $Email
    Invoke-AgentBrowser -Session $Session "fill" "#password" $Password | Out-Null
    Invoke-AgentBrowser -Session $Session "find" "role" "button" "click" "--name" "Se connecter"

    try {
      Wait-ForUrlContains -Session $Session -Needle "/dashboard" -TimeoutSeconds 45 | Out-Null
      break
    } catch {
      if ($attempt -lt $maxLoginAttempts) {
        Write-Host "Login attempt $attempt failed; retrying."
        Start-Sleep -Seconds 2
        continue
      }

      try {
        Wait-ForAuthCookie -Session $Session -TimeoutSeconds 45 | Out-Null
      } catch {
        Write-Host "Auth cookie not observed; falling back to dashboard access check."
      }

      Invoke-AgentBrowser -Session $Session "open" "$BaseUrl/dashboard"
      Wait-ForUrlContains -Session $Session -Needle "/dashboard" -TimeoutSeconds 45 | Out-Null
      break
    }
  }

  Invoke-AgentBrowser -Session $Session "state" "save" $AuthStatePath

  Write-Host "Auth state saved."
} finally {
  Close-AgentBrowser -Session $Session
}
