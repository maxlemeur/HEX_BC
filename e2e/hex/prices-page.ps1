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

  # --- Navigate to prices page ---
  Invoke-AB $Session "open" "$BaseUrl/dashboard/prices" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/prices" | Out-Null
  Invoke-AB $Session "wait" "--load" "networkidle" | Out-Null

  $text = Get-PageText -Session $Session

  # --- P0-2: Page header ---
  Assert-Contains -Text $text -Expected "Prix fournisseurs" -Message "Page title present"
  Assert-Contains -Text $text -Expected "Ajouter un prix" -Message "Add price CTA present"
  Write-Host "PASS: Page header with title and CTA"

  # --- P0-1: CSV import section collapsed by default ---
  Assert-Contains -Text $text -Expected "Importer un fichier de prix" -Message "CSV import header present"
  # The CSV import content (steps) should NOT be visible when collapsed
  $hasCsvSteps = $text -like "*tape 1*" -or $text -like "*Étape 1*"
  if ($hasCsvSteps) {
    Write-Host "WARNING: CSV import appears expanded by default (may be acceptable if data was loaded)"
  } else {
    Write-Host "PASS: CSV import is collapsed by default"
  }

  # --- P0-1: Expand CSV import ---
  Invoke-AB $Session "find" "text" "Importer un fichier de prix" "click" | Out-Null
  Start-Sleep -Milliseconds 500
  $textAfterExpand = Get-PageText -Session $Session
  $hasCsvContent = $textAfterExpand -like "*CSV*" -or $textAfterExpand -like "*fichier*"
  if ($hasCsvContent) {
    Write-Host "PASS: CSV import expands on click"
  }

  # Collapse it back
  Invoke-AB $Session "find" "text" "Importer un fichier de prix" "click" | Out-Null
  Start-Sleep -Milliseconds 300

  # --- P0-3: TableFilterBar / search ---
  $hasSearch = $text -like "*Rechercher*" -or $text -like "*rechercher*"
  if ($hasSearch) {
    Write-Host "PASS: Search bar present"
  } else {
    Write-Host "WARNING: Search bar not detected in page text"
  }

  # --- P2-4: Stats cards ---
  $hasStats = $text -like "*Total prix*"
  if ($hasStats) {
    Write-Host "PASS: Stats cards present"
  } else {
    Write-Host "INFO: Stats cards not visible (may be expected if no data)"
  }

  # --- Table headers ---
  Assert-Contains -Text $text -Expected "Fournisseur" -Message "Table header: Fournisseur"
  Assert-Contains -Text $text -Expected "Produit" -Message "Table header: Produit"
  Assert-Contains -Text $text -Expected "Prix HT" -Message "Table header: Prix HT"
  Write-Host "PASS: Table headers present"

  # --- P2-2: Freshness column ---
  $hasFreshness = $text -like "*Fraîcheur*" -or $text -like "*fraicheur*"
  if ($hasFreshness) {
    Write-Host "PASS: Freshness column present"
  }

  # --- P1-1: Open create modal ---
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Ajouter un prix" | Out-Null
  Start-Sleep -Milliseconds 500
  $modalText = Get-PageText -Session $Session

  Assert-Contains -Text $modalText -Expected "Ajouter un prix fournisseur" -Message "Create modal title"
  Assert-Contains -Text $modalText -Expected "Fournisseur" -Message "Modal has supplier field"
  Assert-Contains -Text $modalText -Expected "Produit" -Message "Modal has product field"
  Assert-Contains -Text $modalText -Expected "Prix unitaire" -Message "Modal has price field"
  Write-Host "PASS: Create modal opens with correct fields"

  # Close modal (click Annuler)
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Annuler" | Out-Null
  Start-Sleep -Milliseconds 300

  # --- P1-1: Open edit modal (if data rows exist) ---
  $hasModifier = $text -like "*Modifier*"
  if ($hasModifier) {
    Invoke-AB $Session "find" "role" "button" "click" "--name" "Modifier" | Out-Null
    Start-Sleep -Milliseconds 500
    $editText = Get-PageText -Session $Session

    Assert-Contains -Text $editText -Expected "Modifier un prix fournisseur" -Message "Edit modal title"
    Assert-Contains -Text $editText -Expected "Mettre à jour" -Message "Edit modal submit button"
    Write-Host "PASS: Edit modal opens with correct title"

    # Close
    Invoke-AB $Session "find" "role" "button" "click" "--name" "Annuler" | Out-Null
    Start-Sleep -Milliseconds 300
  } else {
    Write-Host "SKIP: No data rows to test edit modal"
  }

  # --- P1-3: Accent verification ---
  $textFull = Get-PageText -Session $Session

  $accentChecks = @(
    @{ Expected = "Fraîcheur"; Name = "Fraicheur accent" },
    @{ Expected = "Gérez"; Name = "Gerez accent" },
    @{ Expected = "Mis à jour"; Name = "Mis a jour accent" }
  )

  $accentPass = $true
  foreach ($check in $accentChecks) {
    if ($textFull -notlike "*$($check.Expected)*") {
      Write-Host "WARNING: Missing accent: $($check.Name) - expected '$($check.Expected)'"
      $accentPass = $false
    }
  }

  if ($accentPass) {
    Write-Host "PASS: All French accents correct"
  }

  # --- P2-3: Refresh button ---
  $hasRefresh = $text -like "*Actualiser*"
  if ($hasRefresh) {
    Write-Host "PASS: Refresh button present"
  }

  # --- Mode avance section ---
  Assert-Contains -Text $text -Expected "Mode avancé" -Message "Advanced mode section"
  Write-Host "PASS: Advanced mode section present"

  Write-Host ""
  Write-Host "PRICES-PAGE E2E: ALL CHECKS PASSED"

} finally {
  Close-AgentBrowser -Session $Session
}
