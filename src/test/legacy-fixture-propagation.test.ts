import path from "node:path";

import { describe, expect, it } from "vitest";

import { hasPowerShell, invokeLegacyMain, loadLegacySource, runPowerShell } from "./legacy-powershell-support";

// Exercise exact source functions and try/finally against supplied browser/API
// outcomes. This covers the runner hiding its own failed setup, which a browser
// verdict cannot expose. These fixtures never connect to a business backend.
const common = loadLegacySource + `
$BaseUrl = 'http://fixture.invalid'
$Session = 'isolated-legacy-fixture'
$project = 'isolated-legacy-fixture'
function Login-E2E { }
function New-Estimate { return 'fixture-version' }
function Go-EditorTab { }
function Open-EstimateEdit { }
function Add-Chapter { }
function Add-Line { }
function Start-Sleep { }
function Close-AgentBrowser { Write-Host 'FIXTURE_CLEANUP' }
function ConvertFrom-AgentBrowserJson { param($RawOutput) return ($RawOutput | ConvertFrom-Json) }
function Wait-ForPersistedLines {
  if ($env:LEGACY_FAULT -eq 'persistence') { throw 'INJECTED: fixture persistence failed' }
}
`;

const catalogue = common + `
if ($env:LEGACY_FAULT -eq 'empty-candidates') { function Get-CandidateVersionIds { return @() } }
$script:evalCount = 0
function Invoke-AB {
  param($Session, $Action, [Parameter(ValueFromRemainingArguments = $true)][object[]]$Arguments)
  if ($Action -ne 'eval') { return }
  $script:evalCount++
  if ($env:LEGACY_FAULT -eq 'recovered-transport' -and $script:evalCount -eq 1) { throw 'transport error: isolated fixture' }
  if ($env:LEGACY_FAULT -eq 'recovered-transport') { Write-Host 'RECOVERED_TRANSPORT' }
  $result = @{ error = $null; suggestionCount = 1; alternativeCount = 2; staleCount = 1;
    appliedPrice = 1250; appliedSupplierPriceId = 'price-1'; expectedSupplierPriceId = 'price-1' }
  switch ($env:LEGACY_FAULT) {
    'no-suggestions' { $result.error = 'no_suggestions' }
    'api-failure' { $result.error = 'suggest_failed' }
    'no-stale' { $result.staleCount = 0 }
    'zero-price' { $result.appliedPrice = 0 }
    'wrong-supplier' { $result.appliedSupplierPriceId = 'other-price' }
  }
  return ($result | ConvertTo-Json -Compress)
}
` + invokeLegacyMain;

const comparison = common + `
function Invoke-AB {
  param($Session, $Action, [Parameter(ValueFromRemainingArguments = $true)][object[]]$Arguments)
  if ($Action -ne 'eval') { return }
  $result = @{ error = $null; compareOpened = $true; selectedViaUi = $true;
    expectedSupplierPriceId = 'price-2'; appliedSupplierPriceId = 'price-2'; visualSignalDetected = $true }
  switch ($env:LEGACY_FAULT) {
    'not-enough-alternatives' { $result.error = 'not_enough_alternatives' }
    'not-enough-priced-alternatives' { $result.error = 'not_enough_priced_alternatives' }
    'api-failure' { $result.error = 'comparison_failed' }
    'closed-comparison' { $result.compareOpened = $false }
    'not-selected-via-ui' { $result.selectedViaUi = $false }
    'wrong-supplier' { $result.appliedSupplierPriceId = 'other-price' }
    'no-visual-warning' { $result.visualSignalDetected = $false }
  }
  return ($result | ConvertTo-Json -Compress)
}
` + invokeLegacyMain;

const editor = common + `
function Set-LineValues {
  if ($env:LEGACY_FAULT -eq 'numeric-setup') { throw 'INJECTED: numeric fixture setup failed' }
}
function Invoke-AB {
  param($Session, $Action, [Parameter(ValueFromRemainingArguments = $true)][object[]]$Arguments)
  if ($Action -eq 'eval' -and ($Arguments -join ' ').Contains('JSON.stringify')) {
    $counts = @{ sectionCount = 1; lineCount = 1 }
    if ($env:LEGACY_FAULT -eq 'missing-line') { $counts.lineCount = 0 }
    if ($env:LEGACY_FAULT -eq 'missing-chapter') { $counts.sectionCount = 0 }
    return ($counts | ConvertTo-Json -Compress)
  }
}
` + invokeLegacyMain;

function run(file: string, source: string, fault: string) {
  return runPowerShell(source, {
    LEGACY_SOURCE_FILE: path.resolve("e2e/hex", file),
    LEGACY_FAULT: fault,
  });
}

function expectFailure(file: string, source: string, fault: string, diagnostic: string, finalPass: string) {
  const result = run(file, source, fault);
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stderr).toContain(diagnostic);
  expect(result.stdout).not.toContain(finalPass);
  expect(result.stdout.match(/FIXTURE_CLEANUP/gu)).toHaveLength(1);
}

describe.skipIf(!hasPowerShell)("legacy fixture and API outcome propagation", () => {
  it.each([
    ["persistence", "INJECTED: fixture persistence failed"],
    ["empty-candidates", "persisted line"],
    ["no-suggestions", "no_suggestions"],
    ["api-failure", "suggest_failed"],
    ["no-stale", "stale catalogue suggestion"],
    ["zero-price", "positive applied unit price"],
    ["wrong-supplier", "selected supplier price"],
  ])("catalogue suggestions fail on %s", (fault, diagnostic) => {
    expectFailure("est-164-catalogue-suggestions.ps1", catalogue, fault, diagnostic, "EST-164 PASS");
  });

  it.each(["success", "recovered-transport"])("catalogue suggestions validate the complete %s result", (fault) => {
    const result = run("est-164-catalogue-suggestions.ps1", catalogue, fault);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("EST-164 PASS");
    expect(result.stdout.match(/FIXTURE_CLEANUP/gu)).toHaveLength(1);
    if (fault === "recovered-transport") expect(result.stdout).toContain("RECOVERED_TRANSPORT");
  });

  it.each([
    ["persistence", "INJECTED: fixture persistence failed"],
    ["not-enough-alternatives", "not_enough_alternatives"],
    ["not-enough-priced-alternatives", "not_enough_priced_alternatives"],
    ["api-failure", "comparison_failed"],
    ["closed-comparison", "comparison to be opened"],
    ["not-selected-via-ui", "selection through UI"],
    ["wrong-supplier", "selected_supplier_price_id to persist"],
    ["no-visual-warning", "visual warning"],
  ])("supplier comparison fails on %s", (fault, diagnostic) => {
    expectFailure("est-030-supplier-comparison.ps1", comparison, fault, diagnostic, "EST-030 PASS");
  });

  it("accepts the complete persisted comparison outcome", () => {
    const result = run("est-030-supplier-comparison.ps1", comparison, "success");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("EST-030 PASS");
    expect(result.stdout.match(/FIXTURE_CLEANUP/gu)).toHaveLength(1);
  });

  it.each([
    ["numeric-setup", "INJECTED: numeric fixture setup failed"],
    ["persistence", "INJECTED: fixture persistence failed"],
    ["missing-line", "Line persisted"],
    ["missing-chapter", "Chapter persisted"],
  ])("editor persistence fails on %s", (fault, diagnostic) => {
    expectFailure("ti-147-editor.ps1", editor, fault, diagnostic, "TI-147 PASS");
  });

  it("accepts a saved section and line after reload", () => {
    const result = run("ti-147-editor.ps1", editor, "success");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("TI-147 PASS");
    expect(result.stdout.match(/FIXTURE_CLEANUP/gu)).toHaveLength(1);
  });
});
