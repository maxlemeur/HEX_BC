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
$project = "E2E-HEX-TI182-$stamp"
$assemblyName = "Ouvrage E2E $stamp"
$lineTitle = "Ligne Ouvrage $stamp"

function Wait-ForMainTextContains {
  param(
    [string]$Session,
    [string]$Expected,
    [string]$Message,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $attempt = 0

  while ((Get-Date) -lt $deadline) {
    $attempt += 1
    $text = Get-PageText -Session $Session
    if ($text -like "*$Expected*") {
      return
    }

    Start-Sleep -Milliseconds 700
  }

  throw "Missing expected content: $Message"
}

function New-EstimateWithRetry {
  param(
    [string]$BaseUrl,
    [string]$Session,
    [string]$Project,
    [string]$Title,
    [string]$Date,
    [string]$Validite
  )

  for ($attempt = 1; $attempt -le 2; $attempt++) {
    try {
      $projectName = if ($attempt -eq 1) { $Project } else { "$Project-retry$attempt" }
      $result = @(New-Estimate `
        -BaseUrl $BaseUrl `
        -Session $Session `
        -Project $projectName `
        -Title $Title `
        -Date $Date `
        -Validite $Validite)

      $versionId = $null
      foreach ($entry in $result) {
        $entryText = [string]$entry
        if ($entryText -match "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}") {
          $versionId = $Matches[0]
        }
      }

      if (-not $versionId) {
        throw "Unable to parse version id from New-Estimate output."
      }

      return $versionId
    } catch {
      if ($attempt -ge 2) {
        throw
      }
      Start-Sleep -Seconds 2
    }
  }
}

function Select-AssemblyFromDrawer {
  param(
    [string]$Session,
    [string]$AssemblyName,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $assemblyJson = ConvertTo-Json $AssemblyName -Compress
  $jsSelectAssembly = @"
(() => {
  const buttons = Array.from(document.querySelectorAll('aside button'));
  const item = buttons.find(btn => btn.innerText && btn.innerText.includes($assemblyJson));
  if (!item) return 'missing';
  item.click();
  return 'clicked';
})();
"@

  while ((Get-Date) -lt $deadline) {
    $result = [string](Invoke-AB $Session "eval" $jsSelectAssembly)
    if ($result -like "*clicked*") {
      return
    }
    Start-Sleep -Milliseconds 600
  }

  throw "Assembly option not found in drawer"
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-EstimateWithRetry `
    -BaseUrl $BaseUrl `
    -Session $Session `
    -Project $project `
    -Title "E2E TI-182" `
    -Date "2026-02-21" `
    -Validite "30"

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates/assemblies"
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Nouvel ouvrage"
  Invoke-AB $Session "fill" "#assembly-name" $assemblyName
  Invoke-AB $Session "fill" "[role='dialog'] tbody tr td:nth-child(1) input" $lineTitle
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Enregistrer"

  Wait-ForMainTextContains `
    -Session $Session `
    -Expected "Ouvrage cree." `
    -Message "assembly create success message" `
    -TimeoutSeconds 25

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates/assemblies"
  Invoke-AB $Session "fill" "#assembly-search" $assemblyName
  Wait-ForMainTextContains `
    -Session $Session `
    -Expected $assemblyName `
    -Message "assembly created" `
    -TimeoutSeconds 30

  Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
  Go-EditorTab -Session $Session

  Invoke-AB $Session "find" "role" "button" "click" "--name" "Ouvrages"
  Select-AssemblyFromDrawer -Session $Session -AssemblyName $assemblyName
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Inserer dans l'editeur"

  Wait-ForMainTextContains `
    -Session $Session `
    -Expected $assemblyName `
    -Message "inserted section" `
    -TimeoutSeconds 35
  Wait-ForMainTextContains `
    -Session $Session `
    -Expected $lineTitle `
    -Message "inserted line" `
    -TimeoutSeconds 35

  Write-Host "TI-182 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
