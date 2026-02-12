param(
  [string]$BaseUrl,
  [string]$Session
)

. "$PSScriptRoot/common.ps1"

function Login-As {
  param([string]$BaseUrl, [string]$Session, [string]$Email, [string]$Password)
  Invoke-AB $Session "open" "$BaseUrl/login"
  Invoke-AB $Session "wait" "--load" "networkidle"
  Invoke-AB $Session "find" "label" "Email" "fill" $Email
  Invoke-AB $Session "find" "label" "Mot de passe" "fill" $Password
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Se connecter"
  Invoke-AB $Session "wait" "--url" "**/dashboard/**" | Out-Null
}

$config = Get-HexConfig -BaseUrl $BaseUrl -Session $Session
$BaseUrl = $config.BaseUrl
$Session = $config.Session

Require-AgentBrowser
Require-AuthEnv

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$project = "E2E-HEX-TI141-$stamp"

$secondaryEmail = $env:E2E_LOGIN_EMAIL_2
$secondaryPassword = $env:E2E_LOGIN_PASSWORD_2

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session
  New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-141" -Date "2026-02-02" -Validite "30" | Out-Null

  Logout -Session $Session

  if (-not $secondaryEmail -or -not $secondaryPassword) {
    Write-Host "TI-141 SKIP (missing E2E_LOGIN_EMAIL_2 / E2E_LOGIN_PASSWORD_2)"
    return
  }

  Login-As -BaseUrl $BaseUrl -Session $Session -Email $secondaryEmail -Password $secondaryPassword
  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates"
  $text = Get-PageText -Session $Session
  if ($text -like "*$project*") {
    throw "Secondary user can see primary data"
  }

  Write-Host "TI-141 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
