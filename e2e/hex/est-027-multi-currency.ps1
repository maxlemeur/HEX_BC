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
$project = "E2E-HEX-EST027-$stamp"
$versionId = $null
$rateFrom = "USD"
$rateTo = "GBP"
$rateDate = "2099-12-31"
$createdRate = "1.1234"
$updatedRate = "1.2345"

function Wait-ForPageTextContains {
  param(
    [string]$Session,
    [string]$Expected,
    [int]$TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $text = Get-PageText -Session $Session
    if ($text -like "*$Expected*") {
      return $text
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Missing expected content after timeout: $Expected"
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E EST-027" -Date "2026-02-24" -Validite "30"

  Go-ParamsTab -Session $Session
  Invoke-AB $Session "eval" @"
(() => {
  const currencySelect = document.querySelector('#estimate-currency');
  if (!currencySelect) throw new Error('Currency select not found');
  currencySelect.value = 'USD';
  currencySelect.dispatchEvent(new Event('change', { bubbles: true }));
})();
"@ | Out-Null

  Go-EditorTab -Session $Session
  Add-Chapter -Session $Session -Title "Section EST-027"
  Add-Line -Session $Session -Designation "Ligne USD"
  Set-LineValues -Session $Session -Quantity "1" -Unit "u" -PriceFo "1,234.56" -TypeFo "Materiaux" -Kfo "1" -HoursMo "0" -Kmo "1"
  Invoke-AB $Session "eval" "document.activeElement && typeof document.activeElement.blur === 'function' ? document.activeElement.blur() : null" | Out-Null

  Go-ParamsTab -Session $Session
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Enregistrer le parametrage" | Out-Null
  Wait-ForPageTextContains -Session $Session -Expected "Parametrage enregistre" -TimeoutSeconds 30 | Out-Null

  Invoke-AB $Session "open" "$BaseUrl/dashboard/admin/currencies" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/admin/currencies" | Out-Null
  $adminText = Get-PageText -Session $Session
  Assert-Contains -Text $adminText -Expected "Taux de change" -Message "admin currencies title"
  Assert-Contains -Text $adminText -Expected "Inclure inactifs" -Message "include inactive filter"
  Assert-Contains -Text $adminText -Expected "Nouveau taux" -Message "create currency rate block"

  Invoke-AB $Session "eval" @"
(() => {
  const card = Array.from(document.querySelectorAll('.dashboard-card')).find((node) =>
    String(node.textContent ?? '').includes('Nouveau taux')
  );
  if (!card) throw new Error('Create currency rate card not found');
  const inputs = card.querySelectorAll('input');
  if (inputs.length < 6) throw new Error('Create form inputs missing');

  const fill = (el, value) => {
    el.focus();
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  fill(inputs[0], '$rateFrom');
  fill(inputs[1], '$rateTo');
  fill(inputs[2], '$createdRate');
  fill(inputs[3], '$rateDate');
  fill(inputs[4], 'manual');
})();
"@ | Out-Null
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Creer" | Out-Null
  Wait-ForPageTextContains -Session $Session -Expected "cree avec succes" -TimeoutSeconds 30 | Out-Null

  Invoke-AB $Session "eval" @"
(() => {
  const rows = Array.from(document.querySelectorAll('table tbody tr'));
  const target = rows.find((row) => {
    const values = Array.from(row.querySelectorAll('input')).map((input) => String(input.value ?? '').trim().toUpperCase());
    return values.includes('$rateFrom') && values.includes('$rateTo') && values.includes('$rateDate');
  });
  if (!target) throw new Error('Currency rate row not found for update');

  const allInputs = Array.from(target.querySelectorAll('input'));
  const rateInput = allInputs.find((input) => input.getAttribute('inputmode') === 'decimal');
  const activeCheckbox = allInputs.find((input) => input.type === 'checkbox');
  if (!rateInput || !activeCheckbox) throw new Error('Editable rate row inputs not found');

  rateInput.focus();
  rateInput.value = '$updatedRate';
  rateInput.dispatchEvent(new Event('input', { bubbles: true }));
  rateInput.dispatchEvent(new Event('change', { bubbles: true }));

  if (activeCheckbox.checked) {
    activeCheckbox.click();
  }

  const saveButton = Array.from(target.querySelectorAll('button')).find((button) =>
    String(button.textContent ?? '').trim() === 'Enregistrer'
  );
  if (!saveButton) throw new Error('Save button not found for rate row');
  saveButton.click();
})();
"@ | Out-Null
  Wait-ForPageTextContains -Session $Session -Expected "mis a jour" -TimeoutSeconds 30 | Out-Null

  Invoke-AB $Session "eval" @"
(() => {
  window.confirm = () => true;
  const rows = Array.from(document.querySelectorAll('table tbody tr'));
  const target = rows.find((row) => {
    const values = Array.from(row.querySelectorAll('input')).map((input) => String(input.value ?? '').trim().toUpperCase());
    return values.includes('$rateFrom') && values.includes('$rateTo') && values.includes('$rateDate');
  });
  if (!target) throw new Error('Currency rate row not found for delete');

  const deleteButton = Array.from(target.querySelectorAll('button')).find((button) =>
    String(button.textContent ?? '').trim() === 'Supprimer'
  );
  if (!deleteButton) throw new Error('Delete button not found for rate row');
  deleteButton.click();
})();
"@ | Out-Null
  Wait-ForPageTextContains -Session $Session -Expected "supprime" -TimeoutSeconds 30 | Out-Null

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/estimates" | Out-Null
  $listText = Get-PageText -Session $Session
  Assert-Contains -Text $listText -Expected "Devise" -Message "estimates currency column"
  Assert-Contains -Text $listText -Expected "USD" -Message "currency value shown in estimate list"
  if ($listText -notmatch "\$") {
    throw "Estimate list should contain a USD amount with '$'."
  }

  Open-EstimatePrint -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
  Invoke-AB $Session "eval" @"
(() => {
  const select = Array.from(document.querySelectorAll('select')).find((node) =>
    ['EUR', 'USD', 'GBP'].includes(String(node.value ?? '').trim())
  );
  if (!select) throw new Error('Print currency select not found');
  select.value = 'USD';
  select.dispatchEvent(new Event('change', { bubbles: true }));
})();
"@ | Out-Null
  Start-Sleep -Seconds 1
  $printText = Get-PageText -Session $Session
  Assert-Contains -Text $printText -Expected "Total HT" -Message "print totals block"
  if ($printText -notmatch "\$") {
    throw "Print page should contain USD amounts."
  }

  Ensure-NoConsoleErrors -Session $Session
  Write-Host "EST-027 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
