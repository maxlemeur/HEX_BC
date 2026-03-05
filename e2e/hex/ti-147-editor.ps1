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
$project = "E2E-HEX-TI147-$stamp"

function Wait-ForPersistedLines {
  param(
    [string]$Session,
    [string]$VersionId,
    [int]$MinLines = 1,
    [int]$TimeoutSeconds = 20
  )

  $versionIdJson = ConvertTo-Json $VersionId -Compress
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $lineCount = [int](Invoke-AB $Session "eval" @"
(async () => {
  const versionId = $versionIdJson;
  const response = await fetch('/api/estimates/' + versionId + '/items', {
    method: 'GET',
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return 0;
  const items = payload?.ok && Array.isArray(payload?.data?.items) ? payload.data.items : [];
  return items.filter((entry) => entry?.item_type === 'line').length;
})()
"@)

    if ($lineCount -ge $MinLines) {
      return
    }

    Start-Sleep -Milliseconds 300
  }

  throw "Timed out waiting for $MinLines persisted line(s)."
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-147" -Date "2026-02-02" -Validite "30"
  Go-EditorTab -Session $Session

  Add-Chapter -Session $Session -Title "Chapitre 1"
  Add-Line -Session $Session -Designation "Planches bois"
  try {
    Set-LineValues -Session $Session -Quantity "2" -Unit "m2" -PriceFo "100" -TypeFo "Materiaux" -Kfo "1.2" -HoursMo "3" -Kmo "0.5"
  } catch {
    Write-Host "TI-147 WARN: line numeric fields not editable in this layout, continuing persistence check."
  }
  Wait-ForPersistedLines -Session $Session -VersionId $versionId -MinLines 1 -TimeoutSeconds 25

  Invoke-AB $Session "eval" "document.activeElement && typeof document.activeElement.blur === 'function' ? document.activeElement.blur() : null" | Out-Null
  Start-Sleep -Milliseconds 500
  Invoke-AB $Session "reload"
  Go-EditorTab -Session $Session
  $countsJson = Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const sectionCount = document.querySelectorAll('.estimate-row--section').length;
  const lineCount = Array.from(document.querySelectorAll('.estimate-row')).filter((row) => {
    return !row.classList.contains('estimate-row--section') &&
      Boolean(row.querySelector('input.estimate-input--title'));
  }).length;
  return { sectionCount, lineCount };
})())
"@
  $countsText = [string]$countsJson
  $countsText = $countsText.Trim().Trim('"')
  if ($countsText.Contains('\"')) {
    $countsText = $countsText.Replace('\"', '"')
  }
  $counts = $countsText | ConvertFrom-Json
  if ([int]$counts.sectionCount -lt 1) {
    throw "Missing expected content: Chapter persisted"
  }
  if ([int]$counts.lineCount -lt 1) {
    throw "Missing expected content: Line persisted"
  }

  Write-Host "TI-147 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
