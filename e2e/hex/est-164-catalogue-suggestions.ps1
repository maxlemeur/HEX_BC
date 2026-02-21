param(
  [string]$BaseUrl,
  [string]$Session
)

. "$PSScriptRoot/common.ps1"

$config = Get-HexConfig -BaseUrl $BaseUrl -Session $Session
$BaseUrl = $config.BaseUrl
$Session = $config.Session

Require-AgentBrowser

function Parse-JsonPayload {
  param([object]$RawPayload)

  $parsed = ([string]$RawPayload) | ConvertFrom-Json
  if ($parsed -is [string]) {
    $parsed = ([string]$parsed) | ConvertFrom-Json
  }

  return $parsed
}

function Login-Smoke {
  param(
    [string]$BaseUrl,
    [string]$Session
  )

  if (-not $env:E2E_LOGIN_EMAIL -or -not $env:E2E_LOGIN_PASSWORD) {
    throw "E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD must be set."
  }

  Invoke-AB $Session "open" "$BaseUrl/login"
  Invoke-AB $Session "wait" "--load" "networkidle" | Out-Null
  Invoke-AB $Session "find" "label" "Email" "fill" $env:E2E_LOGIN_EMAIL | Out-Null
  Invoke-AB $Session "fill" "#password" $env:E2E_LOGIN_PASSWORD | Out-Null
  Invoke-AB $Session "eval" @"
(() => {
  const form = document.querySelector('form');
  if (!form) throw new Error('Missing login form');
  form.requestSubmit();
})();
"@ | Out-Null
  Wait-ForUrlContains -Session $Session -Needle "/dashboard" | Out-Null
}

function Get-DraftVersionIds {
  param([string]$Session)

  if ($env:E2E_EST164_VERSION_ID) {
    return @([string]$env:E2E_EST164_VERSION_ID)
  }

  $payloadJson = Invoke-AB $Session "eval" @"
(async () => {
  const response = await fetch('/api/estimates', {
    method: 'GET',
    cache: 'no-store'
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return JSON.stringify({
      versionIds: [],
      error: payload?.error?.message ?? ('HTTP ' + response.status)
    });
  }

  const versions = payload?.ok && Array.isArray(payload?.data?.items)
    ? payload.data.items
    : [];
  const draftCandidates = versions.filter(
    (item) => item?.status === 'draft' && typeof item?.version_id === 'string'
  );
  const eligibleVersionIds = [];

  for (const candidate of draftCandidates) {
    const versionId = candidate.version_id;
    const responseItems = await fetch('/api/estimates/' + versionId + '/items', {
      method: 'GET',
      cache: 'no-store'
    });
    const payloadItems = await responseItems.json().catch(() => null);
    if (!responseItems.ok) continue;

    const estimateItems = payloadItems?.ok && Array.isArray(payloadItems?.data?.items)
      ? payloadItems.data.items
      : [];

    if (estimateItems.some((entry) => entry?.item_type === 'line')) {
      eligibleVersionIds.push(versionId);
    }
  }

  return JSON.stringify({ versionIds: eligibleVersionIds, error: null });
})()
"@

  $payload = Parse-JsonPayload -RawPayload $payloadJson
  $hasError = $payload -and ($payload.PSObject.Properties.Name -contains "error")
  if ($hasError -and $payload.error) {
    throw "Unable to list estimates: $($payload.error)"
  }

  $hasVersionIds = $payload -and ($payload.PSObject.Properties.Name -contains "versionIds")
  $versionIds = @()
  if ($hasVersionIds -and $payload.versionIds) {
    $versionIds = @($payload.versionIds)
  }

  if ($versionIds.Count -eq 0) {
    throw "No draft estimate with line items available for EST-164 smoke."
  }

  return $versionIds
}

try {
  Login-Smoke -BaseUrl $BaseUrl -Session $Session

  $candidateVersionIds = Get-DraftVersionIds -Session $Session
  $result = $null
  $lastError = $null

  foreach ($versionId in $candidateVersionIds) {
    Open-EstimateEdit -BaseUrl $BaseUrl -Session $Session -VersionId $versionId
    Invoke-AB $Session "wait" "--load" "networkidle" | Out-Null

    $versionIdJson = ConvertTo-Json $versionId -Compress
    $resultJson = Invoke-AB $Session "eval" @"
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
