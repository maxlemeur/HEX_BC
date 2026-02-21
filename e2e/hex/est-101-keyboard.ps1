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
$project = "E2E-HEX-EST101-$stamp"

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

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E EST-101" -Date "2026-02-02" -Validite "30" | Out-Null
  Go-EditorTab -Session $Session

  Add-Chapter -Session $Session -Title "Chapitre clavier"
  Add-Line -Session $Session -Designation "Ligne clavier"

  $setupJs = @"
(() => {
  const titleInputs = Array.from(document.querySelectorAll('input.estimate-input--title'));
  if (titleInputs.length < 2) {
    throw new Error('Expected at least section and line title inputs.');
  }

  const sectionTitle = titleInputs[0];
  const lineTitle = titleInputs[1];
  const sectionRow = sectionTitle.closest('.estimate-row');
  const lineRow = lineTitle.closest('.estimate-row');
  if (!sectionRow || !lineRow) {
    throw new Error('Unable to resolve section/line rows.');
  }

  sectionTitle.setAttribute('data-kbd-id', 'section-title');
  lineTitle.setAttribute('data-kbd-id', 'line-title');

  const lineFields = Array.from(
    lineRow.querySelectorAll('input.estimate-input, select.estimate-input')
  );
  if (lineFields.length < 9) {
    throw new Error('Expected line fields to be rendered.');
  }

  const lineMapping = [
    'line-title',
    'line-quantity',
    'line-unit',
    'line-price',
    'line-category',
    'line-kfo',
    'line-hmo',
    'line-role',
    'line-kmo'
  ];
  lineMapping.forEach((id, index) => {
    const el = lineFields[index];
    if (el) {
      el.setAttribute('data-kbd-id', id);
    }
  });

  const sectionButtons = Array.from(sectionRow.querySelectorAll('button.btn.btn-ghost.btn-sm'));
  const addLineButton = sectionButtons[0];
  if (!addLineButton) {
    throw new Error('Unable to find section add line button.');
  }
  addLineButton.setAttribute('data-kbd-id', 'section-add-line');

  return JSON.stringify({
    sectionInputCount: sectionRow.querySelectorAll('input.estimate-input').length,
    lineFieldCount: lineFields.length
  });
})();
"@

  $setupResult = Invoke-AB $Session "eval" $setupJs
  $setup = $setupResult | ConvertFrom-Json
  Assert-Equal -Actual ([string]$setup.sectionInputCount) -Expected "1" -Message "Section should expose one editable input (title)"
  Assert-True -Condition ($setup.lineFieldCount -ge 9) -Message "Line row fields are missing"

  $focusLineTitleJs = @"
(() => {
  const el = document.querySelector('[data-kbd-id="line-title"]');
  if (!el) throw new Error('line-title not found');
  el.focus();
  return document.activeElement?.getAttribute('data-kbd-id') || '';
})();
"@
  $active = Invoke-AB $Session "eval" $focusLineTitleJs
  Assert-Equal -Actual $active -Expected "line-title" -Message "Initial focus should be line title"

  Invoke-AB $Session "press" "Tab" | Out-Null
  $active = Invoke-AB $Session "eval" "document.activeElement?.getAttribute('data-kbd-id') || ''"
  Assert-Equal -Actual $active -Expected "line-quantity" -Message "Tab should move to next line cell"

  Invoke-AB $Session "press" "Shift+Tab" | Out-Null
  $active = Invoke-AB $Session "eval" "document.activeElement?.getAttribute('data-kbd-id') || ''"
  Assert-Equal -Actual $active -Expected "line-title" -Message "Shift+Tab should move to previous line cell"

  Invoke-AB $Session "press" "Enter" | Out-Null
  $active = Invoke-AB $Session "eval" "document.activeElement?.getAttribute('data-kbd-id') || ''"
  Assert-Equal -Actual $active -Expected "line-title" -Message "Enter should keep focus on inline text cell"

  Invoke-AB $Session "press" "Escape" | Out-Null
  $active = Invoke-AB $Session "eval" "document.activeElement?.getAttribute('data-kbd-id') || ''"
  Assert-Equal -Actual $active -Expected "line-title" -Message "Escape should not break focus navigation"

  $quantityInitJs = @"
(() => {
  const input = document.querySelector('[data-kbd-id="line-quantity"]');
  if (!input) throw new Error('line-quantity not found');
  input.focus();
  input.value = '1';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return Number(input.value);
})();
"@
  [double]$qtyBefore = Invoke-AB $Session "eval" $quantityInitJs
  Invoke-AB $Session "press" "ArrowUp" | Out-Null
  [double]$qtyAfterUp = Invoke-AB $Session "eval" "Number(document.querySelector('[data-kbd-id=\"line-quantity\"]')?.value ?? '0')"
  Assert-True -Condition ($qtyAfterUp -gt $qtyBefore) -Message "ArrowUp should increase quantity"

  Invoke-AB $Session "press" "ArrowDown" | Out-Null
  [double]$qtyAfterDown = Invoke-AB $Session "eval" "Number(document.querySelector('[data-kbd-id=\"line-quantity\"]')?.value ?? '0')"
  Assert-True -Condition ($qtyAfterDown -lt $qtyAfterUp) -Message "ArrowDown should decrease quantity"

  $caretInitJs = @"
(() => {
  const input = document.querySelector('[data-kbd-id="line-title"]');
  if (!input) throw new Error('line-title not found');
  input.focus();
  input.value = 'CLAVIER';
  input.setSelectionRange(input.value.length, input.value.length);
  return JSON.stringify({ pos: input.selectionStart ?? -1, len: input.value.length });
})();
"@
  $caretInit = (Invoke-AB $Session "eval" $caretInitJs) | ConvertFrom-Json
  Invoke-AB $Session "press" "ArrowLeft" | Out-Null
  [int]$caretLeft = Invoke-AB $Session "eval" "(document.querySelector('[data-kbd-id=\"line-title\"]')?.selectionStart ?? -1)"
  Assert-True -Condition ($caretLeft -lt [int]$caretInit.pos) -Message "ArrowLeft should move caret left"

  Invoke-AB $Session "press" "ArrowRight" | Out-Null
  [int]$caretRight = Invoke-AB $Session "eval" "(document.querySelector('[data-kbd-id=\"line-title\"]')?.selectionStart ?? -1)"
  Assert-True -Condition ($caretRight -gt $caretLeft) -Message "ArrowRight should move caret right"

  [int]$titlesBeforeEnter = Invoke-AB $Session "eval" "document.querySelectorAll('input.estimate-input--title').length"
  Invoke-AB $Session "eval" "document.querySelector('[data-kbd-id=\"section-title\"]')?.focus(); document.activeElement?.getAttribute('data-kbd-id') || ''" | Out-Null
  Invoke-AB $Session "press" "Tab" | Out-Null
  $active = Invoke-AB $Session "eval" "document.activeElement?.getAttribute('data-kbd-id') || ''"
  Assert-Equal -Actual $active -Expected "section-add-line" -Message "Section tab order should reach add line button"

  Invoke-AB $Session "press" "Enter" | Out-Null
  Invoke-AB $Session "wait" "200" | Out-Null
  [int]$titlesAfterEnter = Invoke-AB $Session "eval" "document.querySelectorAll('input.estimate-input--title').length"
  Assert-True -Condition ($titlesAfterEnter -gt $titlesBeforeEnter) -Message "Enter on section add-line should create a new line"

  Write-Host "EST-101 KEYBOARD PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
