import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  hasPowerShell,
  invokeLegacyMain,
  loadLegacySource,
  runPowerShell,
} from "./legacy-powershell-support";

// Real PowerShell source control flow is the subject: these boundaries supply
// browser outcomes without opening an account or a network connection. A browser
// journey cannot prove that its own legacy runner propagates failed assertions.
const common = `
${loadLegacySource}
$BaseUrl = 'http://fixture.invalid'
$Session = 'isolated-legacy-prices'
$project = 'isolated-legacy-suggestions'
$script:caseName = $env:LEGACY_CASE
function Login-E2E { }
function New-Estimate { }
function Go-ParamsTab { }
function Go-EditorTab { }
function Add-Chapter { }
function Add-Line { }
function Wait-ForUrlContains { }
function Wait-ForSelector { }
function Start-Sleep { }
function Close-AgentBrowser { Write-Host 'FIXTURE_CLEANUP' }
function ConvertFrom-AgentBrowserJson { param($RawOutput) return ($RawOutput | ConvertFrom-Json) }
function Assert-Contains {
  param([string]$Text, [string]$Expected, [string]$Message)
  if ($Text -notlike "*$Expected*") { throw "Missing expected content: $Message" }
}
`;

const prices = `
${common}
$script:csvClicks = 0
$script:modal = 'create'
$script:historyOpen = $false
function Click-FirstEnabledButtonByText { $script:modal = 'create' }
function Get-PageText {
  $text = @'
Prix fournisseurs
Ajouter un fournisseur / tarif
Importer un fichier de prix (CSV)
Rechercher
Total prix
Liste des prix fournisseurs
Fraîcheur
Gérez les tarifs de vos fournisseurs.
Actualiser
Mode avancé
'@
  if ($script:caseName -eq 'initially-expanded') { $text += ' Étape 1' }
  if ($script:caseName -eq 'missing-stats') { $text = $text.Replace('Total prix', '') }
  if ($script:caseName -eq 'missing-freshness') { $text = $text.Replace('Fraîcheur', '') }
  if ($script:caseName -eq 'missing-accent') { $text = $text.Replace('Gérez', 'Gerez') }
  if ($script:caseName -eq 'missing-refresh') { $text = $text.Replace('Actualiser', '') }
  if ($script:historyOpen) { $text += ' Mis à jour le 19/10/2026' }
  return $text
}
function Invoke-AB {
  param($Session, $Command, [Parameter(ValueFromRemainingArguments = $true)][object[]]$Arguments)
  $code = $Arguments -join ' '
  if ($Command -eq 'find' -and $code.Contains('Importer un fichier de prix')) { $script:csvClicks++; return }
  if ($Command -ne 'eval') { return }
  if ($code.Contains('price-csv-import-panel')) {
    $expanded = $script:csvClicks -eq 1
    if ($script:caseName -eq 'initially-expanded') { $expanded = $true }
    if ($script:caseName -eq 'unchanged-csv-panel') { $expanded = $false }
    if ($script:caseName -eq 'collapse-failure' -and $script:csvClicks -ge 2) { $expanded = $true }
    if ($script:caseName -eq 'missing-csv-panel' -and $script:csvClicks -eq 1) { return '{"expanded":"true","panelPresent":false,"panelVisible":false}' }
    return (@{ expanded = if ($expanded) { 'true' } else { 'false' }; panelPresent = $expanded; panelVisible = $expanded } | ConvertTo-Json -Compress)
  }
  if ($code.Contains('input[type=') -and $code.Contains('search')) { return ($script:caseName -ne 'missing-search') }
  if ($code.Contains("startsWith('Voir / modifier')")) {
    if ($script:caseName -eq 'missing-edit-row') { return $false }
    $script:modal = 'edit'
    return $true
  }
  if ($code.Contains('details') -and $code.Contains('open')) {
    if ($script:caseName -eq 'missing-history') { return $false }
    $script:historyOpen = $true
    return $true
  }
  if ($code.Contains('innerText')) {
    $dialog = if ($script:modal -eq 'edit') { "Modifier l’offre fournisseur Enregistrer l’offre" } else { 'Ajouter un fournisseur / tarif Fournisseur Article Prix unitaire' }
    return (ConvertTo-Json -InputObject $dialog -Compress)
  }
  throw "Unexpected browser boundary: $Command $code"
}
${invokeLegacyMain}
`;

const suggestions = `
${common}
function Invoke-AB {
  param($Session, $Command, [Parameter(ValueFromRemainingArguments = $true)][object[]]$Arguments)
  $code = $Arguments -join ' '
  if ($Command -eq 'eval' -and $code.Contains('JSON.stringify')) {
    $unit = if ($script:caseName -eq 'wrong-unit') { 'u' } else { 'm2' }
    $typeFo = if ($script:caseName -eq 'wrong-type') { 'Autre' } else { 'Materiaux' }
    if ($script:caseName -eq 'missing-line') { $unit = ''; $typeFo = '' }
    return (@{ unit = $unit; typeFo = $typeFo } | ConvertTo-Json -Compress)
  }
}
${invokeLegacyMain}
`;

function execute(script: string, source: string, name: string) {
  return runPowerShell(source, {
    LEGACY_SOURCE_FILE: path.resolve("e2e/hex", script),
    LEGACY_CASE: name,
  });
}

describe.skipIf(!hasPowerShell)("legacy prices and suggestion assertion propagation", () => {
  it.each([
    ["initially-expanded", "collapsed by default"],
    ["unchanged-csv-panel", "expand"],
    ["missing-csv-panel", "panel"],
    ["collapse-failure", "collapse"],
    ["missing-search", "Search"],
    ["missing-stats", "Stats"],
    ["missing-freshness", "Freshness"],
    ["missing-edit-row", "edit modal"],
    ["missing-history", "history"],
    ["missing-accent", "Gerez accent"],
    ["missing-refresh", "Refresh"],
  ])("fails prices journey on %s without a final pass", (name, diagnostic) => {
    const result = execute("prices-page.ps1", prices, name);
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stderr).toContain(diagnostic);
    expect(result.stdout).not.toContain("PRICES-PAGE E2E: ALL CHECKS PASSED");
    expect(result.stdout.match(/FIXTURE_CLEANUP/g)).toHaveLength(1);
  });

  it("keeps the complete prices control flow valid", () => {
    const result = execute("prices-page.ps1", prices, "success");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("PRICES-PAGE E2E: ALL CHECKS PASSED");
    expect(result.stdout).not.toMatch(/WARNING|SKIP/);
    expect(result.stdout.match(/FIXTURE_CLEANUP/g)).toHaveLength(1);
  });

  it.each(["wrong-unit", "wrong-type", "missing-line"])("fails suggestions on %s without a final pass", (name) => {
    const result = execute("ti-153-suggestions.ps1", suggestions, name);
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stderr).toContain("Suggestions");
    expect(result.stdout).not.toContain("TI-153 PASS");
    expect(result.stdout.match(/FIXTURE_CLEANUP/g)).toHaveLength(1);
  });

  it("keeps matching suggestion values green", () => {
    const result = execute("ti-153-suggestions.ps1", suggestions, "success");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("TI-153 PASS");
    expect(result.stdout.match(/FIXTURE_CLEANUP/g)).toHaveLength(1);
  });
});
