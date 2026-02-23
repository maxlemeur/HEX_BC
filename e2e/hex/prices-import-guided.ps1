param(
  [string]$BaseUrl,
  [string]$Session
)

. "$PSScriptRoot/common.ps1"

$config = Get-HexConfig -BaseUrl $BaseUrl -Session $Session
$BaseUrl = $config.BaseUrl
$Session = $config.Session

Require-AgentBrowser

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  Invoke-AB $Session "open" "$BaseUrl/dashboard/prices" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/prices" | Out-Null
  Invoke-AB $Session "wait" "--load" "networkidle" | Out-Null

  Invoke-AB $Session "find" "text" "Importer un fichier de prix" "click" | Out-Null
  Start-Sleep -Milliseconds 400

  $csvPath = Resolve-E2EPath -Path "docs/prd_file/MM_BDC_V1.2.csv"
  $csvContent = Get-Content -Raw -Path $csvPath
  $csvJson = ConvertTo-Json $csvContent -Compress

  $attachScript = @"
(() => {
  const input = document.querySelector('#price-book-csv-input');
  if (!input) return 'NO_INPUT';
  const csv = $csvJson;
  const file = new File([csv], 'MM_BDC_V1.2.csv', { type: 'text/csv' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()
"@

  $attachResult = Invoke-AB $Session "eval" $attachScript
  if ($attachResult -notlike "*OK*") {
    throw "Unable to attach CSV file to import input."
  }

  Invoke-AB $Session "find" "role" "button" "click" "--name" "Analyser" | Out-Null
  Start-Sleep -Seconds 3

  $text = Get-PageText -Session $Session
  Assert-Contains -Text $text -Expected "Format BDC detecte" -Message "BDC profile detected"
  Assert-Contains -Text $text -Expected "Importer les lignes pretes" -Message "Guided import action visible"
  Assert-Contains -Text $text -Expected "Ignorees" -Message "Ignored rows summary visible"
  Write-Host "PASS: Guided import with MM_BDC_V1.2.csv works end-to-end"
} finally {
  Close-AgentBrowser -Session $Session
}
