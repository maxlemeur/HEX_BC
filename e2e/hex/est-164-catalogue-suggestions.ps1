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

  return @($versionId)
}

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $candidateVersionIds = Get-CandidateVersionIds -BaseUrl $BaseUrl -Session $Session
  $result = $null
  $lastError = $null

  foreach ($versionId in $candidateVersionIds) {
    Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
    Invoke-AB $Session "wait" "--load" "networkidle" | Out-Null

    $versionIdJson = ConvertTo-Json $versionId -Compress
    $resultJson = Invoke-EvalWithRetry -Session $Session -Script @"
(async () => {
  const versionId = $versionIdJson;

  const itemsResponse = await fetch('/api/estimates/' + versionId + '/items', {
    method: 'GET',
    cache: 'no-store'
  });
  const itemsPayload = await itemsResponse.json().catch(() => null);
  if (!itemsResponse.ok) {
    return JSON.stringify({ error: 'items_fetch_failed', status: itemsResponse.status });
  }

  const items = itemsPayload?.ok && Array.isArray(itemsPayload?.data?.items)
    ? itemsPayload.data.items
    : [];
  const lineItem = items.find((entry) => entry?.item_type === 'line' && typeof entry?.id === 'string');
  if (!lineItem) {
    return JSON.stringify({ error: 'missing_line_item' });
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
