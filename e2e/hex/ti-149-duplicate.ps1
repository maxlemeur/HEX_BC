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
$project = "E2E-HEX-TI149-$stamp"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-149" -Date "2026-02-02" -Validite "30"

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates"
  $projectJson = ConvertTo-Json $project -Compress
  $js = @"
(() => {
  const rows = Array.from(document.querySelectorAll('tr'));
  const row = rows.find(r => r.innerText && r.innerText.includes($projectJson));
  if (!row) throw new Error('Project row not found');
  const btn = Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === 'Dupliquer');
  if (!btn) throw new Error('Duplicate button not found');
  btn.click();
})();
"@
  Invoke-AB $Session "eval" $js

  $dupUrl = Invoke-AB $Session "wait" "--url" "**/dashboard/estimates/**/edit**"
  $dupId = Get-VersionIdFromUrl -Url $dupUrl

  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected "V2" -Message "Duplicated version"

  $js = @"
(() => {
  const inputs = Array.from(document.querySelectorAll('input'));
  if (inputs.length < 2) throw new Error('Missing title input');
  const title = inputs[1];
  title.focus();
  title.value = 'E2E TI-149 V2';
  title.dispatchEvent(new Event('input', { bubbles: true }));
  title.dispatchEvent(new Event('change', { bubbles: true }));
})();
"@
  Invoke-AB $Session "eval" $js

  Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected "E2E TI-149" -Message "Original title intact"

  Write-Host "TI-149 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
