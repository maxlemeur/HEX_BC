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

# Editor section/line titles live in input values, which main.innerText does not expose.
function Wait-ForEditorValueContains {
  param(
    [string]$Session,
    [string]$Expected,
    [string]$Message,
    [int]$TimeoutSeconds = 30
  )

  $expectedJson = ConvertTo-Json $Expected -Compress
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $found = Invoke-AB $Session "eval" @"
(() => {
  const expected = $expectedJson;
  const root = document.querySelector('main') ?? document.body;
  if (String(root.innerText ?? '').includes(expected)) return true;
  return Array.from(root.querySelectorAll('input, textarea')).some((field) =>
    String(field.value ?? '').includes(expected)
  );
})();
"@
    if ($found -eq $true -or "$found" -eq "true") {
      return
    }

    Start-Sleep -Milliseconds 700
  }

  throw "Missing expected content: $Message"
}

function Open-AssemblyPicker {
  param([string]$Session)

  # The picker now opens from the ribbon: "Inserer" tab > "Inserer" menu > "Ajouter un ouvrage".
  Wait-ForSelector -Session $Session -Selector "#estimate-ribbon-panel-insertion-tab" -TimeoutSeconds 20
  Invoke-AB $Session "click" "#estimate-ribbon-panel-insertion-tab" | Out-Null
  Wait-ForSelector -Session $Session -Selector "[data-testid='estimate-editor-insert-button']" -TimeoutSeconds 10
  Invoke-AB $Session "click" "[data-testid='estimate-editor-insert-button']" | Out-Null
  Wait-ForSelector -Session $Session -Selector "[data-testid='estimate-editor-assemblies-button']" -TimeoutSeconds 10
  Invoke-AB $Session "click" "[data-testid='estimate-editor-assemblies-button']" | Out-Null
  Wait-ForSelector -Session $Session -Selector "#assembly-picker-search" -TimeoutSeconds 20
}

function New-EstimateWithRetry {
  param(
    [string]$BaseUrl,
    [string]$Session,
    [string]$Project,
    [string]$Title,
    [string]$Date,
    [string]$Validité
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
        -Validité $Validité)

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
  const buttons = Array.from(document.querySelectorAll('[role="dialog"] button'));
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
    -Validité "30"

  Invoke-AB $Session "open" "$BaseUrl/dashboard/estimates/assemblies"
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Nouvel ouvrage"
  Invoke-AB $Session "fill" "#assembly-name" $assemblyName
  Invoke-AB $Session "fill" "#assembly-item-0-title-input" $lineTitle
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Enregistrer" "--exact"

  Wait-ForMainTextContains `
    -Session $Session `
    -Expected "Ouvrage cr??." `
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

  Open-AssemblyPicker -Session $Session
  Invoke-AB $Session "fill" "#assembly-picker-search" $assemblyName | Out-Null
  Select-AssemblyFromDrawer -Session $Session -AssemblyName $assemblyName
  # Former "Inserer dans l'editeur": the picker's primary action is now
  # "Ajouter <<nom>> - <prix>" (AssemblyPicker.tsx), enabled once an assembly is selected.
  $assemblyNameJson = ConvertTo-Json $assemblyName -Compress
  $insertDeadline = (Get-Date).AddSeconds(20)
  $insertClicked = $false
  while ((Get-Date) -lt $insertDeadline -and -not $insertClicked) {
    $insertResult = [string](Invoke-AB $Session "eval" @"
(() => {
  const name = $assemblyNameJson;
  const button = Array.from(document.querySelectorAll('[role="dialog"] button')).find((candidate) => {
    const text = String(candidate.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text.startsWith('Ajouter ') && text.includes(name) && !candidate.disabled;
  });
  if (!button) return 'missing';
  button.click();
  return 'clicked';
})();
"@)
    if ($insertResult -like "*clicked*") {
      $insertClicked = $true
    } else {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $insertClicked) {
    throw "Assembly insert button not found in picker"
  }

  Wait-ForEditorValueContains `
    -Session $Session `
    -Expected $assemblyName `
    -Message "inserted section" `
    -TimeoutSeconds 35
  Wait-ForEditorValueContains `
    -Session $Session `
    -Expected $lineTitle `
    -Message "inserted line" `
    -TimeoutSeconds 35

  Write-Host "TI-182 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
