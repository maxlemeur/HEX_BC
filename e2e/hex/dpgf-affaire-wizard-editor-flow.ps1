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
$projectName = "E2E-HEX-DPGF-PARCOURS-$stamp"
$versionTitle = "E2E DPGF Source $stamp"
$fixturePath = Resolve-E2EPath -Path "e2e/fixtures/dpgf-minimal.csv"

if (-not (Test-Path $fixturePath)) {
  throw "Fixture file not found: $fixturePath"
}

function Test-VisibleButtonContains {
  param(
    [string]$Session,
    [string]$Needle
  )

  $needleJson = ConvertTo-Json $Needle.ToLowerInvariant() -Compress
  $raw = Invoke-AB $Session "eval" @"
(() => {
  const needle = $needleJson;
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();
  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden") return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  };
  return Array.from(document.querySelectorAll("button")).some((button) => {
    if (!isVisible(button)) return false;
    const text = normalize(button.textContent);
    return text.includes(needle);
  });
})();
"@

  return ($raw -eq $true -or "$raw" -eq "true")
}

function Try-ClickAnyActionContains {
  param(
    [string]$Session,
    [string[]]$Labels,
    [string]$ScopeSelector = ""
  )

  $labelsJson = ConvertTo-Json $Labels -Compress
  $scopeSelectorJson = ConvertTo-Json $ScopeSelector -Compress

  $rawClicked = Invoke-AB $Session "eval" @"
(() => {
  const labels = $labelsJson
    .map((label) =>
      String(label ?? "")
        .normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
  const scopeSelector = $scopeSelectorJson;
  const root = scopeSelector ? (document.querySelector(scopeSelector) ?? document) : document;
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();
  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden") return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  };

  const candidates = Array.from(root.querySelectorAll("button, a, [role='button']")).filter((el) => {
    if (!isVisible(el)) return false;
    if (el instanceof HTMLButtonElement && el.disabled) return false;
    const text = normalize(el.textContent);
    return labels.some((label) => text.includes(label));
  });

  if (candidates.length === 0) return "";
  const target = candidates[candidates.length - 1];
  const text = normalize(target.textContent);
  target.click();
  return text;
})();
"@

  $clicked = Normalize-AgentString -Raw ([string]$rawClicked)
  if ([string]::IsNullOrWhiteSpace($clicked)) {
    return $null
  }

  return $clicked
}

function Click-ActionContainsWithRetry {
  param(
    [string]$Session,
    [string[]]$Labels,
    [string]$ScopeSelector = "",
    [int]$TimeoutSeconds = 20,
    [string]$FailureMessage = "Unable to click target action."
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $clicked = Try-ClickAnyActionContains -Session $Session -Labels $Labels -ScopeSelector $ScopeSelector
    if ($clicked) {
      return $clicked
    }

    foreach ($label in $Labels) {
      if ([string]::IsNullOrWhiteSpace($label)) {
        continue
      }

      try {
        Invoke-AB $Session "find" "text" $label "click" | Out-Null
        return $label
      } catch {
        continue
      }
    }

    Start-Sleep -Milliseconds 350
  }

  throw $FailureMessage
}

function Get-WizardStep3State {
  param([string]$Session)

  $raw = Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();

  const findButton = (needle) =>
    Array.from(document.querySelectorAll("button")).find((button) =>
      normalize(button.textContent).includes(needle)
    ) ?? null;

  const mainText = normalize(document.querySelector("main")?.innerText ?? "");
  const sourceBtn = findButton("dpgf source a importer");
  const blankBtn = findButton("nouveau (vide)");
  const templateBtn = findButton("depuis un modele");

  return {
    hasSourceDetected: mainText.includes("source detectee"),
    hasSourceSummary: mainText.includes("la version sera creee avec les lignes du dpgf source lie"),
    sourceModeSelected:
      sourceBtn instanceof HTMLButtonElement &&
      sourceBtn.className.includes("btn-primary"),
    templateUnavailable: mainText.includes("aucun modele disponible actuellement"),
    templateDisabled:
      templateBtn instanceof HTMLButtonElement ? Boolean(templateBtn.disabled) : false,
    blankSelected:
      blankBtn instanceof HTMLButtonElement &&
      blankBtn.className.includes("btn-primary")
  };
})())
"@

  $jsonText = Normalize-AgentString -Raw ([string]$raw)
  return $jsonText | ConvertFrom-Json
}

function Try-AutoMapColumnsFromSourceNames {
  param([string]$Session)

  $raw = Invoke-AB $Session "eval" @"
(() => {
  const table = document.querySelector("table.data-table");
  if (!table) return 0;

  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();

  const plans = [
    { target: "hex_code", hints: ["hex_code", "reference article", "reference", "code"] },
    { target: "designation", hints: ["designation", "description", "libelle"] },
    { target: "quantity", hints: ["quantity", "quantite", "qte", "qty"] },
    { target: "unit", hints: ["unit", "unite"] },
    { target: "unit_price_ht", hints: ["unit_price_ht", "prix unitaire", "pu ht", "prix ht"] },
    { target: "total_ht", hints: ["total_ht", "montant ht", "total ht"] }
  ];

  let changed = 0;
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  for (const row of rows) {
    const sourceCell = row.querySelector("td");
    const sourceText = normalize(sourceCell?.textContent ?? "");
    if (!sourceText) continue;

    const select = row.querySelector("select");
    if (!(select instanceof HTMLSelectElement) || select.disabled) continue;

    for (const plan of plans) {
      const hintMatch = plan.hints.some((hint) => sourceText.includes(hint));
      if (!hintMatch) continue;

      const hasOption = Array.from(select.options).some((option) => option.value === plan.target);
      if (!hasOption) continue;
      if (select.value === plan.target) break;

      select.value = plan.target;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      changed += 1;
      break;
    }
  }

  return changed;
})();
"@

  $changed = 0
  try {
    $changed = [int]$raw
  } catch {
    $changed = 0
  }
  return $changed
}

function Get-ImportFlowDebugState {
  param([string]$Session)

  $raw = Invoke-AB $Session "eval" @"
JSON.stringify((() => {
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/\\s+/g, " ")
      .trim();
  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden") return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  };
  const buttons = Array.from(document.querySelectorAll("button"))
    .filter((button) => isVisible(button))
    .map((button) => normalize(button.textContent))
    .filter((text) => text.length > 0)
    .slice(0, 40);
  const heading = normalize(document.querySelector("main h1, main h2, main h3")?.textContent ?? "");
  const alertError = normalize(document.querySelector(".alert.alert-error")?.textContent ?? "");
  return {
    url: window.location.pathname + window.location.search,
    heading,
    hasMappingTable: Boolean(document.querySelector("table.data-table")),
    hasFileInput: Boolean(document.querySelector("input[type='file']")),
    hasCreateButton: buttons.some((text) => text.toLowerCase().includes("creer le chiffrage")),
    hasReturnHubButton: buttons.some((text) => text.toLowerCase().includes("retour au hub")),
    buttons,
    alertError
  };
})())
"@

  try {
    $jsonString = ConvertFrom-AgentBrowserJson -RawOutput $raw
    return ($jsonString | ConvertFrom-Json)
  } catch {
    return $null
  }
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  # ------------------------------------------------------------------
  # Step 1: Create an empty affaire from quick create dialog
  # ------------------------------------------------------------------
  Invoke-AB $Session "open" "$BaseUrl/dashboard/affaires" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/affaires" -TimeoutSeconds 45 | Out-Null

  $clickedNewAffaire = Click-ActionContainsWithRetry -Session $Session -Labels @(
    "Nouvelle affaire",
    "nouvelle affaire"
  ) -ScopeSelector "" -TimeoutSeconds 25 -FailureMessage "Unable to open quick create affaire dialog."

  Wait-ForSelector -Session $Session -Selector "input[placeholder='Ex: Residence Les Jardins']" -TimeoutSeconds 20
  Invoke-AB $Session "fill" "input[placeholder='Ex: Residence Les Jardins']" $projectName | Out-Null

  Wait-ForButtonEnabledByText -Session $Session -ButtonText "Creer l'affaire" -ScopeSelector "main" -TimeoutSeconds 20
  Click-FirstEnabledButtonByText -Session $Session -ButtonText "Creer l'affaire" -ScopeSelector "main"

  $hubUrl = Wait-ForUrlRegex -Session $Session -Pattern "/dashboard/affaires/[0-9a-fA-F-]{36}" -TimeoutSeconds 90
  if ($hubUrl -notmatch "/dashboard/affaires/([0-9a-fA-F-]{36})") {
    throw "Unable to parse project id from hub URL: $hubUrl"
  }
  $projectId = $Matches[1].ToLowerInvariant()

  # ------------------------------------------------------------------
  # Step 2: Attach and map a DPGF source via UnifiedImportFlow
  # ------------------------------------------------------------------
  $clickedImportDpgf = Click-ActionContainsWithRetry -Session $Session -Labels @(
    "Importer un DPGF",
    "importer un dpgf"
  ) -ScopeSelector "main" -TimeoutSeconds 20 -FailureMessage "Unable to open unified DPGF import flow from affaire hub."

  Wait-ForSelector -Session $Session -Selector "input[type='file']" -TimeoutSeconds 30
  Invoke-AB $Session "upload" "input[type='file']" $fixturePath | Out-Null

  Wait-ForButtonEnabledByText -Session $Session -ButtonText "Lancer l'import" -ScopeSelector "main" -TimeoutSeconds 20
  Click-FirstEnabledButtonByText -Session $Session -ButtonText "Lancer l'import" -ScopeSelector "main"

  $importDeadline = (Get-Date).AddSeconds(300)
  $reachedConfirmation = $false
  $lastFlowState = $null
  while ((Get-Date) -lt $importDeadline) {
    $lastFlowState = Get-ImportFlowDebugState -Session $Session

    $mappedChanges = Try-AutoMapColumnsFromSourceNames -Session $Session
    if ($mappedChanges -gt 0) {
      Start-Sleep -Milliseconds 500
    }

    $clickedToPreview = Try-ClickAnyActionContains -Session $Session -Labels @(
      "suivant : aperçu",
      "suivant: aperçu",
      "suivant : apercu",
      "suivant: apercu"
    ) -ScopeSelector "main"
    if ($clickedToPreview) {
      Start-Sleep -Milliseconds 800
      continue
    }

    $clickedToConfirmation = Try-ClickAnyActionContains -Session $Session -Labels @(
      "suivant : confirmation",
      "suivant: confirmation"
    ) -ScopeSelector "main"
    if ($clickedToConfirmation) {
      Start-Sleep -Milliseconds 800
      continue
    }

    $hasReturnToHub = Test-VisibleButtonContains -Session $Session -Needle "retour au hub"
    if ($hasReturnToHub) {
      $reachedConfirmation = $true
      break
    }

    $confirmError = Normalize-AgentString -Raw ([string](Invoke-AB $Session "eval" @"
(() => {
  const alert = document.querySelector('.alert.alert-error');
  return alert ? String(alert.textContent ?? '').trim() : '';
})()
"@))
    if ($confirmError) {
      throw "Unified import flow failed: $confirmError"
    }

    Start-Sleep -Milliseconds 600
  }

  if (-not $reachedConfirmation) {
    $debugSummary = ""
    if ($lastFlowState) {
      $buttonsSummary = if ($lastFlowState.buttons) { [string]::Join(" || ", $lastFlowState.buttons) } else { "" }
      $debugSummary =
        " url=$($lastFlowState.url); heading=$($lastFlowState.heading); hasMappingTable=$($lastFlowState.hasMappingTable); " +
        "hasFileInput=$($lastFlowState.hasFileInput); hasCreateButton=$($lastFlowState.hasCreateButton); " +
        "hasReturnHubButton=$($lastFlowState.hasReturnHubButton); alertError=$($lastFlowState.alertError); buttons=$buttonsSummary"
    }
    throw "Timeout while progressing import flow to confirmation step.$debugSummary"
  }

  $clickedReturnToHub = Click-ActionContainsWithRetry -Session $Session -Labels @(
    "Retour au hub",
    "retour au hub"
  ) -ScopeSelector "main" -TimeoutSeconds 20 -FailureMessage "Unable to confirm mapping-only mode (Retour au hub)."

  Wait-ForUrlContains -Session $Session -Needle "/dashboard/affaires/$projectId" -TimeoutSeconds 90 | Out-Null
  $hubText = Get-PageText -Session $Session
  Assert-Contains -Text $hubText -Expected "dpgf-minimal.csv" -Message "Linked DPGF filename should be visible on hub"
  Assert-Contains -Text $hubText -Expected "Import:" -Message "DPGF import status badge should be visible on hub"

  # ------------------------------------------------------------------
  # Step 3: Create a new version from affaire hub and validate wizard UX
  # ------------------------------------------------------------------
  $clickedCreateVersion = Click-ActionContainsWithRetry -Session $Session -Labels @(
    "Creer une premiere version",
    "Créer une premiere version",
    "creer une premiere version",
    "creer une version"
  ) -ScopeSelector "main" -TimeoutSeconds 20 -FailureMessage "Unable to open estimate creation wizard from affaire hub."

  $wizardUrl = Wait-ForUrlContains -Session $Session -Needle "/dashboard/estimates/new" -TimeoutSeconds 45
  if ($wizardUrl -notlike "*projectId=$projectId*") {
    throw "Wizard URL should include projectId query parameter. URL: $wizardUrl"
  }

  Wait-ForSelector -Session $Session -Selector "#wiz-title" -TimeoutSeconds 20
  Invoke-AB $Session "fill" "#wiz-title" $versionTitle | Out-Null
  Wait-ForButtonEnabledByText -Session $Session -ButtonText "Suivant" -ScopeSelector "main" -TimeoutSeconds 20
  Click-FirstEnabledButtonByText -Session $Session -ButtonText "Suivant" -ScopeSelector "main"

  Wait-ForSelector -Session $Session -Selector "#wiz-date-devis" -TimeoutSeconds 20
  Invoke-AB $Session "fill" "#wiz-date-devis" "2026-03-05" | Out-Null
  Invoke-AB $Session "fill" "#wiz-validite" "30" | Out-Null
  Wait-ForButtonEnabledByText -Session $Session -ButtonText "Suivant" -ScopeSelector "main" -TimeoutSeconds 20
  Click-FirstEnabledButtonByText -Session $Session -ButtonText "Suivant" -ScopeSelector "main"

  $wizardState = Get-WizardStep3State -Session $Session
  if (-not $wizardState.hasSourceDetected) {
    throw "Wizard step 3 should detect linked DPGF source."
  }
  if (-not $wizardState.hasSourceSummary) {
    throw "Wizard step 3 should announce linked DPGF source import at creation."
  }
  if (-not $wizardState.sourceModeSelected) {
    throw "Wizard step 3 should pre-select linked DPGF source mode."
  }

  if ($wizardState.templateUnavailable) {
    if (-not $wizardState.templateDisabled) {
      throw "Template mode should be disabled when no template is available."
    }
    if (-not $wizardState.blankSelected) {
      throw "Blank mode should be selected by default when templates are unavailable."
    }
  }

  Wait-ForButtonEnabledByText -Session $Session -ButtonText "Creer le chiffrage" -ScopeSelector "main" -TimeoutSeconds 20
  Click-FirstEnabledButtonByText -Session $Session -ButtonText "Creer le chiffrage" -ScopeSelector "main"

  # ------------------------------------------------------------------
  # Step 4: Validate editor prefill and source import affordance
  # ------------------------------------------------------------------
  $editUrl = Wait-ForUrlRegex -Session $Session -Pattern "/dashboard/estimates/[^/]+/edit" -TimeoutSeconds 90
  if (-not $editUrl) {
    throw "Missing estimate edit URL after wizard creation."
  }

  Wait-ForEditorSurface -Session $Session -TimeoutSeconds 60
  $lineCount = Get-LineRowCount -Session $Session
  if ($lineCount -le 0) {
    throw "Expected editor to be prefilled from linked DPGF source, but line count is 0."
  }

  $hasSourceImportButton = Test-VisibleButtonContains -Session $Session -Needle "importer le dpgf source"
  if (-not $hasSourceImportButton) {
    throw "Editor should expose 'Importer le DPGF source' action when linked source exists."
  }

  Write-Host "DPGF-AFFAIRE-WIZARD-EDITOR PASS ($lineCount lignes importees)"
} finally {
  Close-AgentBrowser -Session $Session
}
