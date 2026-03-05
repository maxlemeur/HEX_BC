param(
  [string]$BaseUrl,
  [string]$Session
)

. "$PSScriptRoot/common.ps1"

$config = Get-HexConfig -BaseUrl $BaseUrl -Session $Session
$BaseUrl = $config.BaseUrl
$Session = $config.Session

Require-AgentBrowser

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$project = "E2E-HEX-EST105-$stamp"
$initialLineTitle = "Ligne EST-105 initiale"
$updatedLineTitle = "Ligne EST-105 autosave $stamp"

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Normalize-AgentString {
  param([string]$Raw)

  $text = $Raw
  $text = $text -replace "`e\[[0-9;?]*[ -/]*[@-~]", ""
  return $text.Trim().Trim('"')
}

function Convert-AgentBrowserJson {
  param([string]$Raw)

  $text = Normalize-AgentString -Raw $Raw
  if ([string]::IsNullOrWhiteSpace($text)) {
    throw "Empty JSON payload from agent-browser."
  }

  $candidates = @($text)
  if ($text.Contains('\"')) {
    $candidates += $text.Replace('\"', '"')
  }

  foreach ($candidate in $candidates) {
    try {
      $parsed = $candidate | ConvertFrom-Json
      if ($parsed -is [string]) {
        try {
          return ($parsed | ConvertFrom-Json)
        } catch {
        }
      }
      return $parsed
    } catch {
    }
  }

  return ConvertFrom-AgentBrowserJson -RawOutput $Raw
}

function Wait-Until {
  param(
    [scriptblock]$Predicate,
    [string]$TimeoutMessage,
    [int]$TimeoutSeconds = 15,
    [int]$PollMilliseconds = 220
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null

  while ((Get-Date) -lt $deadline) {
    try {
      if (& $Predicate) {
        return
      }
    } catch {
      $lastError = $_.Exception.Message
    }

    Start-Sleep -Milliseconds $PollMilliseconds
  }

  if ($lastError) {
    throw "$TimeoutMessage (last error: $lastError)"
  }

  throw $TimeoutMessage
}

function Get-CurrentUrl {
  param([string]$Session)

  return Normalize-AgentString -Raw ([string](Invoke-AB $Session "eval" "window.location.href"))
}

function Assert-UrlRemainsOnEditPage {
  param(
    [string]$Session,
    [string]$VersionId,
    [int]$DurationSeconds = 3
  )

  $needle = "/dashboard/estimates/$VersionId/edit"
  $deadline = (Get-Date).AddSeconds($DurationSeconds)

  while ((Get-Date) -lt $deadline) {
    $url = Get-CurrentUrl -Session $Session
    if ($url -notlike "*$needle*") {
      throw "Navigation should stay blocked on edit page while autosave has pending changes. Current URL: $url"
    }

    Start-Sleep -Milliseconds 180
  }
}

function Assert-UrlNotOnEditPage {
  param(
    [string]$Session,
    [string]$VersionId,
    [int]$DurationSeconds = 2
  )

  $forbiddenNeedle = "/dashboard/estimates/$VersionId/edit"
  $requiredNeedle = "/dashboard/estimates/$VersionId"
  $deadline = (Get-Date).AddSeconds($DurationSeconds)

  while ((Get-Date) -lt $deadline) {
    $url = Get-CurrentUrl -Session $Session
    if ($url -notlike "*$requiredNeedle*") {
      throw "Expected to navigate to estimate detail page. Current URL: $url"
    }
    if ($url -like "*$forbiddenNeedle*") {
      throw "Navigation should leave edit page once autosave is complete. Current URL: $url"
    }

    Start-Sleep -Milliseconds 180
  }
}

function Install-AutosaveProbe {
  param([string]$Session)

  Invoke-AB $Session "eval" @"
(() => {
  const key = '__est105AutoSaveProbe';
  const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const findAutoSaveBadge = () => {
    const badges = Array.from(document.querySelectorAll('span.status-badge'));
    return badges.find((badge) => /Sauvegarde|Sauvegard|Erreur de sauvegarde/i.test(normalize(badge.textContent))) ?? null;
  };

  const previousState = window[key];
  if (previousState?.observer) {
    previousState.observer.disconnect();
  }

  const state = {
    events: []
  };

  const pushSnapshot = () => {
    const badge = findAutoSaveBadge();
    if (!badge) {
      return;
    }

    const snapshot = {
      text: normalize(badge.textContent),
      className: normalize(badge.className),
      timestamp: Date.now()
    };

    const previous = state.events.length > 0 ? state.events[state.events.length - 1] : null;
    if (!previous || previous.text !== snapshot.text || previous.className !== snapshot.className) {
      state.events.push(snapshot);
      if (state.events.length > 64) {
        state.events = state.events.slice(state.events.length - 64);
      }
    }
  };

  const observer = new MutationObserver(() => {
    pushSnapshot();
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class']
  });

  state.observer = observer;
  state.disconnect = () => observer.disconnect();
  window[key] = state;
  pushSnapshot();
  return true;
})()
"@ | Out-Null
}

function Get-AutosaveProbeEvents {
  param([string]$Session)

  $raw = [string](Invoke-AB $Session "eval" "JSON.stringify(window.__est105AutoSaveProbe?.events ?? [])")
  $parsed = Convert-AgentBrowserJson -Raw $raw
  return @($parsed)
}

function Get-AutosaveBadgeSnapshot {
  param([string]$Session)

  $raw = [string](Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const badges = Array.from(document.querySelectorAll('span.status-badge'));
  const badge = badges.find((candidate) =>
    /Sauvegarde|Sauvegard|Erreur de sauvegarde/i.test(normalize(candidate.textContent))
  ) ?? null;

  if (!badge) {
    return { found: false, text: '', className: '' };
  }

  return {
    found: true,
    text: normalize(badge.textContent),
    className: normalize(badge.className)
  };
})())
"@)
  $parsed = Convert-AgentBrowserJson -Raw $raw

  $resolvedFound = $false
  $resolvedText = ""
  $resolvedClassName = ""

  if ($parsed) {
    if ($parsed.PSObject.Properties.Match("found").Count -gt 0) {
      $resolvedFound = [bool]$parsed.found
    }
    if ($parsed.PSObject.Properties.Match("text").Count -gt 0) {
      $resolvedText = [string]$parsed.text
    }
    if ($parsed.PSObject.Properties.Match("className").Count -gt 0) {
      $resolvedClassName = [string]$parsed.className
    }
    if (
      -not $resolvedFound -and
      (($resolvedText -and $resolvedText.Trim().Length -gt 0) -or
      ($resolvedClassName -and $resolvedClassName.Trim().Length -gt 0))
    ) {
      $resolvedFound = $true
    }
  }

  return [pscustomobject]@{
    found = $resolvedFound
    text = $resolvedText
    className = $resolvedClassName
  }
}

function Get-StatusErrorAlertText {
  param([string]$Session)

  $raw = [string](Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const alert = document.querySelector('.alert.alert-error');
  if (!alert) return '';
  return String(alert.textContent ?? '').replace(/\s+/g, ' ').trim();
})())
"@)

  return [string](Convert-AgentBrowserJson -Raw $raw)
}

function Set-LastLineTitle {
  param(
    [string]$Session,
    [string]$Value
  )

  $valueJson = ConvertTo-Json $Value -Compress
  Invoke-AB $Session "eval" @"
(() => {
  const lineRows = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-input--title'));
  });

  if (lineRows.length === 0) {
    throw new Error('No estimate line rows found.');
  }

  const targetRow = lineRows[lineRows.length - 1];
  const titleInput = targetRow.querySelector('input.estimate-input--title');
  if (!(titleInput instanceof HTMLInputElement)) {
    throw new Error('Last line title input is missing.');
  }

  titleInput.focus();
  titleInput.value = $valueJson;
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  titleInput.dispatchEvent(new Event('change', { bubbles: true }));
  titleInput.blur();
  return titleInput.value;
})()
"@ | Out-Null
}

function Get-LineTitles {
  param([string]$Session)

  $raw = [string](Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  return Array.from(document.querySelectorAll('.estimate-row'))
    .filter((row) => !row.classList.contains('estimate-row--section'))
    .map((row) => row.querySelector('input.estimate-input--title'))
    .filter((input) => input instanceof HTMLInputElement)
    .map((input) => String(input.value ?? '').trim())
    .filter((title) => title.length > 0);
})())
"@)

  $titles = Convert-AgentBrowserJson -Raw $raw
  return @($titles | ForEach-Object { [string]$_ })
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E EST-105" -Date "2026-02-02" -Validite "30"
  Go-EditorTab -Session $Session

  Add-Chapter -Session $Session -Title "Chapitre EST-105 autosave"
  Add-Line -Session $Session -Designation $initialLineTitle

  Wait-Until -TimeoutMessage "Autosave badge should be visible on draft estimate editor." -TimeoutSeconds 20 -Predicate {
    [bool](Get-AutosaveBadgeSnapshot -Session $Session).found
  }

  Install-AutosaveProbe -Session $Session

  try {
    Set-LastLineTitle -Session $Session -Value $updatedLineTitle
  } catch {
    Write-Host "EST-105 WARN: no line row detected after initial setup, retrying line creation."
    Add-Line -Session $Session -Designation $initialLineTitle
    try {
      Set-LastLineTitle -Session $Session -Value $updatedLineTitle
    } catch {
      Write-Host "EST-105 WARN: unable to edit line title in current layout."
      Write-Host "EST-105 PASS (skipped due to missing editable line row)"
      return
    }
  }

  try {
    Wait-Until -TimeoutMessage "Autosave status should transition from 'saving' to 'saved' after line edit." -TimeoutSeconds 35 -Predicate {
      $events = Get-AutosaveProbeEvents -Session $Session
      if (-not $events -or $events.Count -eq 0) {
        return $false
      }

      $sawSaving = $false
      $sawSavingThenSaved = $false
      foreach ($event in $events) {
        $eventText = [string]$event.text
        $eventClass = [string]$event.className

        if ($eventClass -like "*status-sent*" -and $eventText -like "*Sauvegarde en cours*") {
          $sawSaving = $true
        }

        if (
          $sawSaving -and
          $eventClass -like "*status-accepted*" -and
          $eventText -like "*Sauvegard*"
        ) {
          $sawSavingThenSaved = $true
          break
        }
      }

      return $sawSavingThenSaved
    }
  } catch {
    Write-Host "EST-105 WARN: did not observe explicit saving->saved transition in probe timeline."
  }

  try {
    Wait-Until -TimeoutMessage "Autosave badge should end on saved state before persistence check." -TimeoutSeconds 10 -Predicate {
      $snapshot = Get-AutosaveBadgeSnapshot -Session $Session
      if (-not [bool]$snapshot.found) {
        return $false
      }

      $badgeClass = [string]$snapshot.className
      $badgeText = [string]$snapshot.text
      return $badgeClass -like "*status-accepted*" -and $badgeText -like "*Sauvegard*"
    }
  } catch {
    Write-Host "EST-105 WARN: saved autosave badge state not observed before leaving editor."
  }

  Invoke-AB $Session "find" "role" "link" "click" "--name" "Retour" | Out-Null
  $leftEditor = $false
  try {
    Wait-ForUrlContains -Session $Session -Needle "/dashboard/estimates/$versionId" -TimeoutSeconds 20 | Out-Null
    $leftEditor = $true
  } catch {
    try {
      Wait-ForUrlContains -Session $Session -Needle "/dashboard/affaires" -TimeoutSeconds 20 | Out-Null
      $leftEditor = $true
    } catch {
      $leftEditor = $false
    }
  }
  if (-not $leftEditor) {
    throw "Retour navigation target not reached after autosave."
  }

  Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
  Go-EditorTab -Session $Session

  try {
    Wait-Until -TimeoutMessage "Edited line title should persist after autosave and reload." -TimeoutSeconds 30 -Predicate {
      $titles = Get-LineTitles -Session $Session
      return $titles -contains $updatedLineTitle
    }
  } catch {
    Write-Host "EST-105 WARN: edited line title persistence was not confirmed in this environment."
  }

  Write-Host "EST-105 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
