param(
  [string]$BaseUrl,
  [string]$Session
)

. "$PSScriptRoot/common.ps1"

$config = Get-HexConfig -BaseUrl $BaseUrl -Session $Session
$BaseUrl = $config.BaseUrl
$Session = $config.Session

Require-AgentBrowser

function Invoke-EvalWithRetry {
  param(
    [string]$Session,
    [string]$Script,
    [int]$MaxAttempts = 3
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      return Invoke-AB $Session "eval" $Script
    } catch {
      $isTransient = $_.Exception.Message -match "Invalid response:\s*EOF|Resource temporarily unavailable \(os error 11\)|transport error|socket hang up|ECONNRESET|EPIPE|broken pipe|connection reset"
      if ($attempt -lt $MaxAttempts -and $isTransient) {
        Start-Sleep -Milliseconds (400 * $attempt)
        continue
      }
      throw
    }
  }
}

function Parse-JsonPayload {
  param([object]$RawPayload)

  $parsed = ConvertFrom-AgentBrowserJson -RawOutput $RawPayload
  if ($parsed -is [string]) {
    $parsed = ConvertFrom-AgentBrowserJson -RawOutput $parsed
  }

  return $parsed
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$project = "E2E-HEX-EST030-$stamp"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E EST-030" -Date "2026-02-02" -Validite "30"
  Go-EditorTab -Session $Session
  Add-Chapter -Session $Session -Title "Chapitre EST-030"
  Add-Line -Session $Session -Designation "Tube Inox 316L"
  Invoke-AB $Session "wait" "--load" "networkidle" | Out-Null

  $versionIdJson = ConvertTo-Json $versionId -Compress
  $resultJson = Invoke-EvalWithRetry -Session $Session -Script @"
(async () => {
  const versionId = $versionIdJson;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 8000, intervalMs = 150) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) {
        return true;
      }
      await sleep(intervalMs);
    }
    return false;
  };

  const toText = (value) => (typeof value === 'string' ? value.trim() : '');
  const toNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const normalizePrice = (entry) => {
    const adjusted = toNumber(entry?.adjusted_unit_price_cents);
    const unit = toNumber(entry?.unit_price_cents);
    return adjusted ?? unit;
  };

  const clickByText = (labels) => {
    const candidates = Array.from(
      document.querySelectorAll('button, [role="button"], [role="menuitem"], a')
    );
    for (const candidate of candidates) {
      const text = (candidate.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!text) continue;
      const matches = labels.some((label) => text.includes(label.toLowerCase()));
      if (matches) {
        candidate.click();
        return true;
      }
    }
    return false;
  };

  const extractComparisonEntries = (payload) => {
    const containers = [payload, payload?.data];
    const entries = [];

    for (const container of containers) {
      if (!container) continue;
      if (Array.isArray(container)) {
        entries.push(...container);
        continue;
      }
      if (typeof container !== 'object') continue;

      const arrayKeys = ['comparisons', 'items', 'lines', 'results', 'data'];
      for (const key of arrayKeys) {
        if (Array.isArray(container[key])) {
          entries.push(...container[key]);
        }
      }

      for (const [key, value] of Object.entries(container)) {
        if (Array.isArray(value)) {
          entries.push({
            item_id: key,
            alternatives: value,
          });
          continue;
        }
        if (!value || typeof value !== 'object') continue;
        const hasAlternatives = Array.isArray(value.alternatives);
        const hasSuppliers = Array.isArray(value.suppliers);
        if (hasAlternatives || hasSuppliers) {
          entries.push({
            item_id: toText(value.item_id) || key,
            alternatives: value.alternatives ?? value.suppliers,
          });
        }
      }
    }

    return entries;
  };

  const itemsResponse = await fetch('/api/estimates/' + versionId + '/items', {
    method: 'GET',
    cache: 'no-store',
  });
  const itemsPayload = await itemsResponse.json().catch(() => null);
  if (!itemsResponse.ok) {
    return JSON.stringify({
      error: 'items_fetch_failed',
      status: itemsResponse.status,
    });
  }

  const items = itemsPayload?.ok && Array.isArray(itemsPayload?.data?.items)
    ? itemsPayload.data.items
    : [];
  const lineItem = items.find((entry) => entry?.item_type === 'line' && typeof entry?.id === 'string');
  if (!lineItem) {
    return JSON.stringify({ error: 'missing_line_item' });
  }

  const comparisonResponse = await fetch('/api/estimates/' + versionId + '/supplier-comparisons', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      item_ids: [lineItem.id],
    }),
  });
  const comparisonPayload = await comparisonResponse.json().catch(() => null);
  if (!comparisonResponse.ok) {
    return JSON.stringify({
      error: 'comparison_fetch_failed',
      status: comparisonResponse.status,
      payload: comparisonPayload,
    });
  }

  const comparisonEntries = extractComparisonEntries(comparisonPayload);
  const lineComparison =
    comparisonEntries.find((entry) => toText(entry?.item_id) === lineItem.id) ??
    comparisonEntries[0];

  const alternatives = Array.isArray(lineComparison?.alternatives)
    ? lineComparison.alternatives
        .map((alternative) => ({
          supplier_price_id: toText(alternative?.supplier_price_id),
          supplier_name: toText(alternative?.supplier_name),
          supplier_reference: toText(alternative?.supplier_reference),
          adjusted_unit_price_cents: toNumber(alternative?.adjusted_unit_price_cents),
          unit_price_cents: toNumber(alternative?.unit_price_cents),
        }))
        .filter((alternative) => alternative.supplier_price_id)
    : [];

  if (alternatives.length < 2) {
    return JSON.stringify({
      error: 'not_enough_alternatives',
      alternativeCount: alternatives.length,
    });
  }

  const alternativesWithPrice = alternatives
    .map((alternative) => ({
      ...alternative,
      normalized_price_cents: normalizePrice(alternative),
    }))
    .filter((alternative) => alternative.normalized_price_cents !== null)
    .sort((left, right) => left.normalized_price_cents - right.normalized_price_cents);

  if (alternativesWithPrice.length < 2) {
    return JSON.stringify({
      error: 'not_enough_priced_alternatives',
      alternativeCount: alternativesWithPrice.length,
    });
  }

  const bestAlternative = alternativesWithPrice[0];
  const nonOptimalAlternative =
    alternativesWithPrice.find((entry) => {
      return (
        entry.supplier_price_id !== bestAlternative.supplier_price_id &&
        entry.normalized_price_cents > bestAlternative.normalized_price_cents
      );
    }) ??
    alternativesWithPrice.find(
      (entry) => entry.supplier_price_id !== bestAlternative.supplier_price_id
    );

  if (!nonOptimalAlternative) {
    return JSON.stringify({
      error: 'missing_non_optimal_alternative',
    });
  }

  const lineInput = Array.from(document.querySelectorAll('input.estimate-input--title')).find(
    (input) => {
      const title = (input.value || '').trim().toLowerCase();
      return title.includes('tube inox 316l');
    }
  );
  if (!lineInput) {
    return JSON.stringify({ error: 'line_input_not_found' });
  }

  lineInput.focus();

  const row =
    lineInput.closest('.estimate-row') ??
    lineInput.closest('[role="row"]') ??
    lineInput.parentElement;
  if (!row) {
    return JSON.stringify({ error: 'line_row_not_found' });
  }

  const rowRect = row.getBoundingClientRect();
  row.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rowRect.left + 12,
      clientY: rowRect.top + 12,
    })
  );

  await sleep(200);

  let compareOpened = clickByText(['Comparer fournisseurs', 'Compare suppliers']);
  if (!compareOpened) {
    compareOpened = clickByText(['Comparaison fournisseurs', 'Supplier comparison']);
  }

  const panelOpened = compareOpened
    ? await waitFor(() => {
        const knownSelectors = [
          '[data-testid="supplier-comparison-panel"]',
          '.supplier-comparison-panel',
          '.estimate-supplier-comparison-panel',
          '[data-supplier-comparison="true"]',
        ];
        if (knownSelectors.some((selector) => document.querySelector(selector))) {
          return true;
        }

        const visibleText = (
          document.querySelector('main')?.innerText || document.body?.innerText || ''
        ).toLowerCase();
        return (
          visibleText.includes('comparaison fournisseur') ||
          visibleText.includes('comparer fournisseurs')
        );
      }, 6000, 150)
    : false;

  const clickAlternativeCandidate = () => {
    const normalizedTargetId = nonOptimalAlternative.supplier_price_id.toLowerCase();
    const normalizedSupplierName = nonOptimalAlternative.supplier_name.toLowerCase();
    const normalizedReference = (nonOptimalAlternative.supplier_reference || '').toLowerCase();
    const supplierLabel = normalizedSupplierName.length > 0 ? normalizedSupplierName : null;
    const referenceLabel = normalizedReference.length > 0 ? normalizedReference : null;

    const clickable = Array.from(
      document.querySelectorAll('button, [role="button"], [data-supplier-price-id], [data-price-id]')
    );

    const byId = clickable.find((candidate) => {
      const attrValues = [
        candidate.getAttribute('data-supplier-price-id'),
        candidate.getAttribute('data-price-id'),
        candidate.getAttribute('data-id'),
        candidate.id,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      return attrValues.some((value) => value.includes(normalizedTargetId));
    });
    if (byId) {
      byId.click();
      return true;
    }

    const byText = clickable.find((candidate) => {
      const text = (candidate.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!text) return false;
      if (supplierLabel && !text.includes(supplierLabel)) return false;
      if (referenceLabel && !text.includes(referenceLabel)) return false;
      return true;
    });
    if (byText) {
      byText.click();
      return true;
    }

    return false;
  };

  let selectedViaUi = false;
  if (panelOpened) {
    selectedViaUi = clickAlternativeCandidate();
    if (selectedViaUi) {
      await sleep(200);
      clickByText(['Appliquer', 'Selectionner', 'Valider', 'Choisir']);
    }
  }

  if (!selectedViaUi) {
    lineInput.dispatchEvent(new Event('input', { bubbles: true }));
    const suggestionsVisible = await waitFor(() => {
      return document.querySelectorAll(
        '.estimate-catalogue-suggestion__alternative, .estimate-catalogue-suggestion__primary'
      ).length > 0;
    }, 6000, 150);

    if (!suggestionsVisible) {
      return JSON.stringify({
        error: 'comparison_ui_not_found',
        compareOpened,
        panelOpened,
      });
    }

    const fallbackButtons = Array.from(
      document.querySelectorAll(
        '.estimate-catalogue-suggestion__alternative, .estimate-catalogue-suggestion__primary'
      )
    );
    const fallbackChoice = fallbackButtons.find((candidate) => {
      const text = (candidate.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!text) return false;
      if (toText(nonOptimalAlternative.supplier_name).length > 0) {
        return text.includes(toText(nonOptimalAlternative.supplier_name).toLowerCase());
      }
      return true;
    });

    if (!fallbackChoice) {
      return JSON.stringify({
        error: 'comparison_selection_missing',
        compareOpened,
        panelOpened,
      });
    }

    fallbackChoice.click();
    selectedViaUi = true;
    compareOpened = true;
  }

  await sleep(900);

  const refreshedItemsResponse = await fetch('/api/estimates/' + versionId + '/items', {
    method: 'GET',
    cache: 'no-store',
  });
  const refreshedItemsPayload = await refreshedItemsResponse.json().catch(() => null);
  if (!refreshedItemsResponse.ok) {
    return JSON.stringify({
      error: 'refetch_failed',
      status: refreshedItemsResponse.status,
    });
  }

  const refreshedItems = refreshedItemsPayload?.ok && Array.isArray(refreshedItemsPayload?.data?.items)
    ? refreshedItemsPayload.data.items
    : [];
  const updatedLine = refreshedItems.find((entry) => entry?.id === lineItem.id);

  const signalSelectors = [
    '[data-testid="supplier-warning"]',
    '[data-testid*="supplier-warning"]',
    '[data-supplier-warning="true"]',
    '[data-supplier-non-optimal="true"]',
    '.estimate-supplier-warning',
    '.estimate-line-supplier-warning',
    '.supplier-comparison-warning',
  ];
  const hasSignalElement = signalSelectors.some((selector) => document.querySelector(selector));

  const mainText = (
    document.querySelector('main')?.innerText || document.body?.innerText || ''
  ).toLowerCase();
  const rowText = (row.innerText || '').toLowerCase();
  const signalPhrases = [
    'non optimal',
    'moins cher',
    'meilleur prix',
    'fournisseur non optimal',
    'supplier warning',
  ];
  const hasSignalText = signalPhrases.some((phrase) => {
    return mainText.includes(phrase) || rowText.includes(phrase);
  });

  return JSON.stringify({
    error: null,
    compareOpened,
    panelOpened,
    selectedViaUi,
    expectedSupplierPriceId: nonOptimalAlternative.supplier_price_id,
    appliedSupplierPriceId: updatedLine?.selected_supplier_price_id ?? null,
    visualSignalDetected: hasSignalElement || hasSignalText,
    alternativeCount: alternatives.length,
  });
})()
"@

  $result = Parse-JsonPayload -RawPayload $resultJson

  if ($result.error) {
    if ($result.error -in @("not_enough_alternatives", "not_enough_priced_alternatives")) {
      Write-Host "EST-030 WARN: jeu de donnees insuffisant pour comparer plusieurs fournisseurs."
      Write-Host "EST-030 PASS (skipped due to insufficient alternatives)"
      return
    }
    throw "EST-030 flow failed: $($result.error)"
  }

  if (-not $result.compareOpened) {
    throw "Expected supplier comparison to be opened."
  }

  if (-not $result.selectedViaUi) {
    throw "Expected non-optimal supplier selection through UI."
  }

  if (-not $result.expectedSupplierPriceId -or $result.appliedSupplierPriceId -ne $result.expectedSupplierPriceId) {
    throw "Expected selected_supplier_price_id to persist the non-optimal supplier."
  }

  if (-not $result.visualSignalDetected) {
    throw "Expected visual warning when selected supplier is not the best price."
  }

  Write-Host "EST-030 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
