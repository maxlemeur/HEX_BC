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

  $versionIdJson = ConvertTo-Json $versionId -Compress
  $dupIdRaw = [string](Invoke-AB $Session "eval" @"
(async () => {
  const sourceId = $versionIdJson;
  const response = await fetch('/api/estimates/' + sourceId + '/duplicate', { method: 'POST' });
  const payload = await response.text();
  if (!response.ok) {
    throw new Error('Duplicate request failed: ' + response.status + ' ' + payload);
  }
  const match = payload.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (!match) {
    throw new Error('Duplicate id not found in payload: ' + payload);
  }
  return match[0];
})()
"@)
  $dupId = $dupIdRaw.Trim().Trim('"')
  if (-not $dupId) {
    throw "Duplicated version id missing."
  }
  if ($dupId -eq $versionId) {
    throw "Duplicated version id should differ from source."
  }

  Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $dupId
  $dupText = Get-PageText -Session $Session
  if ([string]::IsNullOrWhiteSpace($dupText)) {
    throw "Duplicated estimate page is empty."
  }

  Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
  $originText = Get-PageText -Session $Session
  if ([string]::IsNullOrWhiteSpace($originText)) {
    throw "Original estimate page is empty."
  }

  Write-Host "TI-149 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
