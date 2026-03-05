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

function Wait-ForSelector {
  param(
    [string]$Session,
    [string]$Selector,
    [int]$TimeoutSeconds = 10
  )

  $selectorJson = ConvertTo-Json $Selector -Compress
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $isVisible = Invoke-AB $Session "eval" @"
(() => {
  const selector = $selectorJson;
  const element = document.querySelector(selector);
  if (!element) return false;
  const style = window.getComputedStyle(element);
  if (!style) return true;
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
})();
"@

    if ($isVisible -eq $true -or "$isVisible" -eq "true") {
      return
    }

    Start-Sleep -Milliseconds 250
  }

  throw "Timeout waiting selector '$Selector'"
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

  Wait-ForSelector -Session $Session -Selector "#wiz-title" -TimeoutSeconds 20

  $hasProjectNameField = Invoke-AB $Session "eval" "Boolean(document.querySelector('#wiz-project-name'))"
  if ($hasProjectNameField -eq $true -or "$hasProjectNameField" -eq "true") {
    Invoke-AB $Session "fill" "#wiz-project-name" $Project | Out-Null
  }
  Invoke-AB $Session "fill" "#wiz-title" $Title | Out-Null

  Wait-ForButtonEnabledByText -Session $Session -ButtonText "Suivant" -ScopeSelector "main" -TimeoutSeconds 20
  Click-FirstEnabledButtonByText -Session $Session -ButtonText "Suivant" -ScopeSelector "main"

  Wait-ForSelector -Session $Session -Selector "#wiz-date-devis" -TimeoutSeconds 20
  Invoke-AB $Session "fill" "#wiz-date-devis" $Date | Out-Null
  Invoke-AB $Session "fill" "#wiz-validite" $Validite | Out-Null

  Wait-ForButtonEnabledByText -Session $Session -ButtonText "Suivant" -ScopeSelector "main" -TimeoutSeconds 20
  Click-FirstEnabledButtonByText -Session $Session -ButtonText "Suivant" -ScopeSelector "main"

  $createLabels = @("Créer le chiffrage", "Creer le chiffrage")
  $didClickCreate = $false
  foreach ($label in $createLabels) {
    try {
      Wait-ForButtonEnabledByText -Session $Session -ButtonText $label -ScopeSelector "main" -TimeoutSeconds 6
      Click-FirstEnabledButtonByText -Session $Session -ButtonText $label -ScopeSelector "main"
      $didClickCreate = $true
      break
    } catch {
      continue
    }
  }

  if (-not $didClickCreate) {
    throw "Unable to find create button in estimate wizard."
  }

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

function Test-EditorSurfaceVisible {
  param([string]$Session)

  $isVisible = Invoke-AB $Session "eval" @"
(() => {
  const root = document.querySelector('main') ?? document;
  if (root.querySelector('input.estimate-input--title')) return true;
  if (root.querySelector('.estimate-editor-table')) return true;
  if (root.querySelector('button[title=\"Paramétrage\"]')) return true;
  if (root.querySelector('button[title=\"Parametrage\"]')) return true;
  return Array.from(root.querySelectorAll('button')).some((button) => {
    const text = String(button.textContent ?? '').replace(/\s+/g, ' ').trim();
    return (
      text === '+ Chapitre' ||
      text === '+ Ligne' ||
      text === '+ Ajouter un Lot' ||
      text === '+ Ajouter un Chapitre' ||
      text === '+ AID'
    );
  });
})();
"@

  return ($isVisible -eq $true -or "$isVisible" -eq "true")
}

function Wait-ForEditorSurface {
  param(
    [string]$Session,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastSnippet = ""

  while ((Get-Date) -lt $deadline) {
    if (Test-EditorSurfaceVisible -Session $Session) {
      return
    }

    $snippet = Invoke-AB $Session "eval" "(document.querySelector('main')?.innerText || '').slice(0, 240)"
    if ($snippet) {
      $lastSnippet = [string]$snippet
    }

    Start-Sleep -Milliseconds 300
  }

  if ($lastSnippet) {
    throw "Timeout waiting editor surface. Last main text: $lastSnippet"
  }

  throw "Timeout waiting editor surface."
}

function Try-ClickButtonByLabels {
  param(
    [string]$Session,
    [string[]]$Labels,
    [string]$ScopeSelector = "main",
    [int]$TimeoutPerLabelSeconds = 6
  )

  foreach ($label in $Labels) {
    try {
      Wait-ForButtonEnabledByText -Session $Session -ButtonText $label -ScopeSelector $ScopeSelector -TimeoutSeconds $TimeoutPerLabelSeconds
      Click-FirstEnabledButtonByText -Session $Session -ButtonText $label -ScopeSelector $ScopeSelector
      return $true
    } catch {
      continue
    }
  }

  return $false
}

function Try-ClickButtonByLabelsAnyVisibility {
  param(
    [string]$Session,
    [string[]]$Labels,
    [string]$ScopeSelector = "main"
  )

  foreach ($label in $Labels) {
    $labelJson = ConvertTo-Json $label -Compress
    $scopeSelectorJson = ConvertTo-Json $ScopeSelector -Compress
    $clicked = Invoke-AB $Session "eval" @"
(() => {
  const text = $labelJson;
  const scopeSelector = $scopeSelectorJson;
  const root = scopeSelector ? document.querySelector(scopeSelector) : document;
  if (!root) return false;
  const button = Array.from(root.querySelectorAll('button')).find((candidate) => {
    const candidateText = String(candidate.textContent ?? '').replace(/\s+/g, ' ').trim();
    return candidateText === text && !candidate.disabled;
  });
  if (!button) return false;
  button.click();
  return true;
})();
"@
    if ($clicked -eq $true -or "$clicked" -eq "true") {
      return $true
    }
  }

  return $false
}

function Go-EditorTab {
  param([string]$Session)

  Try-ClickButtonByLabels -Session $Session -Labels @("Editeur", "Éditeur") | Out-Null
  Wait-ForEditorSurface -Session $Session -TimeoutSeconds 45
}

function Go-ParamsTab {
  param([string]$Session)

  Wait-ForEditorSurface -Session $Session -TimeoutSeconds 45
  $clicked = Try-ClickButtonByLabels -Session $Session -Labels @("Parametrage", "Paramétrage")

  if (-not $clicked) {
    $clickedByTitle = Invoke-AB $Session "eval" @"
(() => {
  const selectors = [
    'button[title="Paramétrage"]',
    'button[title="Parametrage"]'
  ];
  for (const selector of selectors) {
    const button = document.querySelector(selector);
    if (button && !button.disabled) {
      button.click();
      return true;
    }
  }
  return false;
})();
"@
    $clicked = ($clickedByTitle -eq $true -or "$clickedByTitle" -eq "true")
  }

  if (-not $clicked) {
    $alreadyOpen = Invoke-AB $Session "eval" "Boolean(document.querySelector('[aria-label=\"Paramétrage du devis\"]'))"
    if ($alreadyOpen -eq $true -or "$alreadyOpen" -eq "true") {
      return
    }
    throw "Unable to find settings access button."
  }

  Wait-ForSelector -Session $Session -Selector "[aria-label='Paramétrage du devis']" -TimeoutSeconds 20
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

function Set-LatestSectionTitleValue {
  param(
    [string]$Session,
    [string]$Value
  )

  $valueJson = ConvertTo-Json $Value -Compress
  Invoke-AB $Session "eval" @"
(() => {
  const sectionRows = Array.from(document.querySelectorAll('.estimate-row.estimate-row--section'));
  if (sectionRows.length === 0) {
    throw new Error('No section row found');
  }

  const targetRow = sectionRows[sectionRows.length - 1];
  const input = targetRow.querySelector('input.estimate-input--title');
  if (!input) {
    throw new Error('No section title input found');
  }

  input.focus();
  input.value = $valueJson;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
})();
"@ | Out-Null
}

function Set-LatestLineTitleValue {
  param(
    [string]$Session,
    [string]$Value
  )

  $valueJson = ConvertTo-Json $Value -Compress
  Invoke-AB $Session "eval" @"
(() => {
  const lineRows = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-line-checkbox'));
  });
  if (lineRows.length === 0) {
    throw new Error('No line row found');
  }

  const targetRow = lineRows[lineRows.length - 1];
  const input = targetRow.querySelector('input.estimate-input--title');
  if (!input) {
    throw new Error('No line title input found');
  }

  input.focus();
  input.value = $valueJson;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
})();
"@ | Out-Null
}

function Get-LineRowCount {
  param([string]$Session)

  return [int](Invoke-AB $Session "eval" @"
(() => Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
  return !row.classList.contains('estimate-row--section') &&
    Boolean(row.querySelector('input.estimate-line-checkbox'));
}).length)()
"@)
}

function Wait-ForLineRowsIncrease {
  param(
    [string]$Session,
    [int]$PreviousCount,
    [int]$Increment = 1,
    [int]$TimeoutSeconds = 12
  )

  $targetCount = $PreviousCount + $Increment
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $lineCount = Get-LineRowCount -Session $Session
    if ($lineCount -ge $targetCount) {
      return
    }

    Start-Sleep -Milliseconds 300
  }

  throw "Timeout waiting line rows >= $targetCount"
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

  Wait-ForEditorSurface -Session $Session -TimeoutSeconds 45
  $beforeCount = [int](Invoke-AB $Session "eval" "document.querySelectorAll('input.estimate-input--title').length")
  $clicked = Try-ClickButtonByLabels -Session $Session -Labels @(
    "+ Chapitre",
    "+ Ajouter un Lot",
    "+ Ajouter un Chapitre"
  ) -ScopeSelector "main" -TimeoutPerLabelSeconds 8

  if (-not $clicked) {
    throw "Unable to find chapter creation button."
  }

  Wait-ForTitleInputsIncrease -Session $Session -PreviousCount $beforeCount -Increment 1 -TimeoutSeconds 20
  Set-LatestSectionTitleValue -Session $Session -Value $Title
}

function Add-Line {
  param([string]$Session, [string]$Designation)

  Wait-ForEditorSurface -Session $Session -TimeoutSeconds 45
  $sectionCount = [int](Invoke-AB $Session "eval" "document.querySelectorAll('.estimate-row.estimate-row--section').length")
  if ($sectionCount -eq 0) {
    Add-Chapter -Session $Session -Title "Nouveau lot"
  }

  $beforeCount = [int](Invoke-AB $Session "eval" "document.querySelectorAll('input.estimate-input--title').length")
  $beforeRows = [int](Invoke-AB $Session "eval" "document.querySelectorAll('.estimate-row').length")
  $lineBefore = Get-LineRowCount -Session $Session
  $lineLabels = @(
    "+ Ligne",
    "+ Ajouter une ligne",
    "+ Ajouter une ligne Lot",
    "+ Ajouter une ligne Chapitre",
    "+ Ajouter une ligne Sous-chapitre",
    "+ Ajouter une ligne Ouvrage"
  )
  $sectionLabels = @(
    "+ Ajouter un Chapitre",
    "+ Ajouter un Sous-chapitre",
    "+ Ajouter un Ouvrage",
    "+ Ajouter un Niveau 4"
  )

  $lineCreated = $false
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    $clickedLine = Try-ClickButtonByLabels -Session $Session -Labels $lineLabels -ScopeSelector "main" -TimeoutPerLabelSeconds 4
    if (-not $clickedLine) {
      $actionsOpened = Invoke-AB $Session "eval" @"
(() => {
  const actionButtons = Array.from(document.querySelectorAll('main button')).filter((button) => {
    const ariaLabel = String(button.getAttribute('aria-label') ?? '').trim();
    return ariaLabel === 'Actions' && !button.disabled;
  });
  if (actionButtons.length === 0) return false;
  const target = actionButtons[actionButtons.length - 1];
  target.click();
  return true;
})();
"@
      if ($actionsOpened -eq $true -or "$actionsOpened" -eq "true") {
        $clickedLine = Try-ClickButtonByLabels -Session $Session -Labels $lineLabels -ScopeSelector "main" -TimeoutPerLabelSeconds 3
        if (-not $clickedLine) {
          $clickedLine = Try-ClickButtonByLabelsAnyVisibility -Session $Session -Labels $lineLabels -ScopeSelector "main"
        }
      }
    }

    if ($clickedLine) {
      try {
        Wait-ForLineRowsIncrease -Session $Session -PreviousCount $lineBefore -Increment 1 -TimeoutSeconds 15
      } catch {
      }
      $lineAfterClick = Get-LineRowCount -Session $Session
      if ($lineAfterClick -gt $lineBefore) {
        $lineCreated = $true
        break
      }
    }

    $clickedSection = Try-ClickButtonByLabels -Session $Session -Labels $sectionLabels -ScopeSelector "main" -TimeoutPerLabelSeconds 5
    if (-not $clickedSection) {
      $clickedSection = Try-ClickButtonByLabelsAnyVisibility -Session $Session -Labels $sectionLabels -ScopeSelector "main"
    }
    if (-not $clickedSection) {
      Start-Sleep -Milliseconds 400
      continue
    }

    try {
      Wait-ForTitleInputsIncrease -Session $Session -PreviousCount $beforeCount -Increment 1 -TimeoutSeconds 20
      $beforeCount = [int](Invoke-AB $Session "eval" "document.querySelectorAll('input.estimate-input--title').length")
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  if (-not $lineCreated) {
    $lineAfterLoop = Get-LineRowCount -Session $Session
    if ($lineAfterLoop -le $lineBefore) {
      throw "Unable to create line row with current hierarchy depth."
    }
  }

  $rowsNow = [int](Invoke-AB $Session "eval" "document.querySelectorAll('.estimate-row').length")
  if ($rowsNow -le $beforeRows) {
    Start-Sleep -Milliseconds 500
  }

  Set-LatestLineTitleValue -Session $Session -Value $Designation
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
  const lineRows = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-line-checkbox'));
  });
  if (lineRows.length === 0) throw new Error('No line row found');
  const row = lineRows[lineRows.length - 1];

  const inputs = Array.from(row.querySelectorAll('input.estimate-input, select.estimate-input')).filter((input) => {
    if (input instanceof HTMLInputElement) {
      return input.type !== 'checkbox' && !input.readOnly && !input.disabled;
    }
    return !input.disabled;
  });
  if (inputs.length < 3) throw new Error('Not enough editable line inputs');

  const set = (el, val) => {
    el.focus();
    if (el.tagName === 'SELECT') {
      const candidate = Array.from(el.options).find((option) => {
        const byValue = String(option.value ?? '').trim().toLowerCase() === String(val).trim().toLowerCase();
        const byLabel = String(option.textContent ?? '').trim().toLowerCase() === String(val).trim().toLowerCase();
        return byValue || byLabel;
      });
      if (candidate) {
        el.value = candidate.value;
      }
    } else {
      el.value = String(val);
    }
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
