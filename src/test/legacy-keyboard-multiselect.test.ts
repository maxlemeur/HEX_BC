import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  hasPowerShell,
  invokeLegacyMain,
  loadLegacySource,
  runPowerShell,
} from "./legacy-powershell-support";

// Failure modes: a mouse click cannot prove Enter, absent bulk controls cannot
// qualify an action, and deleting one of two selected rows cannot qualify bulk
// deletion. A browser test cannot observe these scripts swallowing their own
// failures. Execute the original PowerShell AST with only browser I/O replaced.
const keyboardFixture = String.raw`
${loadLegacySource}
$Session = 'isolated'; $BaseUrl = 'http://localhost'; $project = 'fixture'
$script:active = 'line-title'; $script:quantity = 1; $script:caret = 7; $script:titles = 3; $script:clock = 0; $script:menuOpen = $false
function Login-E2E {}
function New-Estimate {}
function Go-EditorTab {}
function Add-Chapter {}
function Add-Line {}
function Start-Sleep {}
function Get-Date { $script:clock += 1; return [datetime]::new(2026, 10, 19).AddSeconds($script:clock) }
function Close-AgentBrowser { Write-Host 'FIXTURE-CLEANUP' }
function Get-ActiveCellId {
  if ($script:active -eq 'quantity-grid') { return 'line::quantity' }
  if ($script:active -eq 'second-quantity-grid') { return 'line2::quantity' }
  return "line::$script:active"
}
function Invoke-AB {
  param($Session, $Command, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Values)
  $Value = $Values -join ' '
  if ($Command -eq 'press') {
    switch ($Value) {
      'Tab' { $script:active = if ($script:active -eq 'section-title') { 'line-title' } else { 'line-quantity' } }
      'Shift+Tab' { $script:active = 'line-title' }
      'Enter' {
        if ($script:active -eq 'section-quick-actions') { $script:menuOpen = $true }
        if ($script:active -eq 'section-add-line' -and $env:CASE -ne 'enter-broken') { $script:titles += 1 }
      }
      'ArrowUp' { if ($script:active -eq 'second-quantity-grid' -and $env:CASE -ne 'navigation-stuck') { $script:active = 'quantity-grid' } }
      'ArrowDown' { if ($script:active -eq 'quantity-grid' -and $env:CASE -ne 'navigation-stuck') { $script:active = 'second-quantity-grid' } }
      'ArrowLeft' { if ($env:CASE -ne 'caret-stuck') { $script:caret -= 1 } }
      'ArrowRight' { if ($env:CASE -ne 'caret-stuck') { $script:caret += 1 } }
    }
    return
  }
  if ($Command -ne 'eval') { throw "Unexpected browser command $Command" }
  if ($Value.Contains('setupReady=true')) {
    if ($env:CASE -eq 'missing-fixture') { return 'setupReady=false||reason=missing_rows' }
    $button = if ($env:CASE -eq 'success') { 'True' } else { 'False' }
    $trigger = if ($env:CASE -eq 'missing-trigger') { 'False' } else { 'True' }
    return "setupReady=true||sectionInputCount=1||lineFieldCount=4||lineTitleCellId=line::line-title||lineQuantityCellId=line::quantity||secondQuantityCellId=line2::quantity||sectionAddLineAvailable=$button||sectionQuickActionsAvailable=$trigger"
  }
  if ($Value.Contains("input.value = '1'")) { $script:active = 'line-quantity'; return 1 }
  if ($Value.Contains("return Number(input?.value ?? '0')")) { return $script:quantity }
  if ($Value.Contains('setSelectionRange')) { $script:active = 'line-title'; return '7||7' }
  if ($Value.Contains('return Number(input?.selectionStart')) { return $script:caret }
  if ($Value.Contains('?.focus(); document.activeElement')) { $script:active = 'section-title'; return $script:active }
  if ($Value.Contains('quantityCell.focus()')) { $script:active = 'quantity-grid'; return 'line::quantity' }
  if ($Value.Contains('trigger.focus()')) { $script:active = 'section-quick-actions'; return $script:active }
  if ($Value.Contains('Boolean(button)')) { return ($script:menuOpen -and $env:CASE -ne 'missing-button') }
  if ($Value.Contains('button.focus()')) {
    if (-not $script:menuOpen -or $env:CASE -eq 'missing-button') { return '' }
    $script:active = 'section-add-line'; return $script:active
  }
  if ($Value.Contains('button.click()')) { Write-Host 'MOUSE-SUBSTITUTION'; $script:titles += 1; return $true }
  if ($Value.Contains('document.querySelectorAll(') -and $Value.Contains('.length')) { return $script:titles }
  if ($Value.Contains('el.focus()')) { $script:active = 'line-title'; return $script:active }
  if ($Value.Contains("document.activeElement?.getAttribute('data-kbd-id')")) { return $script:active }
  throw "Unexpected keyboard browser evaluation: $Value"
}
${invokeLegacyMain}
`;

const multiselectFixture = String.raw`
${loadLegacySource}
$Session = 'isolated'; $BaseUrl = 'http://localhost'; $project = 'fixture'
$script:stage = 'initial'; $script:deleted = $false; $script:selectionCalls = 0; $script:deletionSnapshots = 0; $script:clock = 0
function Login-E2E {}
function New-Estimate {}
function Go-EditorTab {}
function Add-Chapter {}
function Add-Line {}
function Start-Sleep {}
function Get-Date { $script:clock += 1; return [datetime]::new(2026, 10, 19).AddSeconds($script:clock) }
function Close-AgentBrowser { Write-Host 'FIXTURE-CLEANUP' }
function Get-EditorRowCounts { return @{ sectionCount = 2; lineCount = 3 } }
function Initialize-MultiSelectFixture { return @{ sectionCount = 2; lineCount = 3; targetSection = 'Section Cible' } }
function New-Snapshot {
  param([int]$Count = 2, [int]$Lines = 3)
  $category = if ($script:stage -in @('category', 'role')) { 'Materiaux' } else { 'Ancien' }
  $role = if ($script:stage -eq 'role') { 'Ouvrier' } else { 'Ancien' }
  if ($env:CASE -eq 'category-noop') { $category = 'Ancien' }
  if ($env:CASE -eq 'role-noop') { $role = 'Ancien' }
  $entries = @(0..($Lines - 1) | ForEach-Object { @{ id = "line-$_"; title = "Ligne $_"; sectionTitle = 'Section Cible'; supplyType = $category; role = $role } })
  if ($script:deleted -and $Lines -eq 1 -and $env:CASE -ne 'wrong-delete') {
    $entries[0].title = if ($env:CASE -eq 'unselected-mutated') { 'Changed witness' } else { 'Ligne 2' }
  }
  return @{ selectionCount = $Count; selectedCount = $Count; lineCount = $Lines; lines = $entries; selectedLines = @($entries | Select-Object -First $Count) }
}
function Invoke-LineModifierClick {}
function Click-BlankArea {}
function Wait-ForSelectionCount {
  param($Session, [int]$Expected, $TimeoutSeconds)
  $script:selectionCalls += 1
  if ($env:CASE -eq 'shift-broken' -and $script:selectionCalls -eq 5) { throw 'Range selection failed' }
  return New-Snapshot -Count $Expected
}
function Invoke-BulkMoveSectionAction {
  if ($env:CASE -eq 'missing-move') { return @{ ok = $false; reason = 'missing move control' } }
  $script:stage = 'move'; return @{ ok = $true; targetLabel = 'Section Cible' }
}
function Invoke-BulkCategoryAction {
  if ($env:CASE -eq 'missing-category') { return @{ ok = $false; reason = 'missing category control' } }
  $script:stage = 'category'; return @{ ok = $true; nextLabel = 'Materiaux'; nextValue = '11111111-1111-4111-8111-111111111111' }
}
function Get-PersistedLineCategories {
  return @(0..2 | ForEach-Object { @{ id = "line-$_"; category_id = if ($env:CASE -eq 'category-noop') { 'previous-category' } else { '11111111-1111-4111-8111-111111111111' } } })
}
function Invoke-BulkRoleAction {
  if ($env:CASE -eq 'missing-role') { return @{ ok = $false; reason = 'missing role control' } }
  $script:stage = 'role'; return @{ ok = $true; nextLabel = 'Ouvrier' }
}
function Get-MultiSelectSnapshot {
  if ($script:deleted) {
    $count = if ($env:CASE -eq 'partial-delete') { 2 } else { 1 }
    $selected = if ($env:CASE -eq 'selection-not-cleared') { 1 } else { 0 }
    return New-Snapshot -Count $selected -Lines $count
  }
  if ($script:stage -eq 'role') {
    $script:deletionSnapshots += 1
    if ($env:CASE -eq 'missing-selection' -and $script:deletionSnapshots -gt 1) { return New-Snapshot -Count 0 }
  }
  return New-Snapshot
}
function Wait-ForLineCount {
  param($Session, $Expected, $TimeoutSeconds)
  if ($env:CASE -eq 'partial-delete') { throw 'Exact bulk deletion count not reached' }
  return Get-MultiSelectSnapshot
}
function Confirm-EditorDeleteDialog { return $true }
function Invoke-AB {
  param($Session, $Command, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Values)
  $Value = $Values -join ' '
  if ($Command -eq 'press' -and $Value -eq 'Delete') { $script:deleted = $true }
  if ($Command -eq 'press' -and $Value -eq 'Escape' -and $script:deleted) { $env:CASE = 'success' }
  if ($Command -eq 'eval' -and $Value.Contains('window.__est103ConfirmMessages.length')) { return 1 }
}
${invokeLegacyMain}
`;

const addLineFixture = String.raw`
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:LEGACY_SOURCE_FILE, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Add-Line' }, $true)
. ([scriptblock]::Create($definition.Extent.Text))
$script:lineCalls = 0; $script:persistCalls = 0
function Wait-ForEditorSurface {}
function Invoke-AB { return 2 }
function Get-LineRowCount { $script:lineCalls += 1; return [Math]::Min(1, $script:lineCalls - 1) }
function Get-CurrentEstimateVersionId { return 'fixture-version' }
function Get-PersistedLineItemCount { return 0 }
function Set-LatestLineTitleValue { if ($env:CASE -eq 'title-failure') { throw 'Title cannot be set' } }
function Start-Sleep {}
function Go-EditorTab {}
function Try-CreateLineViaApi { return $env:CASE -ne 'api-failure' }
function Wait-ForPersistedLineItems {
  $script:persistCalls += 1
  if ($env:CASE -in @('persist-failure', 'api-failure') -or ($env:CASE -eq 'fallback-success' -and $script:persistCalls -eq 1)) { throw 'Persistence target not reached' }
}
try { Add-Line -Session 'isolated' -Designation 'Fixture line'; Write-Host 'ADD-LINE PASS' }
finally { Write-Host 'FIXTURE-CLEANUP' }
`;

const sourcePath = (file: string) => path.resolve("e2e/hex", file);
const failureReasons: Record<string, string> = {
  "missing-fixture": "Keyboard fixture unavailable",
  "missing-trigger": "Section quick-actions trigger is required",
  "missing-button": "Add-line button was not revealed by keyboard",
  "enter-broken": "Enter on section add-line should create exactly one line",
  "navigation-stuck": "ArrowDown should navigate to the next quantity cell",
  "caret-stuck": "ArrowLeft should move title caret left",
  "missing-move": "Bulk move section action unavailable",
  "missing-category": "Bulk category action unavailable",
  "missing-role": "Bulk role action unavailable",
  "missing-selection": "Bulk deletion requires the two selected lines",
  "shift-broken": "Range selection failed",
  "category-noop": "Bulk category should apply the requested category",
  "role-noop": "Bulk role should apply the requested role",
  "partial-delete": "Exact bulk deletion count not reached",
  "selection-not-cleared": "Selection should be cleared after delete",
  "wrong-delete": "Selected line 'Ligne 0' should be deleted",
  "unselected-mutated": "Unselected line 'Ligne 2' should remain after deletion",
  "title-failure": "Unable to set line title after line creation and API fallback",
  "persist-failure": "Persistence target not reached",
  "api-failure": "Persisted line item count target not reached and API fallback failed",
};
const failure = (fixture: string, file: string, scenario: string) => {
  const result = runPowerShell(fixture, { LEGACY_SOURCE_FILE: sourcePath(file), CASE: scenario });
  expect(result.stdout, result.stderr).toContain("FIXTURE-CLEANUP");
  expect(result.stdout, result.stderr).not.toMatch(/(?:KEYBOARD|MULTISELECT|ADD-LINE) PASS/u);
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stderr + result.stdout).toContain(failureReasons[scenario]);
};

describe.skipIf(!hasPowerShell)("legacy keyboard and multiselect PowerShell assertions", () => {
  it.each(["missing-fixture", "missing-trigger", "missing-button", "enter-broken", "navigation-stuck", "caret-stuck"])("EST101 rejects %s without a mouse substitute", (scenario) => {
    failure(keyboardFixture, "est-101-keyboard.ps1", scenario);
  });

  it.each(["success", "popover-hidden"])("EST101 accepts text quantity navigation and keyboard popover (%s)", (scenario) => {
    const result = runPowerShell(keyboardFixture, { LEGACY_SOURCE_FILE: sourcePath("est-101-keyboard.ps1"), CASE: scenario });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("EST-101 KEYBOARD PASS");
    expect(result.stdout).not.toContain("MOUSE-SUBSTITUTION");
    expect(result.stdout).toContain("FIXTURE-CLEANUP");
  });

  it.each(["missing-move", "missing-category", "missing-role", "missing-selection", "shift-broken", "category-noop", "role-noop", "partial-delete", "selection-not-cleared", "wrong-delete", "unselected-mutated"])("EST103 rejects %s", (scenario) => {
    failure(multiselectFixture, "est-103-multiselect.ps1", scenario);
  });

  it("EST103 accepts persisted category IDs distinct from supply type labels and exact bulk outcomes", () => {
    const result = runPowerShell(multiselectFixture, { LEGACY_SOURCE_FILE: sourcePath("est-103-multiselect.ps1"), CASE: "success" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("EST-103 MULTISELECT PASS");
    expect(result.stdout).toContain("FIXTURE-CLEANUP");
  });

  it.each(["title-failure", "persist-failure", "api-failure"])("Add-Line propagates exhausted %s", (scenario) => {
    failure(addLineFixture, "common.ps1", scenario);
  });

  it.each(["success", "fallback-success"])("Add-Line accepts verified %s", (scenario) => {
    const result = runPowerShell(addLineFixture, { LEGACY_SOURCE_FILE: sourcePath("common.ps1"), CASE: scenario });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ADD-LINE PASS");
    expect(result.stdout).toContain("FIXTURE-CLEANUP");
  });
});
