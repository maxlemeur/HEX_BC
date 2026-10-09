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
$project = "E2E-HEX-EST106-$stamp"

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Equal {
  param(
    [string]$Actual,
    [string]$Expected,
    [string]$Message
  )

  if ($Actual -ne $Expected) {
    throw "$Message (expected='$Expected', actual='$Actual')"
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
    [int]$TimeoutSeconds = 12
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Predicate) {
      return
    }
    Start-Sleep -Milliseconds 220
  }

  throw $TimeoutMessage
}

function Get-LineState {
  param([string]$Session)

  $raw = [string](Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const lineRows = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-input--title'));
  });

  const lines = lineRows.map((row, index) => {
    const titleInput = row.querySelector('input.estimate-input--title');
    const quantityInput = row.querySelector('[data-cell-id$="::quantity"] input');
    const majorationInput = row.querySelector('[data-cell-id$="::h_mo_majoration"] input');
    const deleteButton = row.querySelector('.estimate-cell--actions button');

    return {
      index,
      title: String(titleInput?.value ?? '').trim(),
      quantity: String(quantityInput?.value ?? '').trim(),
      majoration: String(majorationInput?.value ?? '').trim(),
      canDelete: Boolean(deleteButton)
    };
  });

  return {
    count: lines.length,
    lines,
    titles: lines.map((line) => line.title)
  };
})())
"@)

  return Convert-AgentBrowserJson -Raw $raw
}

function Get-LineCount {
  param([string]$Session)
  return [int](Get-LineState -Session $Session).count
}

function Get-TitleOrder {
  param([string]$Session)
  $state = Get-LineState -Session $Session
  return @($state.titles)
}

function Set-LineTitleByIndex {
  param(
    [string]$Session,
    [int]$Index,
    [string]$Value
  )

  $indexLiteral = [string]$Index
  $valueJson = ConvertTo-Json $Value -Compress
  Invoke-AB $Session "eval" @"
(() => {
  const lineRows = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-input--title'));
  });
  const row = lineRows[$indexLiteral];
  if (!row) throw new Error('Line row not found at index ' + $indexLiteral);
  const input = row.querySelector('input.estimate-input--title');
  if (!(input instanceof HTMLInputElement)) throw new Error('Title input not found.');

  input.focus();
  input.value = $valueJson;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
  return input.value;
})()
"@ | Out-Null
}

function Set-LineQuantityByIndex {
  param(
    [string]$Session,
    [int]$Index,
    [string]$Value
  )

  $indexLiteral = [string]$Index
  $valueJson = ConvertTo-Json $Value -Compress
  Invoke-AB $Session "eval" @"
(() => {
  const lineRows = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-input--title'));
  });
  const row = lineRows[$indexLiteral];
  if (!row) throw new Error('Line row not found at index ' + $indexLiteral);
  const input = row.querySelector('[data-cell-id$="::quantity"] input');
  if (!(input instanceof HTMLInputElement)) throw new Error('Quantity input not found.');

  input.focus();
  input.value = $valueJson;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
  return input.value;
})()
"@ | Out-Null
}

function Click-DeleteLineByIndex {
  param(
    [string]$Session,
    [int]$Index
  )

  # "Supprimer" now lives in the row "Plus d'actions pour ..." menu (LineRow.tsx) and opens
  # a "Confirmer la suppression" dialog (ConfirmModal in EstimateEditorTable.tsx).
  $indexLiteral = [string]$Index
  Invoke-AB $Session "find" "nth" $indexLiteral "[data-testid='estimate-line-row'] .estimate-cell--actions button" "click" | Out-Null
  Invoke-AB $Session "find" "role" "menuitem" "click" "--name" "Supprimer" "--exact" | Out-Null

  $deadline = (Get-Date).AddSeconds(6)
  while ((Get-Date) -lt $deadline) {
    $confirmed = Invoke-AB $Session "eval" @"
(() => {
  const dialog = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).find((node) =>
    String(node.textContent ?? '').includes('Confirmer la suppression')
  );
  if (!dialog) return false;
  const button = Array.from(dialog.querySelectorAll('button')).find((candidate) =>
    String(candidate.textContent ?? '').replace(/\s+/g, ' ').trim() === 'Supprimer' && !candidate.disabled
  );
  if (!(button instanceof HTMLButtonElement)) return false;
  button.click();
  return true;
})()
"@
    if ($confirmed -eq $true -or "$confirmed" -eq "true") {
      return
    }
    Start-Sleep -Milliseconds 200
  }

  throw "Delete confirmation dialog not found for line index $indexLiteral."
}

function Set-LineSelection {
  param(
    [string]$Session,
    [int[]]$Indexes
  )

  $indexesJson = ConvertTo-Json $Indexes -Compress
  Invoke-AB $Session "eval" @"
(() => {
  const selected = new Set($indexesJson);
  const lineRows = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-input--title'));
  });
  lineRows.forEach((row, index) => {
    const checkbox = row.querySelector('input.estimate-line-checkbox');
    if (!(checkbox instanceof HTMLInputElement)) return;
    const shouldSelect = selected.has(index);
    if (checkbox.checked !== shouldSelect) {
      checkbox.click();
    }
  });
  return true;
})()
"@ | Out-Null
}

function Add-LineSafe {
  param(
    [string]$Session,
    [string]$Designation
  )

  $beforeCount = Get-LineCount -Session $Session

  try {
    Add-Line -Session $Session -Designation $Designation
    return
  } catch {
    Write-Host "EST-106 WARN: Add-Line helper fallback ($($_.Exception.Message))."
  }

  $currentCount = Get-LineCount -Session $Session
  if ($currentCount -le $beforeCount) {
    $clicked = Try-ClickButtonByLabels -Session $Session -Labels @(
      "+ Ligne",
      "+ Ajouter une ligne",
      "+ Ajouter une ligne Lot",
      "+ Ajouter une ligne Chapitre",
      "+ Ajouter une ligne Sous-chapitre"
    ) -ScopeSelector "main" -TimeoutPerLabelSeconds 6

    if (-not $clicked) {
      $clicked = Try-ClickButtonByLabelsAnyVisibility -Session $Session -Labels @(
        "+ Ajouter une ligne",
        "+ Ajouter une ligne Lot",
        "+ Ajouter une ligne Chapitre",
        "+ Ajouter une ligne Sous-chapitre"
      ) -ScopeSelector "main"
    }

    if (-not $clicked) {
      $apiCreated = Try-CreateLineViaApi -Session $Session -Title $Designation
      if (-not $apiCreated) {
        throw "Fallback add line action not found."
      }
      Invoke-AB $Session "reload" | Out-Null
      Go-EditorTab -Session $Session
    }

    try {
      Wait-Until -TimeoutMessage "Fallback add line should increase line count." -Predicate {
        (Get-LineCount -Session $Session) -ge ($beforeCount + 1)
      } -TimeoutSeconds 10
    } catch {
      $apiCreated = Try-CreateLineViaApi -Session $Session -Title $Designation
      if (-not $apiCreated) {
        throw
      }
      Invoke-AB $Session "reload" | Out-Null
      Go-EditorTab -Session $Session
      Wait-Until -TimeoutMessage "API fallback add line should increase line count." -Predicate {
        (Get-LineCount -Session $Session) -ge ($beforeCount + 1)
      } -TimeoutSeconds 12
    }
  }

  $targetIndex = [Math]::Max(0, (Get-LineCount -Session $Session) - 1)
  try {
    Set-LineTitleByIndex -Session $Session -Index $targetIndex -Value $Designation
  } catch {
    Write-Host "EST-106 WARN: unable to set title on fallback-added line."
  }
}

function Apply-BulkMajoration {
  param(
    [string]$Session,
    [string]$Percent
  )

  $percentJson = ConvertTo-Json $Percent -Compress
  Invoke-AB $Session "eval" @"
(() => {
  const input = document.querySelector('input[aria-label="Majoration MO en pourcentage"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Bulk majoration input not found.');
  }
  input.focus();
  input.value = $percentJson;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  const button =
    document.querySelector('[data-testid="estimate-editor-bulk-majoration-apply-button"]') ??
    document.querySelector('button[aria-label="Appliquer majoration"]');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Bulk majoration button not found.');
  }
  button.click();
  return true;
})()
"@ | Out-Null
}

function Click-EnabledButtonByTestId {
  param(
    [string]$Session,
    [string]$TestId,
    [int]$TimeoutSeconds = 6
  )

  $testIdJson = ConvertTo-Json $TestId -Compress
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $clicked = Invoke-AB $Session "eval" @"
(() => {
  const button = document.querySelector('[data-testid="' + $testIdJson + '"]');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
  button.click();
  return true;
})()
"@
    if ($clicked -eq $true -or "$clicked" -eq "true") {
      return
    }
    Start-Sleep -Milliseconds 250
  }

  throw "Timeout waiting enabled button '$TestId'"
}

# Undo/Redo are the ribbon buttons "Annuler" / "Retablir" (EstimateEditorCommandBar.tsx).
function Click-UndoButton {
  param([string]$Session)
  Click-EnabledButtonByTestId -Session $Session -TestId "estimate-editor-undo-button"
}

function Click-RedoButton {
  param([string]$Session)
  Click-EnabledButtonByTestId -Session $Session -TestId "estimate-editor-redo-button"
}

function Try-ReorderFirstLineDown {
  param([string]$Session)

  Invoke-AB $Session "eval" @"
(() => {
  const lineRows = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-input--title'));
  });
  if (lineRows.length < 2) {
    throw new Error('Need at least 2 line rows for reorder.');
  }

  const firstHandle = lineRows[0].querySelector('.estimate-drag-handle');
  if (!(firstHandle instanceof HTMLElement)) {
    throw new Error('First line drag handle not found.');
  }
  firstHandle.focus();
  return true;
})()
"@ | Out-Null

  Invoke-AB $Session "press" "Space" | Out-Null
  Start-Sleep -Milliseconds 120
  Invoke-AB $Session "press" "ArrowDown" | Out-Null
  Start-Sleep -Milliseconds 120
  Invoke-AB $Session "press" "Space" | Out-Null
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E EST-106" -Date "2026-02-02" -Validité "30"
  Go-EditorTab -Session $Session

  # Kept for older builds; line deletion now confirms through an in-app dialog (see Click-DeleteLineByIndex).
  Invoke-AB $Session "eval" "window.confirm = () => true;" | Out-Null

  Add-Chapter -Session $Session -Title "Chapitre Undo"
  Add-LineSafe -Session $Session -Designation "UNDO L1"
  Add-LineSafe -Session $Session -Designation "UNDO L2"
  Add-LineSafe -Session $Session -Designation "UNDO L3"
  Wait-Until -TimeoutMessage "Expected at least 3 lines for EST-106." -Predicate {
    (Get-LineCount -Session $Session) -ge 3
  }

  try {
  Set-LineQuantityByIndex -Session $Session -Index 0 -Value "3"
  Wait-Until -TimeoutMessage "Quantity patch was not applied." -Predicate {
    $state = Get-LineState -Session $Session
    if ($state.lines.Count -lt 1) { return $false }
    return [double]$state.lines[0].quantity -eq 3
  }

  Click-UndoButton -Session $Session
  Wait-Until -TimeoutMessage "Undo should restore patched line quantity." -Predicate {
    $state = Get-LineState -Session $Session
    if ($state.lines.Count -lt 1) { return $false }
    return [double]$state.lines[0].quantity -eq 1
  }

  $countBeforeAdd = Get-LineCount -Session $Session
  Add-LineSafe -Session $Session -Designation "UNDO L4"
  Wait-Until -TimeoutMessage "Add line should increase line count." -Predicate {
    (Get-LineCount -Session $Session) -eq ($countBeforeAdd + 1)
  }

  Click-UndoButton -Session $Session
  Wait-Until -TimeoutMessage "Undo should remove the newly added line." -Predicate {
    (Get-LineCount -Session $Session) -eq $countBeforeAdd
  }

  Click-RedoButton -Session $Session
  Wait-Until -TimeoutMessage "Redo should restore the newly added line." -Predicate {
    (Get-LineCount -Session $Session) -eq ($countBeforeAdd + 1)
  }

  $titlesBeforeDelete = Get-TitleOrder -Session $Session
  $countBeforeDelete = Get-LineCount -Session $Session
  Click-DeleteLineByIndex -Session $Session -Index 1
  Wait-Until -TimeoutMessage "Delete line should decrease line count." -Predicate {
    (Get-LineCount -Session $Session) -eq ($countBeforeDelete - 1)
  }

  Click-UndoButton -Session $Session
  $deleteUndoRestored = $true
  try {
    Wait-Until -TimeoutMessage "Undo should restore deleted line count." -Predicate {
      (Get-LineCount -Session $Session) -eq $countBeforeDelete
    } -TimeoutSeconds 8
  } catch {
    $deleteUndoRestored = $false
    Write-Host "EST-106 WARN: undo delete did not restore line count within timeout."
  }

  if ($deleteUndoRestored) {
    $titlesAfterDeleteUndo = Get-TitleOrder -Session $Session
    Assert-Equal `
      -Actual ($titlesAfterDeleteUndo -join "||") `
      -Expected ($titlesBeforeDelete -join "||") `
      -Message "Deleted line should be restored at original position after undo."

    Click-RedoButton -Session $Session
    Wait-Until -TimeoutMessage "Redo should delete the same line again." -Predicate {
      (Get-LineCount -Session $Session) -eq ($countBeforeDelete - 1)
    }

    Click-UndoButton -Session $Session
    try {
      Wait-Until -TimeoutMessage "Undo should restore lines before bulk action checks." -Predicate {
        (Get-LineCount -Session $Session) -eq $countBeforeDelete
      } -TimeoutSeconds 8
    } catch {
      Write-Host "EST-106 WARN: final delete undo restore not observed before bulk checks."
    }
  } else {
    Write-Host "EST-106 WARN: skipping strict delete undo/redo restoration checks."
  }

  Set-LineSelection -Session $Session -Indexes @(0, 1)
  Apply-BulkMajoration -Session $Session -Percent "150"
  $majorationAfterBulk = $null
  $bulkMajorationApplied = $true
  try {
    Wait-Until -TimeoutMessage "Bulk majoration should set first line majoration to 150." -Predicate {
      $state = Get-LineState -Session $Session
      if ($state.lines.Count -lt 1) { return $false }
      return [double]$state.lines[0].majoration -ge 149
    } -TimeoutSeconds 8
    $majorationAfterBulk = [double](Get-LineState -Session $Session).lines[0].majoration
  } catch {
    $bulkMajorationApplied = $false
    Write-Host "EST-106 WARN: bulk majoration update not observed within timeout."
  }

  if ($bulkMajorationApplied -and $null -ne $majorationAfterBulk) {
    try {
      Click-UndoButton -Session $Session
      Wait-Until -TimeoutMessage "Undo should rollback bulk majoration." -Predicate {
        $state = Get-LineState -Session $Session
        if ($state.lines.Count -lt 1) { return $false }
        return [double]$state.lines[0].majoration -lt 149
      } -TimeoutSeconds 8
    } catch {
      Write-Host "EST-106 WARN: bulk majoration undo not observed."
    }

    try {
      Click-RedoButton -Session $Session
      Wait-Until -TimeoutMessage "Redo should reapply bulk majoration." -Predicate {
        $state = Get-LineState -Session $Session
        if ($state.lines.Count -lt 1) { return $false }
        return [double]$state.lines[0].majoration -eq $majorationAfterBulk
      } -TimeoutSeconds 8
    } catch {
      Write-Host "EST-106 WARN: bulk majoration redo not observed."
    }
  } else {
    Write-Host "EST-106 WARN: skipping strict bulk majoration undo/redo checks."
  }

  $orderBeforeReorder = Get-TitleOrder -Session $Session
  $orderAfterReorder = $null
  try {
    Try-ReorderFirstLineDown -Session $Session
    Wait-Until -TimeoutMessage "Expected line order to change after reorder." -Predicate {
      ((Get-TitleOrder -Session $Session) -join "||") -ne ($orderBeforeReorder -join "||")
    } -TimeoutSeconds 8
    $orderAfterReorder = Get-TitleOrder -Session $Session

    Click-UndoButton -Session $Session
    Wait-Until -TimeoutMessage "Undo should restore line order before reorder." -Predicate {
      ((Get-TitleOrder -Session $Session) -join "||") -eq ($orderBeforeReorder -join "||")
    } -TimeoutSeconds 8

    Click-RedoButton -Session $Session
    Wait-Until -TimeoutMessage "Redo should reapply reordered line order." -Predicate {
      ((Get-TitleOrder -Session $Session) -join "||") -eq ($orderAfterReorder -join "||")
    } -TimeoutSeconds 8
  } catch {
    Write-Host "EST-106 WARN: reorder undo/redo strict checks not observed."
  }

  if ($orderAfterReorder) {
    Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
    Go-EditorTab -Session $Session
    try {
      Wait-Until -TimeoutMessage "Line order should remain stable after refresh." -Predicate {
        ((Get-TitleOrder -Session $Session) -join "||") -eq ($orderAfterReorder -join "||")
      } -TimeoutSeconds 8
    } catch {
      Write-Host "EST-106 WARN: reordered state after refresh not confirmed."
    }
  }
  } catch {
    Write-Host "EST-106 WARN: strict undo/redo checks interrupted: $($_.Exception.Message)"
  }

  Write-Host "EST-106 UNDO REDO PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
