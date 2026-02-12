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
$project = "E2E-HEX-TI146-$stamp"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-146" -Date "2026-02-02" -Validite "30" | Out-Null
  Go-ParamsTab -Session $Session

  Invoke-AB $Session "find" "label" "Marge (multiplicateur)" "fill" "1.2"
  Invoke-AB $Session "find" "label" "Remise (EUR HT)" "fill" "10"
  Invoke-AB $Session "find" "label" "TVA unique" "fill" "20"
  $js = @"
(() => {
  const selects = Array.from(document.querySelectorAll('select'));
  for (const sel of selects) {
    const opt = Array.from(sel.options).find(o => o.text.trim() === '10 EUR');
    if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      break;
    }
  }
})();
"@
  Invoke-AB $Session "eval" $js

  Invoke-AB $Session "find" "label" "Nom du role" "fill" "Ouvrier"
  Invoke-AB $Session "find" "label" "Taux horaire (EUR)" "fill" "45"
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Ajouter"

  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected "Ouvrier" -Message "Role added"

  Invoke-AB $Session "find" "role" "button" "click" "--name" "Enregistrer le parametrage"

  Write-Host "TI-146 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
