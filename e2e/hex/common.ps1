Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. "$PSScriptRoot/../agent-browser.ps1"

function Get-HexConfig {
  param(
    [string]$BaseUrl,
    [string]$Session
  )

  if (-not $Session) {
    $Session = "e2e-hex"
  }

  return Get-E2EConfig -BaseUrl $BaseUrl -Session $Session
}

function Require-AuthEnv {
  if (-not $env:E2E_LOGIN_EMAIL -or -not $env:E2E_LOGIN_PASSWORD) {
    throw "E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD must be set."
  }
}

function Get-E2ETempDir {
  if ($env:E2E_TMP_DIR) {
    if (-not (Test-Path $env:E2E_TMP_DIR)) {
      New-Item -ItemType Directory -Force -Path $env:E2E_TMP_DIR | Out-Null
    }
    return $env:E2E_TMP_DIR
  }

  $homeDir = [Environment]::GetFolderPath("UserProfile")
  if (-not $homeDir) {
    $homeDir = $env:HOME
  }
  if (-not $homeDir) {
    throw "Unable to resolve user home directory for E2E temp files."
  }

  $tempDir = Join-Path $homeDir ".agent-browser/tmp"
  if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
  }

  return $tempDir
}

function Invoke-AB {
  param(
    [string]$Session,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Args
  )

  return Invoke-AgentBrowser -Session $Session @Args
}

function Get-PageText {
  param([string]$Session)
  return Invoke-AB $Session "eval" "document.querySelector('main')?.innerText || ''"
}

function Assert-Contains {
  param(
    [string]$Text,
    [string]$Expected,
    [string]$Message
  )

  if ($Text -notlike "*$Expected*") {
    throw "Missing expected content: $Message"
  }
}

function Fill-PasswordInput {
  param(
    [string]$Session,
    [string]$Password
  )

  Invoke-AB $Session "fill" "#password" $Password | Out-Null
}

function Login-E2E {
  param([string]$BaseUrl, [string]$Session)
  Require-AuthEnv

  $maxLoginAttempts = 2
  for ($attempt = 1; $attempt -le $maxLoginAttempts; $attempt++) {
    Invoke-AB $Session "open" "$BaseUrl/login"
    Invoke-AB $Session "wait" "--load" "networkidle"
    Invoke-AB $Session "find" "label" "Email" "fill" $env:E2E_LOGIN_EMAIL
    Fill-PasswordInput -Session $Session -Password $env:E2E_LOGIN_PASSWORD
    Invoke-AB $Session "find" "role" "button" "click" "--name" "Se connecter"

    try {
      Wait-ForUrlContains -Session $Session -Needle "/dashboard" -TimeoutSeconds 45 | Out-Null
      return
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

      Invoke-AB $Session "open" "$BaseUrl/dashboard"
      Wait-ForUrlContains -Session $Session -Needle "/dashboard" -TimeoutSeconds 45 | Out-Null
      return
    }
  }
}

function Get-VersionIdFromUrl {
  param([string]$Url)
  if ($Url -match "/dashboard/estimates/([^/]+)/edit") {
    return $Matches[1]
  }
  throw "Unable to parse version id from url: $Url"
}

function New-Estimate {
  param(
    [string]$BaseUrl,
    [string]$Session,
    [string]$Project,
    [string]$Title,
    [string]$Date,
    [string]$Validite
  )

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates/new"
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/estimates/new" | Out-Null

  Invoke-AB $Session "find" "label" "Nom projet" "fill" $Project
  Invoke-AB $Session "find" "label" "Titre" "fill" $Title
  Invoke-AB $Session "find" "label" "Date devis" "fill" $Date
  Invoke-AB $Session "find" "label" "Validite" "fill" $Validite
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Creer le chiffrage"

  $url = Wait-ForUrlRegex -Session $Session -Pattern "/dashboard/estimates/[^/]+/edit" -TimeoutSeconds 60
  return Get-VersionIdFromUrl -Url $url
}

function Open-EstimateEdit {
  param([string]$BaseUrl, [string]$Session, [string]$VersionId)
  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates/$VersionId/edit"
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/estimates/$VersionId/edit" | Out-Null
}

function Open-EstimatePrint {
  param([string]$BaseUrl, [string]$Session, [string]$VersionId)
  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates/$VersionId/print"
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/estimates/$VersionId/print" | Out-Null
}

function Go-EditorTab {
  param([string]$Session)
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Editeur"
}

function Go-ParamsTab {
  param([string]$Session)
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Parametrage"
}

function Add-Chapter {
  param([string]$Session, [string]$Title)
  Invoke-AB $Session "find" "text" "+ Chapitre" "click"
  $titleJson = ConvertTo-Json $Title -Compress
  $js = @"
(() => {
  const titles = Array.from(document.querySelectorAll('input.estimate-input--title'));
  if (titles.length < 1) throw new Error('Missing chapter title input');
  const el = titles[0];
  el.focus();
  el.value = $titleJson;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
})();
"@
  Invoke-AB $Session "eval" $js
}

function Add-Line {
  param([string]$Session, [string]$Designation)
  Invoke-AB $Session "find" "text" "+ Ligne" "click"
  $designationJson = ConvertTo-Json $Designation -Compress
  $js = @"
(() => {
  const titles = Array.from(document.querySelectorAll('input.estimate-input--title'));
  if (titles.length < 2) throw new Error('Missing line title input');
  const el = titles[1];
  el.focus();
  el.value = $designationJson;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
})();
"@
  Invoke-AB $Session "eval" $js
}

function Set-LineValues {
  param(
    [string]$Session,
    [string]$Quantity,
    [string]$Unit,
    [string]$PriceFo,
    [string]$TypeFo,
    [string]$Kfo,
    [string]$HoursMo,
    [string]$Kmo
  )

  $values = @($Quantity, $Unit, $PriceFo, $TypeFo, $Kfo, $HoursMo, $Kmo)
  $jsonValues = ($values | ForEach-Object { ConvertTo-Json $_ -Compress }) -join ","

  $js = @"
(() => {
  const inputs = Array.from(document.querySelectorAll('input.estimate-input'));
  if (inputs.length < 7) throw new Error('Not enough line inputs');
  const set = (el, val) => {
    el.focus();
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const values = [$jsonValues];
  values.forEach((val, idx) => {
    if (inputs[idx]) set(inputs[idx], val);
  });
})();
"@
  Invoke-AB $Session "eval" $js
}

function Ensure-NoConsoleErrors {
  param([string]$Session)
  Invoke-AB $Session "errors" "--clear" | Out-Null
  $errors = Invoke-AB $Session "errors"
  if ($errors) {
    throw "Console errors detected: $errors"
  }
}

function Logout {
  param([string]$Session)
  Invoke-AB $Session "find" "text" "Se deconnecter" "click"
  Wait-ForUrlContains -Session $Session -Needle "/login" | Out-Null
}
