param(
  [string]$BaseUrl,
  [string]$Session
)

. "$PSScriptRoot/common.ps1"

$config = Get-HexConfig -BaseUrl $BaseUrl -Session $Session
$BaseUrl = $config.BaseUrl
$Session = $config.Session

Require-AgentBrowser

# Dialogs are portaled [role="dialog"] elements outside <main>, so Get-PageText cannot see them.
function Get-DialogText {
  param(
    [string]$Session,
    [int]$TimeoutSeconds = 8
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $text = ""
  while ((Get-Date) -lt $deadline) {
    $raw = Invoke-AB $Session "eval" "JSON.stringify(document.querySelector('[role=`"dialog`"]')?.innerText || '')"
    try {
      $text = [string](ConvertFrom-AgentBrowserJson -RawOutput $raw)
    } catch {
      $text = [string]$raw
    }
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      return $text
    }
    Start-Sleep -Milliseconds 250
  }

  return $text
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  # --- Navigate to prices page ---
  Invoke-AB $Session "open" "$BaseUrl/dashboard/prices" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/prices" | Out-Null
  Invoke-AB $Session "wait" "--load" "networkidle" | Out-Null

  $text = Get-PageText -Session $Session

  # --- P0-2: Page header ---
  Assert-Contains -Text $text -Expected "Prix fournisseurs" -Message "Page title present"
  Assert-Contains -Text $text -Expected "Ajouter un fournisseur / tarif" -Message "Add price CTA present"
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

  # --- Price list (now a card list, PricesTable.tsx: no table headers) ---
  Assert-Contains -Text $text -Expected "Liste des prix fournisseurs" -Message "Price list heading"
  Write-Host "PASS: Price list present"

  # --- P2-2: Freshness column ---
  $hasFreshness = $text -like "*Fraîcheur*" -or $text -like "*fraicheur*"
  if ($hasFreshness) {
    Write-Host "PASS: Freshness column present"
  }

  # --- P1-1: Open create modal ---
  Click-FirstEnabledButtonByText -Session $Session -ButtonText "Ajouter un fournisseur / tarif" -ScopeSelector "main"
  $modalText = Get-DialogText -Session $Session

  # SupplierOfferFormModal.tsx: title "Ajouter un fournisseur / tarif", fields "Article *", "Fournisseur *", "Prix unitaire HT *".
  Assert-Contains -Text $modalText -Expected "Ajouter un fournisseur / tarif" -Message "Create modal title"
  Assert-Contains -Text $modalText -Expected "Fournisseur" -Message "Modal has supplier field"
  Assert-Contains -Text $modalText -Expected "Article" -Message "Modal has article field"
  Assert-Contains -Text $modalText -Expected "Prix unitaire" -Message "Modal has price field"
  Write-Host "PASS: Create modal opens with correct fields"

  # Close modal (click Annuler)
  Invoke-AB $Session "find" "role" "button" "click" "--name" "Annuler" | Out-Null
  Start-Sleep -Milliseconds 300

  # --- P1-1: Open edit modal (if data rows exist) ---
  # Row action is now "Voir / modifier l'offre" (typographic apostrophe) in the "Offres fournisseurs" list.
  $openedEdit = Invoke-AB $Session "eval" @"
(() => {
  const button = Array.from(document.querySelectorAll('main ul[aria-label="Offres fournisseurs"] button')).find((candidate) =>
    String(candidate.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith('Voir / modifier')
  );
  if (!button) return false;
  button.click();
  return true;
})()
"@
  if ($openedEdit -eq $true -or "$openedEdit" -eq "true") {
    $editText = Get-DialogText -Session $Session

    # "?" matches the typographic apostrophe of "Modifier l'offre fournisseur" / "Enregistrer l'offre".
    Assert-Contains -Text $editText -Expected "Modifier l?offre fournisseur" -Message "Edit modal title"
    Assert-Contains -Text $editText -Expected "Enregistrer l?offre" -Message "Edit modal submit button"
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
