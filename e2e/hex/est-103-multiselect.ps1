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
$project = "E2E-HEX-EST103-$stamp"

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

function Get-MultiSelectSnapshot {
  param([string]$Session)

  $json = Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const findSelectionLabel = () => {
    const nodes = Array.from(document.querySelectorAll('span, div, p, strong'));
    for (const node of nodes) {
      const text = String(node.textContent ?? '').trim();
      if (/^\d+\s+selection\(s\)$/i.test(text)) {
        return text;
      }
    }
    return '';
  };

  const selectionLabel = findSelectionLabel();
  const selectionMatch = selectionLabel.match(/(\d+)/);
  const selectionCount = selectionMatch ? Number(selectionMatch[1]) : 0;

  const lineRows = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    if (row.classList.contains('estimate-row--section')) return false;
    return Boolean(row.querySelector('input.estimate-line-checkbox'));
  });

  const resolveSectionTitle = (lineRow) => {
    let prev = lineRow.previousElementSibling;
    while (prev) {
      if (prev.classList.contains('estimate-row--section')) {
        const sectionInput = prev.querySelector('input.estimate-input--title');
        return sectionInput ? String(sectionInput.value ?? '').trim() : '';
      }
      prev = prev.previousElementSibling;
    }
    return '';
  };

  const readSupplyType = (row) => {
    const el = row.querySelector('[data-cell-id$="::supply_type"] input, [data-cell-id$="::supply_type"] select');
    if (!el) return '';
    return String(el.value ?? '').trim();
  };

  const readRole = (row) => {
    const roleSelect =
      row.querySelector('[data-cell-id$="::labor_role"] select') ??
      row.querySelector('[data-cell-id$="::labor_role_atelier"] select') ??
      row.querySelector('[data-cell-id$="::labor_role_chantier"] select') ??
      row.querySelector('select.estimate-input');

    if (!(roleSelect instanceof HTMLSelectElement)) {
      return '';
    }

    const selectedOption = roleSelect.options[roleSelect.selectedIndex] ?? null;
    return selectedOption ? String(selectedOption.textContent ?? '').trim() : '';
  };

  const lines = lineRows.map((row, index) => {
    const titleInput = row.querySelector('input.estimate-input--title');
    const checkbox = row.querySelector('input.estimate-line-checkbox');
    const hasSelectedClass =
      row.classList.contains('estimate-row--selected') ||
      row.getAttribute('aria-selected') === 'true';
    const checked = Boolean(checkbox?.checked);
    const selected = checked || hasSelectedClass;

    return {
      index,
      marker: row.getAttribute('data-ms-line-index') ?? String(index),
      title: titleInput ? String(titleInput.value ?? '').trim() : '',
      sectionTitle: resolveSectionTitle(row),
      selected,
      checked,
      supplyType: readSupplyType(row),
      role: readRole(row)
    };
  });

  const selectedLines = lines.filter((line) => line.selected);

  return {
    selectionLabel,
    selectionCount,
    lineCount: lines.length,
    selectedCount: selectedLines.length,
    lines,
    selectedLines
  };
})())
"@

  return $json | ConvertFrom-Json
}

function Wait-ForSelectionCount {
  param(
    [string]$Session,
    [int]$Expected,
    [int]$TimeoutSeconds = 8
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $snapshot = Get-MultiSelectSnapshot -Session $Session
    if ([int]$snapshot.selectionCount -eq $Expected) {
      return $snapshot
    }

    Start-Sleep -Milliseconds 180
  }

  throw "Timeout waiting selection count $Expected."
}

function Wait-ForLineCount {
  param(
    [string]$Session,
    [int]$Expected,
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $snapshot = Get-MultiSelectSnapshot -Session $Session
    if ([int]$snapshot.lineCount -eq $Expected) {
      return $snapshot
    }

    Start-Sleep -Milliseconds 200
  }

  throw "Timeout waiting line count $Expected."
}

function Invoke-LineModifierClick {
  param(
    [string]$Session,
    [int]$Index,
    [ValidateSet("ctrl", "shift")][string]$Modifier
  )

  $indexLiteral = [string]$Index
  $modifierLiteral = ConvertTo-Json $Modifier -Compress

  Invoke-AB $Session "eval" @"
(() => {
  const index = Number($indexLiteral);
  const modifier = $modifierLiteral;
  const row =
    document.querySelector('[data-ms-line-index=\"' + index + '\"]') ??
    Array.from(document.querySelectorAll('.estimate-row')).filter((candidate) => {
      return !candidate.classList.contains('estimate-row--section') &&
        Boolean(candidate.querySelector('input.estimate-line-checkbox'));
    })[index];

  if (!row) {
    throw new Error('Line row not found for index ' + index);
  }

  const target =
    row.querySelector('.estimate-cell--selection') ??
    row.querySelector('input.estimate-line-checkbox') ??
    row;

  const eventInit = {
    bubbles: true,
    cancelable: true,
    ctrlKey: modifier === 'ctrl',
    metaKey: modifier === 'ctrl',
    shiftKey: modifier === 'shift'
  };

  target.dispatchEvent(new MouseEvent('mousedown', eventInit));
  target.dispatchEvent(new MouseEvent('mouseup', eventInit));
  target.dispatchEvent(new MouseEvent('click', eventInit));
})();
"@ | Out-Null
}

function Click-BlankArea {
  param([string]$Session)

  Invoke-AB $Session "eval" @"
(() => {
  const target =
    document.querySelector('.estimate-table__body') ??
    document.querySelector('.estimate-table') ??
    document.body;

  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
})();
"@ | Out-Null
}

function Initialize-MultiSelectFixture {
  param([string]$Session)

  $json = Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const setValue = (input, value) => {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
  };

  const sectionRows = Array.from(document.querySelectorAll('.estimate-row--section'));
  const lineRows = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-line-checkbox'));
  });

  if (sectionRows.length < 2) {
    throw new Error('Need at least 2 sections for EST-103.');
  }
  if (lineRows.length < 3) {
    throw new Error('Need at least 3 lines for EST-103.');
  }

  const sectionNames = ['Section Source', 'Section Cible'];
  sectionRows.slice(0, 2).forEach((row, index) => {
    row.setAttribute('data-ms-section-index', String(index));
    const input = row.querySelector('input.estimate-input--title');
    if (input) {
      setValue(input, sectionNames[index]);
    }
  });

  lineRows.forEach((row, index) => {
    row.setAttribute('data-ms-line-index', String(index));
    const titleInput = row.querySelector('input.estimate-input--title');
    if (titleInput && index < 4) {
      setValue(titleInput, 'MS Ligne ' + (index + 1));
    }

    const checkbox = row.querySelector('input.estimate-line-checkbox');
    if (checkbox instanceof HTMLInputElement && checkbox.checked) {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  return {
    sectionCount: sectionRows.length,
    lineCount: lineRows.length,
    sourceSection: sectionNames[0],
    targetSection: sectionNames[1]
  };
})())
"@

  return $json | ConvertFrom-Json
}

function Invoke-BulkMoveSectionAction {
  param([string]$Session)

  $json = Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const selectionNode = Array.from(document.querySelectorAll('span,div,p,strong')).find((node) => {
    return /^\d+\s+selection\(s\)$/i.test(String(node.textContent ?? '').trim());
  });

  const toolbarRoot = selectionNode?.closest('div')?.parentElement ?? document;

  const describeControl = (el) => {
    const labelText =
      el.id
        ? String(document.querySelector('label[for=\"' + CSS.escape(el.id) + '\"]')?.textContent ?? '')
        : '';

    return [
      String(el.getAttribute('aria-label') ?? ''),
      String(el.getAttribute('name') ?? ''),
      String(el.getAttribute('id') ?? ''),
      String(el.getAttribute('placeholder') ?? ''),
      labelText
    ]
      .join(' ')
      .toLowerCase();
  };

  const controls = Array.from(toolbarRoot.querySelectorAll('select, input'));
  const sectionControl = controls.find((control) => {
    const descriptor = describeControl(control);
    return /(section|chapitre)/i.test(descriptor) &&
      /(deplac|move|destination|target|cible|vers)/i.test(descriptor);
  });

  if (!sectionControl) {
    return { ok: false, reason: 'move_section_control_not_found' };
  }

  let targetLabel = '';
  if (sectionControl instanceof HTMLSelectElement) {
    const options = Array.from(sectionControl.options);
    const nextOption =
      options.find((opt) => /section\s+cible/i.test(String(opt.textContent ?? ''))) ??
      options.find((opt) => {
        return Boolean(opt.value) && opt.value !== sectionControl.value;
      });

    if (!nextOption) {
      return { ok: false, reason: 'move_section_option_not_found' };
    }

    sectionControl.value = nextOption.value;
    sectionControl.dispatchEvent(new Event('change', { bubbles: true }));
    targetLabel = String(nextOption.textContent ?? '').trim();
  } else {
    sectionControl.focus();
    sectionControl.value = 'Section Cible';
    sectionControl.dispatchEvent(new Event('input', { bubbles: true }));
    sectionControl.dispatchEvent(new Event('change', { bubbles: true }));
    targetLabel = String(sectionControl.value ?? '').trim();
  }

  const actionScope = sectionControl.closest('div') ?? toolbarRoot;
  const applyButton = Array.from(actionScope.querySelectorAll('button')).find((button) => {
    const text = String(button.textContent ?? '').trim();
    return /(deplac|move|appliqu|valider|confirmer)/i.test(text);
  });

  if (applyButton) {
    applyButton.click();
  }

  return {
    ok: true,
    targetLabel,
    usedButton: Boolean(applyButton)
  };
})())
"@

  return $json | ConvertFrom-Json
}

function Invoke-BulkCategoryAction {
  param([string]$Session)

  $json = Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const selectionNode = Array.from(document.querySelectorAll('span,div,p,strong')).find((node) => {
    return /^\d+\s+selection\(s\)$/i.test(String(node.textContent ?? '').trim());
  });

  const toolbarRoot = selectionNode?.closest('div')?.parentElement ?? document;

  const describeControl = (el) => {
    const labelText =
      el.id
        ? String(document.querySelector('label[for=\"' + CSS.escape(el.id) + '\"]')?.textContent ?? '')
        : '';

    return [
      String(el.getAttribute('aria-label') ?? ''),
      String(el.getAttribute('name') ?? ''),
      String(el.getAttribute('id') ?? ''),
      String(el.getAttribute('placeholder') ?? ''),
      labelText
    ]
      .join(' ')
      .toLowerCase();
  };

  const controls = Array.from(toolbarRoot.querySelectorAll('select, input'));
  const categoryControl = controls.find((control) => {
    const descriptor = describeControl(control);
    return /(categor|category|type\s*fo|fourniture|fo\s*type)/i.test(descriptor);
  });

  if (!categoryControl) {
    return { ok: false, reason: 'bulk_category_control_not_found' };
  }

  let nextLabel = '';
  if (categoryControl instanceof HTMLSelectElement) {
    const options = Array.from(categoryControl.options);
    const nextOption = options.find((opt) => {
      return Boolean(opt.value) && opt.value !== categoryControl.value;
    });

    if (!nextOption) {
      return { ok: false, reason: 'bulk_category_option_not_found' };
    }

    categoryControl.value = nextOption.value;
    categoryControl.dispatchEvent(new Event('change', { bubbles: true }));
    nextLabel = String(nextOption.textContent ?? '').trim();
  } else {
    categoryControl.focus();
    categoryControl.value = String(categoryControl.value ?? '').trim() || 'Materiaux';
    categoryControl.dispatchEvent(new Event('input', { bubbles: true }));
    categoryControl.dispatchEvent(new Event('change', { bubbles: true }));
    nextLabel = String(categoryControl.value ?? '').trim();
  }

  const actionScope = categoryControl.closest('div') ?? toolbarRoot;
  const applyButton = Array.from(actionScope.querySelectorAll('button')).find((button) => {
    const text = String(button.textContent ?? '').trim();
    return /(categor|type\s*fo|appliqu|modifier|valider)/i.test(text);
  });

  if (applyButton) {
    applyButton.click();
  }

  return {
    ok: true,
    nextLabel,
    usedButton: Boolean(applyButton)
  };
})())
"@

  return $json | ConvertFrom-Json
}

function Invoke-BulkRoleAction {
  param([string]$Session)

  $json = Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const selectionNode = Array.from(document.querySelectorAll('span,div,p,strong')).find((node) => {
    return /^\d+\s+selection\(s\)$/i.test(String(node.textContent ?? '').trim());
  });

  const toolbarRoot = selectionNode?.closest('div')?.parentElement ?? document;

  const describeControl = (el) => {
    const labelText =
      el.id
        ? String(document.querySelector('label[for=\"' + CSS.escape(el.id) + '\"]')?.textContent ?? '')
        : '';

    return [
      String(el.getAttribute('aria-label') ?? ''),
      String(el.getAttribute('name') ?? ''),
      String(el.getAttribute('id') ?? ''),
      String(el.getAttribute('placeholder') ?? ''),
      labelText
    ]
      .join(' ')
      .toLowerCase();
  };

  const controls = Array.from(toolbarRoot.querySelectorAll('select, input'));
  const roleControl = controls.find((control) => {
    const descriptor = describeControl(control);
    return /(role|main\s*d.?oeuvre|type\s*mo|labor)/i.test(descriptor);
  });

  if (!roleControl) {
    return { ok: false, reason: 'bulk_role_control_not_found' };
  }

  let nextLabel = '';
  if (roleControl instanceof HTMLSelectElement) {
    const options = Array.from(roleControl.options);
    const nextOption = options.find((opt) => {
      const label = String(opt.textContent ?? '').trim();
      return Boolean(opt.value) && label !== '-' && opt.value !== roleControl.value;
    });

    if (!nextOption) {
      return { ok: false, reason: 'bulk_role_option_not_found' };
    }

    roleControl.value = nextOption.value;
    roleControl.dispatchEvent(new Event('change', { bubbles: true }));
    nextLabel = String(nextOption.textContent ?? '').trim();
  } else {
    roleControl.focus();
    roleControl.value = String(roleControl.value ?? '').trim() || 'Ouvrier';
    roleControl.dispatchEvent(new Event('input', { bubbles: true }));
    roleControl.dispatchEvent(new Event('change', { bubbles: true }));
    nextLabel = String(roleControl.value ?? '').trim();
  }

  const actionScope = roleControl.closest('div') ?? toolbarRoot;
  const applyButton = Array.from(actionScope.querySelectorAll('button')).find((button) => {
    const text = String(button.textContent ?? '').trim();
    return /(role|mo|appliqu|modifier|valider)/i.test(text);
  });

  if (applyButton) {
    applyButton.click();
  }

  return {
    ok: true,
    nextLabel,
    usedButton: Boolean(applyButton)
  };
})())
"@

  return $json | ConvertFrom-Json
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E EST-103" -Date "2026-02-02" -Validite "30" | Out-Null
  Go-EditorTab -Session $Session

  Add-Chapter -Session $Session -Title "Tmp section A"
  Add-Line -Session $Session -Designation "Tmp ligne 1"
  Add-Line -Session $Session -Designation "Tmp ligne 2"
  Add-Line -Session $Session -Designation "Tmp ligne 3"
  Add-Chapter -Session $Session -Title "Tmp section B"

  Invoke-AB $Session "wait" "250" | Out-Null

  $fixture = Initialize-MultiSelectFixture -Session $Session
  Assert-True -Condition ([int]$fixture.lineCount -ge 3) -Message "Fixture should expose at least 3 lines"
  Assert-True -Condition ([int]$fixture.sectionCount -ge 2) -Message "Fixture should expose at least 2 sections"

  Invoke-AB $Session "press" "Escape" | Out-Null
  Wait-ForSelectionCount -Session $Session -Expected 0 | Out-Null

  Invoke-LineModifierClick -Session $Session -Index 0 -Modifier "ctrl"
  Wait-ForSelectionCount -Session $Session -Expected 1 | Out-Null

  Invoke-LineModifierClick -Session $Session -Index 0 -Modifier "ctrl"
  Wait-ForSelectionCount -Session $Session -Expected 0 | Out-Null

  Invoke-LineModifierClick -Session $Session -Index 0 -Modifier "ctrl"
  Wait-ForSelectionCount -Session $Session -Expected 1 | Out-Null

  Invoke-LineModifierClick -Session $Session -Index 2 -Modifier "shift"
  $shiftSnapshot = Wait-ForSelectionCount -Session $Session -Expected 3
  Assert-Equal -Actual ([string]$shiftSnapshot.selectedCount) -Expected "3" -Message "Shift+click should select row range"

  Invoke-AB $Session "focus" "body" | Out-Null
  Invoke-AB $Session "press" "Control+a" | Out-Null
  $ctrlASnapshot = Wait-ForSelectionCount -Session $Session -Expected ([int]$fixture.lineCount)
  Assert-Equal -Actual ([string]$ctrlASnapshot.selectionCount) -Expected ([string]$fixture.lineCount) -Message "Ctrl+A should select all lines"

  Invoke-AB $Session "press" "Escape" | Out-Null
  Wait-ForSelectionCount -Session $Session -Expected 0 | Out-Null

  Invoke-LineModifierClick -Session $Session -Index 0 -Modifier "ctrl"
  Invoke-LineModifierClick -Session $Session -Index 1 -Modifier "ctrl"
  Wait-ForSelectionCount -Session $Session -Expected 2 | Out-Null

  Click-BlankArea -Session $Session
  Wait-ForSelectionCount -Session $Session -Expected 0 | Out-Null

  Invoke-LineModifierClick -Session $Session -Index 0 -Modifier "ctrl"
  Invoke-LineModifierClick -Session $Session -Index 1 -Modifier "ctrl"
  $selectedBaseline = Wait-ForSelectionCount -Session $Session -Expected 2

  $selectedTitlesBeforeMove = @($selectedBaseline.selectedLines | ForEach-Object { [string]$_.title })
  Assert-Equal -Actual ([string]$selectedTitlesBeforeMove.Count) -Expected "2" -Message "Need two selected lines before bulk actions"

  $moveResult = Invoke-BulkMoveSectionAction -Session $Session
  Assert-True -Condition ([bool]$moveResult.ok) -Message "Move section action unavailable: $($moveResult.reason)"

  Start-Sleep -Milliseconds 400
  $afterMove = Get-MultiSelectSnapshot -Session $Session
  Assert-Equal -Actual ([string]$afterMove.selectionCount) -Expected "2" -Message "Selection should persist after move section"

  foreach ($title in $selectedTitlesBeforeMove) {
    $line = @($afterMove.lines | Where-Object { [string]$_.title -eq $title } | Select-Object -First 1)
    Assert-True -Condition ($line.Count -eq 1) -Message "Moved line '$title' should still exist"
    $targetLabel = [string]$moveResult.targetLabel
    if (-not $targetLabel) {
      $targetLabel = [string]$fixture.targetSection
    }
    Assert-True -Condition (([string]$line[0].sectionTitle) -like "*$targetLabel*") -Message "Line '$title' should be moved to target section"
  }

  $beforeCategoryByTitle = @{}
  foreach ($line in @($afterMove.selectedLines)) {
    $beforeCategoryByTitle[[string]$line.title] = [string]$line.supplyType
  }

  $categoryResult = Invoke-BulkCategoryAction -Session $Session
  Assert-True -Condition ([bool]$categoryResult.ok) -Message "Bulk category action unavailable: $($categoryResult.reason)"

  Start-Sleep -Milliseconds 350
  $afterCategory = Get-MultiSelectSnapshot -Session $Session
  Assert-Equal -Actual ([string]$afterCategory.selectionCount) -Expected "2" -Message "Selection should persist after bulk category"

  $categoryValues = @()
  $categoryChanged = $false
  foreach ($title in $selectedTitlesBeforeMove) {
    $line = @($afterCategory.lines | Where-Object { [string]$_.title -eq $title } | Select-Object -First 1)
    Assert-True -Condition ($line.Count -eq 1) -Message "Line '$title' should exist after bulk category"
    $newValue = [string]$line[0].supplyType
    $categoryValues += $newValue
    if ($beforeCategoryByTitle.ContainsKey($title) -and $beforeCategoryByTitle[$title] -ne $newValue) {
      $categoryChanged = $true
    }
  }
  $uniqueCategoryValues = @($categoryValues | Sort-Object -Unique)
  Assert-True -Condition ($uniqueCategoryValues.Count -eq 1) -Message "Bulk category should align all selected lines to a single category"
  Assert-True -Condition ($uniqueCategoryValues[0].Trim().Length -gt 0) -Message "Bulk category should produce a non empty category value"
  Assert-True -Condition $categoryChanged -Message "Bulk category should modify at least one selected line"

  $beforeRoleByTitle = @{}
  foreach ($line in @($afterCategory.selectedLines)) {
    $beforeRoleByTitle[[string]$line.title] = [string]$line.role
  }

  $roleResult = Invoke-BulkRoleAction -Session $Session
  Assert-True -Condition ([bool]$roleResult.ok) -Message "Bulk role action unavailable: $($roleResult.reason)"

  Start-Sleep -Milliseconds 350
  $afterRole = Get-MultiSelectSnapshot -Session $Session
  Assert-Equal -Actual ([string]$afterRole.selectionCount) -Expected "2" -Message "Selection should persist after bulk role"

  $roleValues = @()
  $roleChanged = $false
  foreach ($title in $selectedTitlesBeforeMove) {
    $line = @($afterRole.lines | Where-Object { [string]$_.title -eq $title } | Select-Object -First 1)
    Assert-True -Condition ($line.Count -eq 1) -Message "Line '$title' should exist after bulk role"
    $newRole = [string]$line[0].role
    $roleValues += $newRole
    if ($beforeRoleByTitle.ContainsKey($title) -and $beforeRoleByTitle[$title] -ne $newRole) {
      $roleChanged = $true
    }
  }
  $uniqueRoleValues = @($roleValues | Sort-Object -Unique)
  Assert-True -Condition ($uniqueRoleValues.Count -eq 1) -Message "Bulk role should align all selected lines to a single role"
  Assert-True -Condition ($uniqueRoleValues[0].Trim().Length -gt 0 -and $uniqueRoleValues[0].Trim() -ne "-") -Message "Bulk role should produce a non empty role"
  Assert-True -Condition $roleChanged -Message "Bulk role should modify at least one selected line"

  $beforeDelete = Get-MultiSelectSnapshot -Session $Session
  $deleteSelectionCount = [int]$beforeDelete.selectionCount
  $deleteLineCount = [int]$beforeDelete.lineCount
  Assert-True -Condition ($deleteSelectionCount -gt 0) -Message "Delete scenario requires selected lines"

  Invoke-AB $Session "eval" @"
(() => {
  window.__est103ConfirmMessages = [];
  window.confirm = (message) => {
    window.__est103ConfirmMessages.push(String(message ?? ''));
    return true;
  };
})();
"@ | Out-Null

  Invoke-AB $Session "press" "Delete" | Out-Null

  $afterDelete = Wait-ForLineCount -Session $Session -Expected ($deleteLineCount - $deleteSelectionCount)
  $confirmCount = [int](Invoke-AB $Session "eval" "Array.isArray(window.__est103ConfirmMessages) ? window.__est103ConfirmMessages.length : 0")
  Assert-True -Condition ($confirmCount -ge 1) -Message "Delete shortcut should request confirmation"
  Assert-Equal -Actual ([string]$afterDelete.selectionCount) -Expected "0" -Message "Selection should be cleared after delete"

  Write-Host "EST-103 MULTISELECT PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
