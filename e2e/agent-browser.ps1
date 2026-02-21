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

function Get-AgentBrowserDaemonPath {
  $cmd = Get-Command agent-browser -ErrorAction SilentlyContinue
  if (-not $cmd) {
    return $null
  }

  $baseDir = Split-Path $cmd.Source -Parent
  $daemonPath = Join-Path $baseDir "node_modules/agent-browser/dist/daemon.js"
  if (Test-Path $daemonPath) {
    return $daemonPath
  }

  return $null
}

function Start-AgentBrowserDaemon {
  $daemonPath = Get-AgentBrowserDaemonPath
  if (-not $daemonPath) {
    return $false
  }

  Start-Process -FilePath "node" -ArgumentList $daemonPath | Out-Null
  Start-Sleep -Milliseconds 800
  return $true
}

function Invoke-AgentBrowser {
  param(
    [Parameter(Mandatory = $true)][string]$Session,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Args
  )

  $cmd = @()
  if ($Session -and $env:E2E_DISABLE_SESSION -ne "1") {
    $cmd += @("--session", $Session)
  }
  if ($env:E2E_HEADED -eq "1") {
    $cmd += "--headed"
  }
  $cmd += $Args

  $maxAttempts = 4
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    $output = & agent-browser @cmd
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
      return $output
    }

    if ($attempt -lt $maxAttempts) {
      Start-AgentBrowserDaemon | Out-Null
      Start-Sleep -Milliseconds (300 * $attempt)
    }
  }

  throw "agent-browser failed: $($Args -join ' ')"
}

function Wait-ForUrlContains {
  param(
    [Parameter(Mandatory = $true)][string]$Session,
    [Parameter(Mandatory = $true)][string]$Needle,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null
  $lastUrl = ""

  while ((Get-Date) -lt $deadline) {
    try {
      $lastUrl = [string](Invoke-AgentBrowser -Session $Session "eval" "window.location.href")
      if ($lastUrl -like "*$Needle*") {
        return $lastUrl
      }
    } catch {
      $lastError = $_.Exception.Message
    }

    Start-Sleep -Milliseconds 500
  }

  if ($lastUrl) {
    throw "Timeout waiting URL containing '$Needle'. Current URL: $lastUrl"
  }

  if ($lastError) {
    throw "Timeout waiting URL containing '$Needle'. Last error: $lastError"
  }

  throw "Timeout waiting URL containing '$Needle'."
}

function Close-AgentBrowser {
  param([string]$Session)

  try {
    Invoke-AgentBrowser -Session $Session "close" | Out-Null
  } catch {
    # ignore close failures
  }
}
