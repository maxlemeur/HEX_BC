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
    $Session = "e2e-$PID"
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

function ConvertTo-AgentBrowserText {
  param([object]$RawOutput)

  if ($null -eq $RawOutput) {
    return ""
  }

  if ($RawOutput -is [System.Array]) {
    $text = ($RawOutput | ForEach-Object { [string]$_ }) -join "`n"
  } else {
    $text = [string]$RawOutput
  }

  $text = $text -replace "`e\[[0-9;?]*[ -/]*[@-~]", ""
  $text = $text -replace "[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", ""
  return $text.Trim()
}

function Select-AgentBrowserStablePayload {
  param([string]$RawText)

  $text = ConvertTo-AgentBrowserText -RawOutput $RawText
  if (-not $text) {
    return ""
  }

  if ($text -notmatch "`n") {
    return $text
  }

  $lines = @(
    $text -split "`r?`n" |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -ne "" }
  )
  if ($lines.Count -eq 0) {
    return $text
  }

  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    $candidate = $lines[$i]
    if ($candidate -match "^\{.*\}$" -or
      $candidate -match "^\[.*\]$" -or
      $candidate -match '^".*"$' -or
      $candidate -match "^(true|false|null)$" -or
      $candidate -match "^-?\d+(\.\d+)?$"
    ) {
      return $candidate
    }
  }

  return $text
}

function ConvertFrom-AgentBrowserJson {
  param([object]$RawOutput)

  $text = Select-AgentBrowserStablePayload -RawText (ConvertTo-AgentBrowserText -RawOutput $RawOutput)
  if (-not $text) {
    throw "agent-browser JSON payload is empty."
  }

  try {
    return $text | ConvertFrom-Json
  } catch {
    throw "Failed to parse agent-browser JSON payload: $text"
  }
}

function Test-IsTransientAgentBrowserError {
  param([string]$ErrorText)

  if (-not $ErrorText) {
    return $false
  }

  $patterns = @(
    "Invalid response:\s*EOF",
    "Resource temporarily unavailable \(os error 11\)",
    "transport error",
    "socket hang up",
    "ECONNRESET",
    "EPIPE",
    "broken pipe",
    "connection reset"
  )

  foreach ($pattern in $patterns) {
    if ($ErrorText -match $pattern) {
      return $true
    }
  }

  return $false
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

  $action = ""
  if ($Args.Count -gt 0) {
    $action = $Args[0].ToLowerInvariant()
  }

  $isDownload = $action -eq "download"
  $isClose = $action -eq "close"
  $isEval = $action -eq "eval"
  $maxAttempts = 4
  $baseDelayMs = 300

  if ($isEval) {
    $maxAttempts = 6
    $baseDelayMs = 350
  }

  if ($isDownload) {
    $maxAttempts = 4
    $baseDelayMs = 200
  } elseif ($isClose) {
    $maxAttempts = 3
    $baseDelayMs = 120
  }

  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    $output = & agent-browser @cmd 2>&1
    $exitCode = $LASTEXITCODE
    $outputText = ConvertTo-AgentBrowserText -RawOutput $output
    if ($exitCode -eq 0) {
      return (Select-AgentBrowserStablePayload -RawText $outputText)
    }

    $retryReason = $null
    if ($Args.Count -gt 0 -and $Args[0] -ne "launch" -and $outputText -like "*Browser not launched*") {
      $retryReason = "browser-not-launched"
      if ($attempt -lt $maxAttempts) {
        & agent-browser @baseCmd "launch" | Out-Null
        if ($LASTEXITCODE -eq 0) {
          Start-Sleep -Milliseconds (200 * $attempt)
        }
      }
    } elseif (Test-IsTransientAgentBrowserError -ErrorText $outputText) {
      $retryReason = "transient-transport"
    } elseif ($isDownload) {
      $retryReason = "download-retry"
    } elseif ($isClose) {
      $retryReason = "close-retry"
    }

    if ($attempt -lt $maxAttempts -and $retryReason) {
      Start-AgentBrowserDaemon | Out-Null
      Start-Sleep -Milliseconds ($baseDelayMs * $attempt)
      continue
    }

    $detail = if ($outputText) { $outputText } else { "exit code $exitCode" }
    throw "agent-browser failed ($retryReason) for '$($Args -join ' ')': $detail"
  }

  throw "agent-browser failed: $($Args -join ' ')"
}

function Normalize-AgentBrowserUrlOutput {
  param([string]$RawOutput)

  if (-not $RawOutput) {
    return ""
  }

  $text = ConvertTo-AgentBrowserText -RawOutput $RawOutput
  $text = $text.Trim().Trim('"')
  $urlMatches = [regex]::Matches($text, "https?://[^\s`"]+")
  if ($urlMatches.Count -gt 0) {
    return $urlMatches[$urlMatches.Count - 1].Value
  }

  return $text
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
      $lastUrl = Normalize-AgentBrowserUrlOutput ([string](Invoke-AgentBrowser -Session $Session "eval" "window.location.href"))
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
      $lastUrl = Normalize-AgentBrowserUrlOutput ([string](Invoke-AgentBrowser -Session $Session "eval" "window.location.href"))
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
