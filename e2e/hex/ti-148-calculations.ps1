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
$project = "E2E-HEX-TI148-$stamp"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-148" -Date "2026-02-02" -Validite "30" | Out-Null
  Go-EditorTab -Session $Session
  Add-Chapter -Session $Session -Title "Chapitre 1"
  Add-Line -Session $Session -Designation "Planches bois"
  Set-LineValues -Session $Session -Quantity "2" -Unit "m2" -PriceFo "100" -TypeFo "Materiaux" -Kfo "1.2" -HoursMo "3" -Kmo "0.5"

  Go-ParamsTab -Session $Session
  Invoke-AB $Session "find" "label" "Marge (multiplicateur)" "fill" "1.2"
  Invoke-AB $Session "find" "label" "Remise (EUR HT)" "fill" "10"
  Invoke-AB $Session "find" "label" "TVA unique" "fill" "20"

  $text = Get-PageText -Session $Session
  if ($text -match "Total TTC\s*([0-9]+,[0-9]{2})") {
    if ($Matches[1] -eq "0,00") {
      throw "Total TTC should not be zero"
    }
  } else {
    throw "Total TTC not found"
  }

  Write-Host "TI-148 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
