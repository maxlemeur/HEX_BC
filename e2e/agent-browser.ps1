Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-E2EConfig {
  param(
    [string]$BaseUrl,
    [string]$Session
  )

  if (-not $BaseUrl) {
    $BaseUrl = $env:E2E_BASE_URL
  }
  if (-not $BaseUrl) {
    $BaseUrl = "http://localhost:3000"
  }

  if (-not $Session) {
    $Session = $env:E2E_SESSION
  }
  if (-not $Session) {
    $Session = "e2e"
  }

  return @{
    BaseUrl = $BaseUrl
    Session = $Session
  }
}

function Require-AgentBrowser {
  if (-not (Get-Command agent-browser -ErrorAction SilentlyContinue)) {
    throw "Missing command 'agent-browser'. Install it and ensure it is on PATH."
  }
}

function Invoke-AgentBrowser {
  param(
    [Parameter(Mandatory = $true)][string]$Session,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Args
  )

  $cmd = @("--session", $Session)
  if ($env:E2E_HEADED -eq "1") {
    $cmd += "--headed"
  }
  $cmd += $Args

  $output = & agent-browser @cmd
  if ($LASTEXITCODE -ne 0) {
    throw "agent-browser failed: $($Args -join ' ')"
  }
  return $output
}

function Close-AgentBrowser {
  param([string]$Session)

  try {
    Invoke-AgentBrowser -Session $Session "close" | Out-Null
  } catch {
    # ignore close failures
  }
}
