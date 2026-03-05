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

function Get-LinkedDpgfSourceApiState {
  param(
    [string]$Session,
    [string]$ProjectId
  )

  $raw = Invoke-AB $Session "eval" @"
(async () => {
  const projectId = "$ProjectId";
  try {
    const response = await fetch("/api/affaires/" + projectId + "/dpgf-source", {
      credentials: "include",
      headers: {
        "Accept": "application/json"
      }
    });
    const payload = await response.json().catch(() => null);
    return JSON.stringify({
      status: response.status,
      ok: response.ok,
      payload
    });
  } catch (error) {
    return JSON.stringify({
      status: 0,
      ok: false,
      payload: null,
      error: String(error)
    });
  }
})()
"@

  try {
    $jsonString = ConvertFrom-AgentBrowserJson -RawOutput $raw
    return ($jsonString | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Seed-LinkedDpgfSourceViaApi {
  param(
    [string]$Session,
    [string]$ProjectId
  )

  $raw = Invoke-AB $Session "eval" @"
(async () => {
  const projectId = "$ProjectId";
  const rows = [
    {
      source_hex: "HEX-001",
      source_designation: "Poste test A",
      source_quantity: 2,
      source_unit: "u",
      source_unit_price_ht: 150,
      source_total_ht: 300
    },
    {
      source_hex: "HEX-002",
      source_designation: "Poste test B",
      source_quantity: 1,
      source_unit: "u",
      source_unit_price_ht: 90,
      source_total_ht: 90
    }
  ];

  try {
    const importRes = await fetch("/api/imports", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        filename: "e2e-linked-dpgf.json",
        sourceFormat: "csv",
        projectId,
        rows
      })
    });

    const importPayload = await importRes.json().catch(() => null);
    const importData = importPayload?.data ?? null;
    const importId = importData?.id ?? null;

    if (!importRes.ok || !importPayload?.ok || !importId) {
      return JSON.stringify({
        ok: false,
        step: "import",
        status: importRes.status,
        payload: importPayload
      });
    }

    const mapping = {
      source_hex: "hex_code",
      source_designation: "designation",
      source_quantity: "quantity",
      source_unit: "unit",
      source_unit_price_ht: "unit_price_ht",
      source_total_ht: "total_ht"
    };

    const mappingRes = await fetch("/api/mappings", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        action: "create",
        import_id: importId,
        mapping,
        save_template: false
      })
    });

    const mappingPayload = await mappingRes.json().catch(() => null);
    if (!mappingRes.ok || !mappingPayload?.ok) {
      return JSON.stringify({
        ok: false,
        step: "mapping",
        importId,
        status: mappingRes.status,
        payload: mappingPayload
      });
    }

    return JSON.stringify({
      ok: true,
      importId,
      mappingId: mappingPayload?.data?.mapping?.id ?? null
    });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      step: "exception",
      error: String(error)
    });
  }
})()
"@

  $jsonString = ConvertFrom-AgentBrowserJson -RawOutput $raw
  $result = $jsonString | ConvertFrom-Json
  if (-not $result.ok) {
    throw "Unable to seed linked DPGF source via API: $($result | ConvertTo-Json -Compress)"
  }

  return $result
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  # ------------------------------------------------------------------
  # Step 1: Create empty affaire
  # ------------------------------------------------------------------
  Invoke-AB $Session "open" "$BaseUrl/dashboard/affaires" | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard/affaires" -TimeoutSeconds 45 | Out-Null

  Click-ActionContainsWithRetry -Session $Session -Labels @(
    "Nouvelle affaire",
    "nouvelle affaire"
  ) -ScopeSelector "" -TimeoutSeconds 25 -FailureMessage "Unable to open quick create affaire dialog." | Out-Null

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
  # Step 2: Seed a linked + mapped DPGF source for this affaire
  # ------------------------------------------------------------------
  $seedResult = Seed-LinkedDpgfSourceViaApi -Session $Session -ProjectId $projectId

  $hubSourceReady = $false
  $lastSourceState = $null
  $sourceDeadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $sourceDeadline) {
    $lastSourceState = Get-LinkedDpgfSourceApiState -Session $Session -ProjectId $projectId

    $sourceData = $null
    if ($lastSourceState -and $lastSourceState.payload) {
      $sourceData = $lastSourceState.payload.data
    }

    $importStatus = ""
    $mappedRowCount = 0
    if ($sourceData) {
      if ($sourceData.PSObject.Properties.Match("importStatus").Count -gt 0 -and $null -ne $sourceData.importStatus) {
        $importStatus = [string]$sourceData.importStatus
      } elseif ($sourceData.PSObject.Properties.Match("import_status").Count -gt 0 -and $null -ne $sourceData.import_status) {
        $importStatus = [string]$sourceData.import_status
      }

      if ($sourceData.PSObject.Properties.Match("mappedRowCount").Count -gt 0 -and $null -ne $sourceData.mappedRowCount) {
        $mappedRowCount = [int]$sourceData.mappedRowCount
      } elseif ($sourceData.PSObject.Properties.Match("mapped_row_count").Count -gt 0 -and $null -ne $sourceData.mapped_row_count) {
        $mappedRowCount = [int]$sourceData.mapped_row_count
      }
    }

    if ($importStatus -eq "completed" -and $mappedRowCount -gt 0) {
      $hubSourceReady = $true
      break
    }

    Start-Sleep -Milliseconds 700
    Invoke-AB $Session "reload" | Out-Null
    Wait-ForUrlContains -Session $Session -Needle "/dashboard/affaires/$projectId" -TimeoutSeconds 30 | Out-Null
  }

  if (-not $hubSourceReady) {
    throw "Linked DPGF source did not become importable. Seed=$($seedResult | ConvertTo-Json -Compress) LastSourceState=$($lastSourceState | ConvertTo-Json -Compress)"
  }

  # ------------------------------------------------------------------
  # Step 3: Hub -> wizard -> assert step 3 UX
  # ------------------------------------------------------------------
  Click-ActionContainsWithRetry -Session $Session -Labels @(
    "Creer une premiere version",
    "Créer une premiere version",
    "creer une premiere version"
  ) -ScopeSelector "main" -TimeoutSeconds 25 -FailureMessage "Unable to open estimate creation wizard from affaire hub." | Out-Null

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

  $step3Text = ""
  $step3Ready = $false
  $step3Deadline = (Get-Date).AddSeconds(40)
  while ((Get-Date) -lt $step3Deadline) {
    $step3Text = Get-PageText -Session $Session
    if ($step3Text -like "*Source detectee:*" -and $step3Text -like "*DPGF source a importer*") {
      $step3Ready = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $step3Ready) {
    throw "Wizard step 3 did not show linked DPGF source state. Text: $step3Text"
  }

  if ($step3Text -notlike "*La version sera creee avec les lignes du DPGF source lie.*") {
    throw "Wizard step 3 did not announce source import. Text: $step3Text"
  }

  if ($step3Text -like "*Aucun modele disponible actuellement*") {
    if ($step3Text -notlike "*Nouveau (vide)*") {
      throw "Template unavailable fallback should keep blank mode selected. Text: $step3Text"
    }
  }

  # ------------------------------------------------------------------
  # Step 4: Create and validate editor
  # ------------------------------------------------------------------
  $editUrl = $null
  $creationDeadline = (Get-Date).AddSeconds(90)
  $creationText = ""

  while ((Get-Date) -lt $creationDeadline) {
    $currentUrl = Normalize-AgentBrowserUrlOutput ([string](Invoke-AB $Session "eval" "window.location.href"))
    if ($currentUrl -match "/dashboard/estimates/[^/]+/edit") {
      $editUrl = $currentUrl
      break
    }

    Try-ClickAnyActionContains -Session $Session -Labels @(
      "Creer le chiffrage",
      "Créer le chiffrage",
      "chiffrage"
    ) -ScopeSelector "main" | Out-Null

    $creationText = Get-PageText -Session $Session
    if ($creationText -like "*Veuillez selectionner un template*") {
      throw "Wizard blocked by template selection error: $creationText"
    }
    if ($creationText -like "*Impossible d'importer la source DPGF liee.*") {
      throw "Wizard create failed while importing linked source: $creationText"
    }

    Start-Sleep -Milliseconds 500
  }

  if (-not $editUrl) {
    throw "Missing estimate edit URL after wizard creation. Last URL: $currentUrl. Last text: $creationText"
  }

  Wait-ForEditorSurface -Session $Session -TimeoutSeconds 60

  $lineCount = Get-LineRowCount -Session $Session
  if ($lineCount -le 0) {
    throw "Expected editor prefill from linked DPGF source, but line count is 0."
  }

  $editorText = Get-PageText -Session $Session
  if ($editorText -notlike "*Importer le DPGF source*") {
    throw "Editor should expose 'Importer le DPGF source' action. Text: $editorText"
  }

  Write-Host "DPGF-AFFAIRE-WIZARD-EDITOR PASS ($lineCount lignes importees)"
} finally {
  Close-AgentBrowser -Session $Session
}
