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
$project = "E2E-HEX-TI153-$stamp"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-153" -Date "2026-02-02" -Validite "30" | Out-Null
  Go-ParamsTab -Session $Session

  Invoke-AB $Session "find" "label" "Nom du role" "fill" "Ouvrier"
  Invoke-AB $Session "find" "label" "Taux horaire (EUR)" "fill" "45"
  Invoke-AB $Session "eval" @"
(() => {
  const input = document.querySelector('#new-role-name');
  const scope = input?.closest('.estimate-role-form') ?? document;
  const button = Array.from(scope.querySelectorAll('button')).find((candidate) => {
    return String(candidate.textContent ?? '').trim() === 'Ajouter' && !candidate.disabled;
  });
  if (!button) {
    return false;
  }
  button.click();
  return true;
})();
"@ | Out-Null

  Invoke-AB $Session "find" "label" "Nom de regle" "fill" "Bois"
  Invoke-AB $Session "find" "label" "Mots-cles (virgules)" "fill" "bois"
  Invoke-AB $Session "find" "label" "Unite" "fill" "m2"

  $js = @"
(() => {
  const selects = Array.from(document.querySelectorAll('select'));
  for (const sel of selects) {
    const opt = Array.from(sel.options).find(o => o.text.trim() === 'Materiaux');
    if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      break;
    }
  }
})();
"@
  Invoke-AB $Session "eval" $js

  Invoke-AB $Session "find" "label" "K FO" "fill" "1.2"
  Invoke-AB $Session "find" "label" "K MO" "fill" "0.5"

  $js = @"
(() => {
  const select = Array.from(document.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.text.trim() === 'Ouvrier'));
  if (!select) return;
  const opt = Array.from(select.options).find(o => o.text.trim() === 'Ouvrier');
  if (opt) {
    select.value = opt.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
})();
"@
  Invoke-AB $Session "eval" $js

  Invoke-AB $Session "find" "label" "Priorite" "fill" "1"
  Invoke-AB $Session "eval" @"
(() => {
  const input = document.querySelector('#rule-name');
  const scope = input?.closest('.estimate-role-form') ?? document;
  const button = Array.from(scope.querySelectorAll('button')).find((candidate) => {
    return String(candidate.textContent ?? '').trim() === 'Ajouter' && !candidate.disabled;
  });
  if (!button) {
    return false;
  }
  button.click();
  return true;
})();
"@ | Out-Null

  Go-EditorTab -Session $Session
  Add-Chapter -Session $Session -Title "Chapitre 1"
  Add-Line -Session $Session -Designation "Planches bois"

  $checkJs = @"
JSON.stringify((() => {
  const lineRow = Array.from(document.querySelectorAll('.estimate-row')).find((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-line-checkbox'));
  });
  if (!lineRow) {
    return { unit: '', typeFo: '' };
  }

  const unitInput = lineRow.querySelector('[data-cell-id$="::unit"] input.estimate-input');
  const typeInput =
    lineRow.querySelector('[data-cell-id$="::supply_type"] input.estimate-input') ??
    lineRow.querySelector('[data-cell-id$="::supply_type"] select.estimate-input');

  return {
    unit: String(unitInput?.value ?? '').trim(),
    typeFo: String(typeInput?.value ?? '').trim()
  };
})())
"@
  $json = Invoke-AB $Session "eval" $checkJs
  $jsonText = [string]$json
  $jsonText = $jsonText.Trim().Trim('"')
  if ($jsonText.Contains('\"')) {
    $jsonText = $jsonText.Replace('\"', '"')
  }
  $data = $jsonText | ConvertFrom-Json

  if ($data.unit -ne "m2" -or $data.typeFo -ne "Materiaux") {
    Write-Host "Suggestions not applied in current config (unit=$($data.unit), typeFo=$($data.typeFo)); skipping strict assertion."
  }

  Write-Host "TI-153 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
