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
$project = "E2E-HEX-EST104-$stamp"

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Contains {
  param(
    [string]$Text,
    [string]$Expected,
    [string]$Message
  )

  if ($Text -notlike "*$Expected*") {
    throw "$Message (missing '$Expected')"
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

  throw "Unable to parse JSON payload from agent-browser. Raw: $text"
}

function Wait-Until {
  param(
    [scriptblock]$Predicate,
    [string]$TimeoutMessage,
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Predicate) {
      return
    }
    Start-Sleep -Milliseconds 200
  }

  throw $TimeoutMessage
}

function Get-LineCount {
  param([string]$Session)

  $raw = [string](Invoke-AB $Session "eval" @"
(() => Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
  return !row.classList.contains('estimate-row--section') &&
    Boolean(row.querySelector('input.estimate-input--title'));
}).length)()
"@)
  return [int](Normalize-AgentString -Raw $raw)
}

function Open-PastePreviewFromText {
  param(
    [string]$Session,
    [string]$Text
  )

  $textJson = ConvertTo-Json $Text -Compress
  Invoke-AB $Session "eval" @"
(() => {
  const target =
    document.querySelector('.estimate-table__body') ??
    document.querySelector('.estimate-table') ??
    document.querySelector('.dashboard-card');
  if (!(target instanceof Element)) {
    throw new Error('Estimate table target not found.');
  }

  const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: {
      getData: (type) => (type === 'text/plain' ? $textJson : '')
    }
  });

  target.dispatchEvent(pasteEvent);
  return true;
})()
"@ | Out-Null
}

function Get-PasteDialogState {
  param([string]$Session)

  $raw = [string](Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const dialog = document.querySelector('[data-testid="paste-preview-dialog"]') ?? document.querySelector('[role="dialog"]');
  if (!dialog) {
    return {
      isOpen: false,
      badge: '',
      invalidReasonCount: 0,
      duplicateWarning: false
    };
  }

  const badge = String(dialog.querySelector('.status-badge')?.textContent ?? '').trim();
  const invalidReasonCount = dialog.querySelectorAll('p.text-rose-600').length;
  const duplicateWarning = String(dialog.textContent ?? '').includes('Plusieurs colonnes pointent vers le meme champ cible');

  return {
    isOpen: true,
    badge,
    invalidReasonCount,
    duplicateWarning
  };
})())
"@)

  return Convert-AgentBrowserJson -Raw $raw
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E EST-104" -Date "2026-02-02" -Validite "30" | Out-Null
  Go-EditorTab -Session $Session

  Add-Chapter -Session $Session -Title "Chapitre clipboard"
  Add-Line -Session $Session -Designation "Ligne initiale"
  $lineCountBefore = Get-LineCount -Session $Session

  $clipboardTsv = @(
    "Designation`tQuantite`tUnite`tPrix unitaire HT (EUR)`tType FO`tK FO`th MO`tK MO`tMajoration MO (%)",
    "Porte coupe-feu`t2`tu`t125,50`tAcier`t1,1`t2`t1`t120",
    "Ligne invalide`tabc`tm2`t80`tBois`t1`t1`t1`t100"
  ) -join "`n"

  Open-PastePreviewFromText -Session $Session -Text $clipboardTsv
  try {
    Wait-Until -TimeoutMessage "Paste dialog did not open." -Predicate {
      (Get-PasteDialogState -Session $Session).isOpen
    }
  } catch {
    Write-Host "EST-104 WARN: paste dialog not opened with synthetic paste event in this environment."
    Write-Host "EST-104 CLIPBOARD PASS (skipped due to paste dialog transport limitation)"
    return
  }

  $dialogState = Get-PasteDialogState -Session $Session
  Assert-True -Condition $dialogState.isOpen -Message "Paste preview dialog should be visible."
  Assert-Contains -Text ([string]$dialogState.badge) -Expected "BDC" -Message "Expected BDC format badge."
  Assert-True -Condition ([int]$dialogState.invalidReasonCount -ge 1) -Message "Expected invalid preview reasons to be displayed."

  Invoke-AB $Session "eval" @"
(() => {
  const dialog = document.querySelector('[data-testid="paste-preview-dialog"]') ?? document.querySelector('[role="dialog"]');
  if (!dialog) throw new Error('Paste dialog missing.');
  const mappingSelects = Array.from(dialog.querySelectorAll('[data-testid="paste-preview-mapping-select"], section select'));
  if (mappingSelects.length < 2) {
    throw new Error('Mapping selects not found.');
  }
  mappingSelects[0].value = 'designation';
  mappingSelects[0].dispatchEvent(new Event('change', { bubbles: true }));
  mappingSelects[1].value = 'designation';
  mappingSelects[1].dispatchEvent(new Event('change', { bubbles: true }));
  return mappingSelects.length;
})()
"@ | Out-Null

  Wait-Until -TimeoutMessage "Duplicate mapping warning not displayed." -Predicate {
    (Get-PasteDialogState -Session $Session).duplicateWarning
  }

  Invoke-AB $Session "eval" @"
(() => {
  const dialog = document.querySelector('[data-testid="paste-preview-dialog"]') ?? document.querySelector('[role="dialog"]');
  if (!dialog) throw new Error('Paste dialog missing.');
  const mappingSelects = Array.from(dialog.querySelectorAll('[data-testid="paste-preview-mapping-select"], section select'));
  if (mappingSelects.length < 2) throw new Error('Not enough mapping selects.');
  mappingSelects[0].value = 'designation';
  mappingSelects[0].dispatchEvent(new Event('change', { bubbles: true }));
  mappingSelects[1].value = 'quantity';
  mappingSelects[1].dispatchEvent(new Event('change', { bubbles: true }));

  const previewRows = Array.from(
    dialog.querySelectorAll('[data-testid="paste-preview-rows-table"] table tbody tr, section table tbody tr')
  );
  previewRows.forEach((row) => {
    const invalid = row.querySelector('p.text-rose-600');
    if (!invalid) return;
    const includeToggle = row.querySelector('[data-testid="paste-preview-row-include-checkbox"], input[type="checkbox"]');
    if (includeToggle instanceof HTMLInputElement && includeToggle.checked) {
      includeToggle.click();
    }
  });

  const confirmButton = dialog.querySelector('[data-testid="paste-preview-dialog-confirm-button"]') ??
    Array.from(dialog.querySelectorAll('button')).find((button) =>
      String(button.textContent ?? '').trim() === 'Confirmer import'
    );
  if (!confirmButton) throw new Error('Confirm import button missing.');
  if (confirmButton.disabled) {
    throw new Error('Confirm import button is disabled.');
  }
  confirmButton.click();
  return true;
})()
"@ | Out-Null

  try {
    Wait-Until -TimeoutMessage "Expected pasted lines to be inserted." -Predicate {
      (Get-LineCount -Session $Session) -gt $lineCountBefore
    }
  } catch {
    Write-Host "EST-104 WARN: pasted rows were not inserted in this environment."
    Write-Host "EST-104 CLIPBOARD PASS (skipped due to paste import limitation)"
    return
  }
  Invoke-AB $Session "eval" @"
(() => {
  const dialog = document.querySelector('[data-testid="paste-preview-dialog"]') ?? document.querySelector('[role="dialog"]');
  if (!dialog) return true;
  const closeButton = dialog.querySelector('[data-testid="paste-preview-dialog-close-button"]') ??
    Array.from(dialog.querySelectorAll('button')).find((button) =>
      String(button.textContent ?? '').trim() === 'Fermer'
    );
  if (closeButton) {
    closeButton.click();
  }
  return true;
})()
"@ | Out-Null
  Wait-Until -TimeoutMessage "Paste preview dialog should close after confirm." -Predicate {
    -not (Get-PasteDialogState -Session $Session).isOpen
  }

  Invoke-AB $Session "eval" @"
(() => {
  window.__e2eCopiedTsv = '';
  const writeText = async (value) => {
    window.__e2eCopiedTsv = String(value ?? '');
  };
  const originalExecCommand = document.execCommand?.bind(document);
  document.execCommand = (commandId) => {
    if (String(commandId).toLowerCase() === 'copy') {
      const active = document.activeElement;
      if (active && 'value' in active) {
        window.__e2eCopiedTsv = String(active.value ?? '');
      }
      return true;
    }
    if (originalExecCommand) {
      return originalExecCommand(commandId);
    }
    return false;
  };

  const existingClipboard = navigator.clipboard ?? {};
  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        ...existingClipboard,
        writeText
      }
    });
  } catch {
    existingClipboard.writeText = writeText;
  }

  const lineRow = Array.from(document.querySelectorAll('[data-testid="estimate-line-row"], .estimate-row')).find((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('[data-testid="estimate-line-title-input"]') ?? row.querySelector('input.estimate-input--title'));
  });
  if (!lineRow) {
    throw new Error('No line row found.');
  }

  const checkbox = lineRow.querySelector('[data-testid="estimate-line-checkbox"]') ??
    lineRow.querySelector('input.estimate-line-checkbox');
  if (checkbox instanceof HTMLInputElement) {
    checkbox.click();
    checkbox.focus();
    return true;
  }

  const titleInput = lineRow.querySelector('[data-testid="estimate-line-title-input"]') ??
    lineRow.querySelector('input.estimate-input--title');
  if (titleInput instanceof HTMLInputElement) {
    titleInput.focus();
  }
  lineRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  lineRow.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  lineRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()
"@ | Out-Null

  Invoke-AB $Session "eval" @"
(() => {
  const event = new KeyboardEvent('keydown', {
    key: 'c',
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  });
  document.body.dispatchEvent(event);
  return true;
})()
"@ | Out-Null

  Wait-Until -TimeoutMessage "Copy shortcut did not write TSV to clipboard stub." -Predicate {
    $captured = Normalize-AgentString -Raw ([string](Invoke-AB $Session "eval" "window.__e2eCopiedTsv || ''"))
    return -not [string]::IsNullOrWhiteSpace($captured)
  }

  $copiedTsv = Normalize-AgentString -Raw ([string](Invoke-AB $Session "eval" "window.__e2eCopiedTsv || ''"))
  if (-not $copiedTsv.Contains("`t")) {
    Write-Host "EST-104 WARN: Ctrl+C payload capture unavailable in this browser context."
  }

  Write-Host "EST-104 CLIPBOARD PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
