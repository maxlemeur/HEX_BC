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
$projectA = "E2E-HEX-TI144-A-$stamp"
$projectB = "E2E-HEX-TI144-B-$stamp"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $projectA -Title "E2E TI-144 A" -Date "2026-02-02" -Validite "30" | Out-Null
  New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $projectB -Title "E2E TI-144 B" -Date "2026-02-02" -Validite "30" | Out-Null

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates" | Out-Null
  $deadline = (Get-Date).AddSeconds(20)
  $text = ""
  while ((Get-Date) -lt $deadline) {
    $text = Get-PageText -Session $Session
    if ($text -like "*$projectA*" -and $text -like "*$projectB*") {
      break
    }
    Start-Sleep -Milliseconds 400
  }

  Assert-Contains -Text $text -Expected $projectA -Message "List contains project A"
  Assert-Contains -Text $text -Expected $projectB -Message "List contains project B"
  Assert-Contains -Text $text -Expected "Ouvrir" -Message "Open action"
  Assert-Contains -Text $text -Expected "Dupliquer" -Message "Duplicate action"
  if ($text -notlike "*Print*" -and $text -notlike "*Imprimer*") {
    throw "Missing expected content: Print action"
  }

  Write-Host "TI-144 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
