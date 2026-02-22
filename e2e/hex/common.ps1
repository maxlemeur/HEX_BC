Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. "$PSScriptRoot/../agent-browser.ps1"

function Get-HexConfig {
  param(
    [string]$BaseUrl,
    [string]$Session
  )

  if (-not $Session) {
    $Session = "e2e-hex-$PID"
  }

  return Get-E2EConfig -BaseUrl $BaseUrl -Session $Session
}

function Require-AuthEnv {
  if (-not $env:E2E_LOGIN_EMAIL -or -not $env:E2E_LOGIN_PASSWORD) {
    throw "E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD must be set."
  }
}

function Resolve-E2EPath {
  param([string]$Path)

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return $Path
  }

  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Path))
}

function Use-E2EAuthCache {
  $raw = "$env:E2E_AUTH_CACHE".Trim()
  if (-not $raw) {
    return $true
  }

  $normalized = $raw.ToLowerInvariant()
  return -not @("0", "false", "off", "no").Contains($normalized)
}

function Get-E2EAuthStatePath {
  if ($env:E2E_AUTH_STATE) {
    return Resolve-E2EPath -Path $env:E2E_AUTH_STATE
  }

  $defaultPath = Join-Path (Split-Path -Parent $PSScriptRoot) ".auth.json"
  return Resolve-E2EPath -Path $defaultPath
}

function Save-E2EAuthState {
  param([string]$Session)

  if (-not (Use-E2EAuthCache)) {
    return
  }

  $authStatePath = Get-E2EAuthStatePath
  $authDir = Split-Path -Parent $authStatePath
  if ($authDir -and -not (Test-Path $authDir)) {
    New-Item -ItemType Directory -Force -Path $authDir | Out-Null
  }

  try {
    Invoke-AB $Session "state" "save" $authStatePath | Out-Null
    Write-Host "Auth state saved to $authStatePath"
  } catch {
    Write-Host "Could not save auth state to ${authStatePath}: $($_.Exception.Message)"
  }
}

function Try-LoadAuthState {
  param(
    [string]$BaseUrl,
    [string]$Session,
    [int]$TimeoutSeconds = 12
  )

  if (-not (Use-E2EAuthCache)) {
    return $false
  }

  $authStatePath = Get-E2EAuthStatePath
  if (-not (Test-Path $authStatePath)) {
    return $false
  }

  try {
    Invoke-AB $Session "--state" $authStatePath "open" "$BaseUrl/dashboard" | Out-Null
    Wait-ForUrlContains -Session $Session -Needle "/dashboard" -TimeoutSeconds $TimeoutSeconds | Out-Null
    Write-Host "Using cached auth state: $authStatePath"
    return $true
  } catch {
    Write-Host "Cached auth state invalid. Reason: $($_.Exception.Message)"
    Write-Host "Falling back to UI login."
    return $false
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
  $raw = Invoke-AB $Session "eval" "JSON.stringify(document.querySelector('main')?.innerText || '')"
  try {
    return [string](ConvertFrom-AgentBrowserJson -RawOutput $raw)
  } catch {
    return [string]$raw
  }
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

  if (Try-LoadAuthState -BaseUrl $BaseUrl -Session $Session) {
    return
  }

  Require-AuthEnv

  $maxLoginAttempts = 2
  for ($attempt = 1; $attempt -le $maxLoginAttempts; $attempt++) {
    Invoke-AB $Session "open" "$BaseUrl/login"
    Invoke-AB $Session "wait" "--load" "networkidle" | Out-Null
    Invoke-AB $Session "find" "label" "Email" "fill" $env:E2E_LOGIN_EMAIL | Out-Null
    Fill-PasswordInput -Session $Session -Password $env:E2E_LOGIN_PASSWORD
    Invoke-AB $Session "find" "role" "button" "click" "--name" "Se connecter" | Out-Null

    try {
      Wait-ForUrlContains -Session $Session -Needle "/dashboard" -TimeoutSeconds 45 | Out-Null
      Save-E2EAuthState -Session $Session
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

      Invoke-AB $Session "open" "$BaseUrl/dashboard" | Out-Null
      Wait-ForUrlContains -Session $Session -Needle "/dashboard" -TimeoutSeconds 45 | Out-Null
      Save-E2EAuthState -Session $Session
      return
    }
  }
}

function Get-VersionIdFromUrl {
  param([string]$Url)

  function Try-ExtractUuid {
    param([string]$Text)
    if (-not $Text) {
      return $null
    }

    $normalized = $Text
    $normalized = $normalized -replace "`e\[[0-9;?]*[ -/]*[@-~]", ""
    $normalized = $normalized -replace "[\x00-\x1F\x7F]", ""
    $normalized = $normalized -replace "[‐‑‒–—−]", "-"
    $normalized = $normalized.Trim().Trim('"')

    $match = [regex]::Matches(
      $normalized,
      "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    )
    if ($match.Count -gt 0) {
      return $match[$match.Count - 1].Value.ToLowerInvariant()
    }

    return $null
  }

  $clean = $Url
  $clean = $clean -replace "`e\[[0-9;?]*[ -/]*[@-~]", ""
  $clean = $clean -replace "[\x00-\x1F\x7F]", ""
  $clean = $clean -replace "[‐‑‒–—−]", "-"
  $clean = $clean.Trim().Trim('"')
  $decoded = $clean
  try {
    $decoded = [Uri]::UnescapeDataString($clean)
  } catch {
    $decoded = $clean
  }

  foreach ($candidate in @($clean, $decoded, $Url)) {
    $candidateUuid = Try-ExtractUuid -Text $candidate
    if ($candidateUuid) {
      return $candidateUuid
    }
  }

  if ($decoded -match "/dashboard/estimates/([^/]+)/edit") {
    $segment = $Matches[1]
    $segmentUuid = Try-ExtractUuid -Text $segment
    if ($segmentUuid) {
      return $segmentUuid
    }
    return $segment
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

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates/new" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/estimates/new" | Out-Null

  Invoke-AB $Session "find" "label" "Nom projet" "fill" $Project | Out-Null
  Invoke-AB $Session "find" "label" "Titre" "fill" $Title | Out-Null
  Invoke-AB $Session "find" "label" "Date devis" "fill" $Date | Out-Null
  Invoke-AB $Session "find" "label" "Validite" "fill" $Validite | Out-Null
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Creer le chiffrage" | Out-Null

  $url = Wait-ForUrlRegex -Session $Session -Pattern "/dashboard/estimates/[^/]+/edit" -TimeoutSeconds 60
  return Get-VersionIdFromUrl -Url $url
}

function Open-EstimateEdit {
  param([string]$BaseUrl, [string]$Session, [string]$VersionId)
  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates/$VersionId/edit" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/estimates/$VersionId/edit" | Out-Null
}

function Open-EstimatePrint {
  param([string]$BaseUrl, [string]$Session, [string]$VersionId)
  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates/$VersionId/print" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/estimates/$VersionId/print" | Out-Null
}

function Go-EditorTab {
  param([string]$Session)
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Editeur" | Out-Null
}

function Go-ParamsTab {
  param([string]$Session)
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Parametrage" | Out-Null
}

function Set-EditableTitleValue {
  param(
    [string]$Session,
    [string]$Value
  )

  $valueJson = ConvertTo-Json $Value -Compress
  $js = @"
(() => {
  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  };

  const isEditable = (el) => {
    if (!el || el.disabled) return false;
    return el.matches('input, textarea, [contenteditable=\"true\"], [role=\"textbox\"]') || el.isContentEditable;
  };

  const candidates = [];
  const active = document.activeElement;
  if (isEditable(active) && isVisible(active)) {
    candidates.push(active);
  }

  for (const el of document.querySelectorAll(
    'input.estimate-input--title, input[type=\"text\"], textarea, [contenteditable=\"true\"], [role=\"textbox\"]'
  )) {
    if (!isEditable(el) || !isVisible(el)) continue;
    if (!candidates.includes(el)) {
      candidates.push(el);
    }
  }

  if (candidates.length === 0) {
    throw new Error('No editable title field found');
  }

  const el = candidates[candidates.length - 1];
  el.focus();

  if ('value' in el) {
    el.value = $valueJson;
  } else {
    el.textContent = $valueJson;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
})();
"@
  Invoke-AB $Session "eval" $js | Out-Null
}

function Wait-ForButtonEnabledByText {
  param(
    [string]$Session,
    [string]$ButtonText,
    [string]$ScopeSelector = "",
    [int]$TimeoutSeconds = 20
  )

  $buttonTextJson = ConvertTo-Json $ButtonText -Compress
  $scopeSelectorJson = ConvertTo-Json $ScopeSelector -Compress
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $enabled = Invoke-AB $Session "eval" @"
(() => {
  const text = $buttonTextJson;
  const scopeSelector = $scopeSelectorJson;
  const roots = [];
  if (scopeSelector) {
    const scoped = document.querySelector(scopeSelector);
    if (scoped) roots.push(scoped);
  }
  roots.push(document);

  let btn = null;
  for (const root of roots) {
    btn = Array.from(root.querySelectorAll('button')).find(
      (b) => (b.textContent || '').replace(/\\s+/g, ' ').trim() === text
    );
    if (btn) break;
  }

  return Boolean(btn && !btn.disabled);
})();
"@

    if ($enabled -eq $true -or "$enabled" -eq "true") {
      return
    }

    Start-Sleep -Milliseconds 400
  }

  throw "Timeout waiting enabled button '$ButtonText'"
}

function Wait-ForTitleInputsAtLeast {
  param(
    [string]$Session,
    [int]$MinCount,
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $count = Invoke-AB $Session "eval" "document.querySelectorAll('input.estimate-input--title').length"
    if ([int]$count -ge $MinCount) {
      return
    }
    Start-Sleep -Milliseconds 300
  }

  throw "Timeout waiting title inputs >= $MinCount"
}

function Wait-ForTitleInputsIncrease {
  param(
    [string]$Session,
    [int]$PreviousCount,
    [int]$Increment = 1,
    [int]$TimeoutSeconds = 10
  )

  $targetCount = $PreviousCount + $Increment
  Wait-ForTitleInputsAtLeast -Session $Session -MinCount $targetCount -TimeoutSeconds $TimeoutSeconds
}

function Click-FirstEnabledButtonByText {
  param(
    [string]$Session,
    [string]$ButtonText,
    [string]$ScopeSelector = ""
  )

  $buttonTextJson = ConvertTo-Json $ButtonText -Compress
  $scopeSelectorJson = ConvertTo-Json $ScopeSelector -Compress
  Invoke-AB $Session "eval" @"
(() => {
  const text = $buttonTextJson;
  const scopeSelector = $scopeSelectorJson;
  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  };

  const roots = [];
  if (scopeSelector) {
    const scoped = document.querySelector(scopeSelector);
    if (scoped) roots.push(scoped);
  }
  roots.push(document);

  let button = null;
  for (const root of roots) {
    button = Array.from(root.querySelectorAll('button')).find((candidate) => {
      const candidateText = String(candidate.textContent ?? '').replace(/\s+/g, ' ').trim();
      return candidateText === text && !candidate.disabled && isVisible(candidate);
    });
    if (button) break;
  }

  if (!button) {
    throw new Error('No enabled visible button found with text: ' + text);
  }

  button.click();
})();
"@ | Out-Null
}

function Add-Chapter {
  param([string]$Session, [string]$Title)
  $beforeCount = [int](Invoke-AB $Session "eval" "document.querySelectorAll('input.estimate-input--title').length")
  Wait-ForButtonEnabledByText -Session $Session -ButtonText "+ Chapitre" -ScopeSelector "main" -TimeoutSeconds 20
  Click-FirstEnabledButtonByText -Session $Session -ButtonText "+ Chapitre" -ScopeSelector "main"
  Wait-ForTitleInputsIncrease -Session $Session -PreviousCount $beforeCount -Increment 1 -TimeoutSeconds 10
  Set-EditableTitleValue -Session $Session -Value $Title
}

function Add-Line {
  param([string]$Session, [string]$Designation)
  $beforeCount = [int](Invoke-AB $Session "eval" "document.querySelectorAll('input.estimate-input--title').length")
  Wait-ForButtonEnabledByText -Session $Session -ButtonText "+ Ligne" -ScopeSelector "main" -TimeoutSeconds 20
  Click-FirstEnabledButtonByText -Session $Session -ButtonText "+ Ligne" -ScopeSelector "main"
  Wait-ForTitleInputsIncrease -Session $Session -PreviousCount $beforeCount -Increment 1 -TimeoutSeconds 10
  Set-EditableTitleValue -Session $Session -Value $Designation
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
  Invoke-AB $Session "find" "text" "Se deconnecter" "click" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/login" | Out-Null
}
