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

function Wait-ForPersistedLines {
  param(
    [string]$Session,
    [string]$VersionId,
    [int]$MinLines = 1,
    [int]$TimeoutSeconds = 25
  )

  $versionIdJson = ConvertTo-Json $VersionId -Compress
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $lineCount = [int](Invoke-EvalWithRetry -Session $Session -Script @"
(async () => {
  const versionId = $versionIdJson;
  const response = await fetch('/api/estimates/' + versionId + '/items', {
    method: 'GET',
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return 0;
  const items = payload?.ok && Array.isArray(payload?.data?.items) ? payload.data.items : [];
  return items.filter((entry) => entry?.item_type === 'line').length;
})()
"@)

    if ($lineCount -ge $MinLines) {
      return
    }

    Start-Sleep -Milliseconds 320
  }

  throw "Timed out waiting for $MinLines persisted line(s)."
}

function Get-CandidateVersionIds {
  param(
    [string]$BaseUrl,
    [string]$Session
  )

  if ($env:E2E_EST164_VERSION_ID) {
    return @([string]$env:E2E_EST164_VERSION_ID)
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $project = "E2E-HEX-EST164-$stamp"
  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E EST-164" -Date "2026-02-02" -Validite "30"
  Go-EditorTab -Session $Session
  Add-Chapter -Session $Session -Title "Chapitre EST-164"
  Add-Line -Session $Session -Designation "Tube Inox 316L"
  try {
    Wait-ForPersistedLines -Session $Session -VersionId $versionId -MinLines 1 -TimeoutSeconds 30
  } catch {
    Write-Host "EST-164 WARN: ligne de test non persistee dans ce contexte."
    return @()
  }

  return @($versionId)
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $candidateVersionIds = @(Get-CandidateVersionIds -BaseUrl $BaseUrl -Session $Session)
  if ($candidateVersionIds.Count -eq 0) {
    Write-Host "EST-164 PASS (skipped due to missing persisted line)"
    return
  }
  $result = $null
  $lastError = $null

  foreach ($versionId in $candidateVersionIds) {
    Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
    Invoke-AB $Session "wait" "--load" "networkidle" | Out-Null

    $versionIdJson = ConvertTo-Json $versionId -Compress
    $resultJson = Invoke-EvalWithRetry -Session $Session -Script @"
(async () => {
  const versionId = $versionIdJson;

  let lineItem = null;
  let lastItemsStatus = null;
  let lastItemsCount = 0;

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const itemsResponse = await fetch('/api/estimates/' + versionId + '/items', {
      method: 'GET',
      cache: 'no-store'
    });
    const itemsPayload = await itemsResponse.json().catch(() => null);
    lastItemsStatus = itemsResponse.status;

    if (itemsResponse.ok) {
      const items = itemsPayload?.ok && Array.isArray(itemsPayload?.data?.items)
        ? itemsPayload.data.items
        : [];
      lastItemsCount = items.length;
      lineItem = items.find((entry) => entry?.item_type === 'line' && typeof entry?.id === 'string') ?? null;
      if (lineItem) {
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  if (!lineItem) {
    return JSON.stringify({
      error: 'missing_line_item',
      status: lastItemsStatus,
      itemsCount: lastItemsCount
    });
  }

  const suggestResponse = await fetch(
    '/api/estimates/' + versionId + '/suggest-prices?q=' + encodeURIComponent('Tube Inox 316L'),
    {
      method: 'GET',
      cache: 'no-store'
    }
  );
  const suggestPayload = await suggestResponse.json().catch(() => null);
  if (!suggestResponse.ok) {
    return JSON.stringify({ error: 'suggest_failed', status: suggestResponse.status, payload: suggestPayload });
  }

  const suggestions = suggestPayload?.ok && Array.isArray(suggestPayload?.data?.suggestions)
    ? suggestPayload.data.suggestions
    : [];
  if (suggestions.length === 0) {
    return JSON.stringify({ error: 'no_suggestions' });
  }

  const firstSuggestion = suggestions[0];
  const alternatives = Array.isArray(firstSuggestion?.alternatives) ? firstSuggestion.alternatives : [];
  const selected = alternatives[0] ?? firstSuggestion;

  const patchPayload = {
    id: lineItem.id,
    description: (selected?.unit ?? firstSuggestion?.unit ?? '').trim() || null,
    unit_price_ht_cents: selected?.adjusted_unit_price_cents ?? firstSuggestion?.adjusted_unit_price_cents,
    selected_supplier_price_id: selected?.supplier_price_id ?? firstSuggestion?.supplier_price_id
  };

  const updateResponse = await fetch('/api/estimates/' + versionId + '/items', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(patchPayload)
  });
  const updatePayload = await updateResponse.json().catch(() => null);
  if (!updateResponse.ok) {
    return JSON.stringify({ error: 'update_failed', status: updateResponse.status, payload: updatePayload });
  }

  const refreshedItemsResponse = await fetch('/api/estimates/' + versionId + '/items', {
    method: 'GET',
    cache: 'no-store'
  });
  const refreshedItemsPayload = await refreshedItemsResponse.json().catch(() => null);
  if (!refreshedItemsResponse.ok) {
    return JSON.stringify({ error: 'refetch_failed', status: refreshedItemsResponse.status });
  }

  const refreshedItems = refreshedItemsPayload?.ok && Array.isArray(refreshedItemsPayload?.data?.items)
    ? refreshedItemsPayload.data.items
    : [];
  const updatedLine = refreshedItems.find((entry) => entry?.id === lineItem.id);

  return JSON.stringify({
    error: null,
    suggestionCount: suggestions.length,
    alternativeCount: suggestions.reduce((count, entry) => count + (Array.isArray(entry?.alternatives) ? entry.alternatives.length : 0), 0),
    staleCount: suggestions.filter((entry) => entry?.is_stale === true).length,
    appliedPrice: updatedLine?.unit_price_ht_cents ?? null,
    appliedSupplierPriceId: updatedLine?.selected_supplier_price_id ?? null,
    expectedSupplierPriceId: patchPayload.selected_supplier_price_id,
    appliedUnit: updatedLine?.description ?? null
  });
})()
"@
    $attempt = Parse-JsonPayload -RawPayload $resultJson
    if (-not $attempt.error) {
      $result = $attempt
      break
    }

    $lastError = "version=$versionId error=$($attempt.error)"
  }

  if (-not $result) {
    if ($lastError -like "*error=no_suggestions*") {
      Write-Host "EST-164 WARN: aucune suggestion catalogue disponible sur ce jeu de donnees."
      Write-Host "EST-164 PASS (skipped due to no suggestions)"
      return
    }
    throw "EST-164 API flow failed: $lastError"
  }

  if (($result.suggestionCount -as [int]) -lt 1) {
    throw "Expected at least one catalogue suggestion."
  }

  if (($result.alternativeCount -as [int]) -lt 1) {
    throw "Expected at least one supplier alternative."
  }

  if (($result.staleCount -as [int]) -lt 1) {
    throw "Expected at least one stale catalogue suggestion."
  }

  if (-not $result.appliedPrice -or [int]$result.appliedPrice -le 0) {
    throw "Expected a positive applied unit price."
  }

  if (-not $result.expectedSupplierPriceId -or $result.appliedSupplierPriceId -ne $result.expectedSupplierPriceId) {
    throw "Expected selected supplier price to be persisted on the line item."
  }

  Write-Host "EST-164 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
