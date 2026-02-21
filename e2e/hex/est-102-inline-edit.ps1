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
$project = "E2E-HEX-EST102-$stamp"

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

function Assert-Match {
  param(
    [string]$Actual,
    [string]$Pattern,
    [string]$Message
  )

  if ($Actual -notmatch $Pattern) {
    throw "$Message (value='$Actual', pattern='$Pattern')"
  }
}

function Initialize-InlineSelectors {
  param([string]$Session)

  $json = Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const lineTitleInputs = Array.from(
    document.querySelectorAll('.estimate-row input.estimate-input--title')
  ).filter((input) => !input.closest('.estimate-row--section'));

  const lineTitleInput = lineTitleInputs[0];
  if (!lineTitleInput) {
    throw new Error('Missing line title input.');
  }

  const row = lineTitleInput.closest('.estimate-row');
  if (!row) {
    throw new Error('Missing line row.');
  }

  const titleCell = row.querySelector('[data-cell-id$="::title"]');
  if (!titleCell) {
    throw new Error('Missing title cell.');
  }

  const unitPriceInput = row.querySelector('[data-cell-id$="::unit_price"] input.estimate-input');
  if (!unitPriceInput) {
    throw new Error('Missing unit price input.');
  }

  const editableCells = Array.from(row.querySelectorAll('[data-cell-id]'));
  if (editableCells.length === 0) {
    throw new Error('Missing editable cells in line row.');
  }

  const lastEditableCell = editableCells[editableCells.length - 1];
  const lastEditableEditor = lastEditableCell.querySelector('input, select, textarea');
  if (!lastEditableEditor) {
    throw new Error('Missing editor in last editable cell.');
  }

  const puInput = row.querySelector('input[readonly]');
  if (!puInput) {
    throw new Error('Missing read-only PU input.');
  }

  const totalCell = row.querySelector('.estimate-cell--total');
  if (!totalCell) {
    throw new Error('Missing total cell.');
  }

  titleCell.setAttribute('data-inline-id', 'line-title-cell');
  lineTitleInput.setAttribute('data-inline-id', 'line-title-input');
  unitPriceInput.setAttribute('data-inline-id', 'line-unit-price-input');
  lastEditableCell.setAttribute('data-inline-id', 'line-last-editable-cell');
  lastEditableEditor.setAttribute('data-inline-id', 'line-last-editable-editor');
  puInput.setAttribute('data-inline-id', 'line-pu-input');
  totalCell.setAttribute('data-inline-id', 'line-total-cell');

  const setValue = (el, value) => {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  };

  setValue(lineTitleInput, 'INLINE BASE');

  return {
    titleCellId: titleCell.getAttribute('data-cell-id') ?? '',
    lastEditableCellId: lastEditableCell.getAttribute('data-cell-id') ?? '',
    puReadOnly: Boolean(puInput.readOnly),
    puDisabled: Boolean(puInput.disabled),
    totalText: String(totalCell.textContent ?? '').trim()
  };
})())
"@

  return $json | ConvertFrom-Json
}

function Wait-ForFormattedPrice {
  param(
    [string]$Session,
    [int]$TimeoutSeconds = 8
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $value = [string](Invoke-AB $Session "eval" "document.querySelector('[data-inline-id=\"line-unit-price-input\"]')?.value ?? ''")

    if (
      $value -match '^(?:[0-9]{1,3}(?:[ \u00A0][0-9]{3})+|[0-9]+)[\.,][0-9]{2}$' -and
      $value -ne "1234,5"
    ) {
      return $value
    }

    Start-Sleep -Milliseconds 150
  }

  throw "Timeout waiting formatted unit price value."
}

function Get-ActiveInlineTarget {
  param([string]$Session)

  return [string](Invoke-AB $Session "eval" @"
(() => {
  const puInput = document.querySelector('[data-inline-id="line-pu-input"]');
  const puCell = puInput?.closest('.estimate-cell') ?? null;
  const totalCell = document.querySelector('[data-inline-id="line-total-cell"]');
  const active = document.activeElement;
  const activeCell = document.querySelector('.estimate-cell--active');

  if (active && puInput && active === puInput) {
    return 'pu-input';
  }
  if (active && puCell && active === puCell) {
    return 'pu-input';
  }
  if (activeCell && puCell && activeCell === puCell) {
    return 'pu-input';
  }

  if (active && totalCell && (active === totalCell || totalCell.contains(active))) {
    return 'total-cell';
  }
  if (activeCell && totalCell && activeCell === totalCell) {
    return 'total-cell';
  }

  if (!(active instanceof Element)) {
    return '';
  }

  return (
    active.getAttribute('data-inline-id') ??
    active.getAttribute('data-cell-id') ??
    active.tagName.toLowerCase()
  );
})()
"@)
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E EST-102" -Date "2026-02-02" -Validite "30" | Out-Null
  Go-EditorTab -Session $Session

  Add-Chapter -Session $Session -Title "Chapitre inline"
  Add-Line -Session $Session -Designation "Ligne inline"
  Set-LineValues -Session $Session -Quantity "1" -Unit "u" -PriceFo "12" -TypeFo "Materiaux" -Kfo "1" -HoursMo "0" -Kmo "1"

  $setup = Initialize-InlineSelectors -Session $Session
  Assert-True -Condition ([bool]$setup.puReadOnly) -Message "PU field should be readonly"
  Assert-True -Condition (-not [bool]$setup.puDisabled) -Message "PU readonly field should stay focusable"
  Assert-True -Condition (([string]$setup.totalText).Length -gt 0) -Message "Total cell should expose a rendered value"

  Invoke-AB $Session "click" "[data-inline-id='line-title-input']" | Out-Null
  $clickState = (Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const input = document.querySelector('[data-inline-id="line-title-input"]');
  if (!input) throw new Error('line-title-input not found');
  return {
    active: document.activeElement === input,
    selectionStart: input.selectionStart ?? -1,
    selectionEnd: input.selectionEnd ?? -1
  };
})())
"@) | ConvertFrom-Json
  Assert-True -Condition ([bool]$clickState.active) -Message "Single click should activate inline editor"
  Assert-True -Condition ([int]$clickState.selectionStart -ge 0) -Message "Caret should be positioned after single click"

  Invoke-AB $Session "eval" @"
(() => {
  const input = document.querySelector('[data-inline-id="line-title-input"]');
  if (!input) throw new Error('line-title-input not found');
  input.focus();
  input.value = 'DOUBLE CLIC';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
})();
"@ | Out-Null

  Invoke-AB $Session "dblclick" "[data-inline-id='line-title-cell']" | Out-Null
  $doubleClickState = (Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const input = document.querySelector('[data-inline-id="line-title-input"]');
  if (!input) throw new Error('line-title-input not found');
  const value = String(input.value ?? '');
  return {
    active: document.activeElement === input,
    valueLength: value.length,
    selectionStart: input.selectionStart ?? -1,
    selectionEnd: input.selectionEnd ?? -1
  };
})())
"@) | ConvertFrom-Json
  Assert-True -Condition ([bool]$doubleClickState.active) -Message "Double click should focus inline editor"
  Assert-Equal -Actual ([string]$doubleClickState.selectionStart) -Expected "0" -Message "Double click should select from start"
  Assert-Equal -Actual ([string]$doubleClickState.selectionEnd) -Expected ([string]$doubleClickState.valueLength) -Message "Double click should select full cell content"

  Invoke-AB $Session "eval" @"
(() => {
  const input = document.querySelector('[data-inline-id="line-title-input"]');
  const cell = document.querySelector('[data-inline-id="line-title-cell"]');
  if (!input || !cell) throw new Error('Missing title input/cell');

  input.focus();
  input.value = 'ANCIENNE VALEUR';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();

  cell.focus();
})();
"@ | Out-Null

  Invoke-AB $Session "press" "R" | Out-Null
  $replaceValue = [string](Invoke-AB $Session "eval" "document.querySelector('[data-inline-id=\"line-title-input\"]')?.value ?? ''")
  Assert-Equal -Actual $replaceValue -Expected "R" -Message "Typing should replace existing content in replacement mode"

  Invoke-AB $Session "fill" "[data-inline-id='line-unit-price-input']" "1234,5" | Out-Null
  Invoke-AB $Session "click" "[data-inline-id='line-title-input']" | Out-Null
  $formattedPrice = Wait-ForFormattedPrice -Session $Session
  Assert-Match -Actual $formattedPrice -Pattern '^(?:[0-9]{1,3}(?:[ \u00A0][0-9]{3})+|[0-9]+)[\.,][0-9]{2}$' -Message "Blur should format numeric price with two decimals"

  Invoke-AB $Session "click" "[data-inline-id='line-title-input']" | Out-Null
  Invoke-AB $Session "press" "Control+a" | Out-Null
  Invoke-AB $Session "press" "N" | Out-Null
  $editedValue = [string](Invoke-AB $Session "eval" "document.querySelector('[data-inline-id=\"line-title-input\"]')?.value ?? ''")
  Assert-Equal -Actual $editedValue -Expected "N" -Message "Precondition failed for Ctrl+Z test"

  Invoke-AB $Session "press" "Control+z" | Out-Null
  $undoValue = [string](Invoke-AB $Session "eval" "document.querySelector('[data-inline-id=\"line-title-input\"]')?.value ?? ''")
  Assert-Equal -Actual $undoValue -Expected "R" -Message "Ctrl+Z should undo local edit in active cell"

  $puBefore = [string](Invoke-AB $Session "eval" "document.querySelector('[data-inline-id=\"line-pu-input\"]')?.value ?? ''")
  Invoke-AB $Session "click" "[data-inline-id='line-pu-input']" | Out-Null
  Invoke-AB $Session "press" "9" | Out-Null
  $puAfter = [string](Invoke-AB $Session "eval" "document.querySelector('[data-inline-id=\"line-pu-input\"]')?.value ?? ''")
  Assert-Equal -Actual $puAfter -Expected $puBefore -Message "PU readonly cell should remain non editable"

  Invoke-AB $Session "eval" @"
(() => {
  const editor = document.querySelector('[data-inline-id="line-last-editable-editor"]');
  if (!editor) throw new Error('line-last-editable-editor not found');
  editor.focus();
})();
"@ | Out-Null

  Invoke-AB $Session "press" "Tab" | Out-Null
  $afterFirstTab = Get-ActiveInlineTarget -Session $Session
  Assert-Equal -Actual $afterFirstTab -Expected "pu-input" -Message "Keyboard navigation should reach readonly PU cell"

  Invoke-AB $Session "press" "Tab" | Out-Null
  $afterSecondTab = Get-ActiveInlineTarget -Session $Session
  Assert-Equal -Actual $afterSecondTab -Expected "total-cell" -Message "Keyboard navigation should reach readonly total cell"

  Write-Host "EST-102 INLINE EDIT PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
