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

  $baseCmd = @()
  if ($Session -and $env:E2E_DISABLE_SESSION -ne "1") {
    $baseCmd += @("--session", $Session)
  }
  if ($env:E2E_HEADED -eq "1") {
    $baseCmd += "--headed"
  }
  $cmd = @($baseCmd + $Args)

  $maxAttempts = 4
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    $output = & agent-browser @cmd
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
      return $output
    }

    if ($attempt -lt $maxAttempts) {
      $outputText = [string]($output | Out-String)
      if ($Args.Count -gt 0 -and $Args[0] -ne "launch" -and $outputText -like "*Browser not launched*") {
        & agent-browser @baseCmd "launch" | Out-Null
        if ($LASTEXITCODE -eq 0) {
          Start-Sleep -Milliseconds (250 * $attempt)
          continue
        }
      }

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

function Wait-ForUrlRegex {
  param(
    [Parameter(Mandatory = $true)][string]$Session,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null
  $lastUrl = ""

  while ((Get-Date) -lt $deadline) {
    try {
      $lastUrl = [string](Invoke-AgentBrowser -Session $Session "eval" "window.location.href")
      if ($lastUrl -match $Pattern) {
        return $lastUrl
      }
    } catch {
      $lastError = $_.Exception.Message
    }

    Start-Sleep -Milliseconds 500
  }

  if ($lastUrl) {
    throw "Timeout waiting URL regex '$Pattern'. Current URL: $lastUrl"
  }

  if ($lastError) {
    throw "Timeout waiting URL regex '$Pattern'. Last error: $lastError"
  }

  throw "Timeout waiting URL regex '$Pattern'."
}

function Get-SupabaseAuthCookieName {
  $supabaseUrl = $env:NEXT_PUBLIC_SUPABASE_URL
  if (-not $supabaseUrl) {
    return $null
  }

  try {
    $supabaseHost = ([Uri]$supabaseUrl).Host
  } catch {
    return $null
  }

  if (-not $supabaseHost) {
    return $null
  }

  $projectRef = $supabaseHost -replace "\.supabase\.co$", ""
  if ($projectRef -eq $supabaseHost -or -not $projectRef) {
    return $null
  }

  return "sb-$projectRef-auth-token"
}

function Wait-ForAuthCookie {
  param(
    [Parameter(Mandatory = $true)][string]$Session,
    [int]$TimeoutSeconds = 45
  )

  $cookieName = Get-SupabaseAuthCookieName
  if (-not $cookieName) {
    throw "Unable to infer Supabase auth cookie name from NEXT_PUBLIC_SUPABASE_URL."
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastCookie = ""
  $escapedCookieName = [Regex]::Escape($cookieName)

  while ((Get-Date) -lt $deadline) {
    $rawCookie = [string](Invoke-AgentBrowser -Session $Session "eval" "document.cookie")
    $lastCookie = $rawCookie.Trim('"')
    if ($lastCookie -match "(^|;\s*)$escapedCookieName(\.\d+)?=") {
      return $lastCookie
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Timeout waiting auth cookie '$cookieName'. Current cookie: $lastCookie"
}

function Close-AgentBrowser {
  param([string]$Session)

  try {
    Invoke-AgentBrowser -Session $Session "close" | Out-Null
  } catch {
    # ignore close failures
  }
}
