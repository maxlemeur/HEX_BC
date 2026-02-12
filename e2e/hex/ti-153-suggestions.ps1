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
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Ajouter"

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
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Ajouter"

  Go-EditorTab -Session $Session
  Add-Chapter -Session $Session -Title "Chapitre 1"
  Add-Line -Session $Session -Designation "Planches bois"

  $checkJs = "JSON.stringify((() => { const inputs = Array.from(document.querySelectorAll('input.estimate-input')); return { unit: inputs[1]?.value || '', typeFo: inputs[3]?.value || '' }; })())"
  $json = Invoke-AB $Session "eval" $checkJs
  $data = $json | ConvertFrom-Json

  if ($data.unit -ne "m2" -or $data.typeFo -ne "Materiaux") {
    throw "Suggestion not applied (unit=$($data.unit), typeFo=$($data.typeFo))"
  }

  Write-Host "TI-153 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
