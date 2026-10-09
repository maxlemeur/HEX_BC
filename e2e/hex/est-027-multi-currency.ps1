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

# The settings drawer no longer shows a "Parametrage enregistre" message: poll the persisted version instead.
function Wait-ForVersionCurrency {
  param(
    [string]$Session,
    [string]$VersionId,
    [string]$Currency,
    [int]$TimeoutSeconds = 30
  )

  $versionIdJson = ConvertTo-Json $VersionId -Compress
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastCurrency = ""
  while ((Get-Date) -lt $deadline) {
    $raw = [string](Invoke-AB $Session "eval" @"
(async () => {
  const response = await fetch('/api/estimates/' + $versionIdJson, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  return String(payload?.data?.version?.currency ?? '');
})()
"@)
    $lastCurrency = Normalize-AgentString -Raw $raw
    if ($lastCurrency -eq $Currency) {
      return
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Version currency should be $Currency after saving the settings (last: '$lastCurrency')."
}

# Delete confirmations use the in-app alert dialog (useConfirm) instead of window.confirm.
function Confirm-AlertDialog {
  param(
    [string]$Session,
    [string]$ConfirmLabel,
    [int]$TimeoutSeconds = 10
  )

  $labelJson = ConvertTo-Json $ConfirmLabel -Compress
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $clicked = Invoke-AB $Session "eval" @"
(() => {
  const label = $labelJson;
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) return false;
  const button = Array.from(dialog.querySelectorAll('button')).find((candidate) =>
    String(candidate.textContent ?? '').replace(/\s+/g, ' ').trim() === label && !candidate.disabled
  );
  if (!button) return false;
  button.click();
  return true;
})()
"@
    if ($clicked -eq $true -or "$clicked" -eq "true") {
      return
    }
    Start-Sleep -Milliseconds 250
  }

  throw "Confirmation dialog button '$ConfirmLabel' not found."
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E EST-027" -Date "2026-02-24" -Validité "30"

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
  Set-LineValues -Session $Session -Quantity "1" -Unit "u" -PriceFo "1,234.56" -TypeFo "Matériaux" -Kfo "1" -HoursMo "0" -Kmo "1"
  Invoke-AB $Session "eval" "document.activeElement && typeof document.activeElement.blur === 'function' ? document.activeElement.blur() : null" | Out-Null

  Go-ParamsTab -Session $Session
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Enregistrer le paramétrage" | Out-Null
  Wait-ForVersionCurrency -Session $Session -VersionId $versionId -Currency "USD" -TimeoutSeconds 30

  Invoke-AB $Session "open" "$BaseUrl/dashboard/admin/currencies" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/admin/currencies" | Out-Null
  $adminText = Wait-ForPageTextContains -Session $Session -Expected "Nouveau taux" -TimeoutSeconds 20
  Assert-Contains -Text $adminText -Expected "Taux de change" -Message "admin currencies title"
  Assert-Contains -Text $adminText -Expected "Inclure inactifs" -Message "include inactive filter"
  Assert-Contains -Text $adminText -Expected "Nouveau taux" -Message "create currency rate block"

  # "Nouveau taux" is a PageSection (no .dashboard-card); its fields have useId-based ids ending in -create-*.
  Invoke-AB $Session "fill" "[id$='-create-from']" $rateFrom | Out-Null
  Invoke-AB $Session "fill" "[id$='-create-to']" $rateTo | Out-Null
  Invoke-AB $Session "fill" "[id$='-create-rate']" $createdRate | Out-Null
  Invoke-AB $Session "fill" "[id$='-create-date']" $rateDate | Out-Null
  Invoke-AB $Session "fill" "[id$='-create-source']" "manual" | Out-Null
  # "Cr$([char]0x00E9)er" = "Creer" with its accent, kept ASCII in this BOM-less script.
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Cr$([char]0x00E9)er" "--exact" | Out-Null
  # "?" wildcards stand for accented letters in the success messages.
  Wait-ForPageTextContains -Session $Session -Expected "Taux $rateFrom/$rateTo cr??." -TimeoutSeconds 30 | Out-Null

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
  Wait-ForPageTextContains -Session $Session -Expected "Taux $rateFrom/$rateTo mis ? jour" -TimeoutSeconds 30 | Out-Null

  # The rate was just deactivated and the list hides inactive rates by default: show them again.
  Invoke-AB $Session "eval" @"
(() => {
  const label = Array.from(document.querySelectorAll('label')).find((node) =>
    String(node.textContent ?? '').replace(/\s+/g, ' ').trim() === 'Inclure inactifs'
  );
  const checkbox = label?.querySelector('input[type="checkbox"]');
  if (!(checkbox instanceof HTMLInputElement)) throw new Error('Include inactive filter not found');
  if (!checkbox.checked) checkbox.click();
  return true;
})();
"@ | Out-Null

  $rowDeadline = (Get-Date).AddSeconds(20)
  $rowVisible = $false
  while ((Get-Date) -lt $rowDeadline -and -not $rowVisible) {
    $rowProbe = Invoke-AB $Session "eval" @"
(() => Array.from(document.querySelectorAll('table tbody tr')).some((row) => {
  const values = Array.from(row.querySelectorAll('input')).map((input) => String(input.value ?? '').trim().toUpperCase());
  return values.includes('$rateFrom') && values.includes('$rateTo') && values.includes('$rateDate');
}))()
"@
    $rowVisible = ($rowProbe -eq $true -or "$rowProbe" -eq "true")
    if (-not $rowVisible) {
      Start-Sleep -Milliseconds 400
    }
  }

  Invoke-AB $Session "eval" @"
(() => {
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
  Confirm-AlertDialog -Session $Session -ConfirmLabel "Supprimer"
  Wait-ForPageTextContains -Session $Session -Expected "Taux $rateFrom/$rateTo supprim?." -TimeoutSeconds 30 | Out-Null

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/estimates" | Out-Null
  $listText = Get-PageText -Session $Session
  Assert-Contains -Text $listText -Expected "Devise" -Message "estimates currency column"
  Assert-Contains -Text $listText -Expected "USD" -Message "currency value shown in estimate list"
  if ($listText -notmatch "\$") {
    throw "Estimate list should contain a USD amount with '$'."
  }

  Open-EstimatePrint -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
  # PrintCurrencySelect is now a disabled, single-option select showing the version currency.
  Invoke-AB $Session "eval" @"
(() => {
  const select = document.querySelector('select[aria-label="Devise"]') ??
    Array.from(document.querySelectorAll('select')).find((node) =>
      ['EUR', 'USD', 'GBP'].includes(String(node.value ?? '').trim())
    );
  if (!select) throw new Error('Print currency select not found');
  if (String(select.value ?? '').trim() !== 'USD') {
    throw new Error('Print currency should be USD, got ' + select.value);
  }
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
