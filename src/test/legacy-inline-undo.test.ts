import path from "node:path";

import { describe, expect, it } from "vitest";

import { hasPowerShell, invokeLegacyMain, loadLegacySource, runPowerShell } from "./legacy-powershell-support";

const common = `
function Login-E2E {}
function New-Estimate { return 'fixture-version' }
function Go-EditorTab {}
function Add-Chapter {}
function Open-EstimateEdit {}
function Start-Sleep {}
function Close-AgentBrowser { Write-Host 'LEGACY_CLEANUP' }
$Session = 'isolated-assertion-fixture'
$BaseUrl = 'http://127.0.0.1'
$project = 'assertion-fixture'
`;

const undoFixture = loadLegacySource + common + `
function Add-LineSafe {}
function Set-LineQuantityByIndex {}
function Click-UndoButton {}
function Click-RedoButton {}
function Click-DeleteLineByIndex {}
function Set-LineSelection {}
function Apply-BulkMajoration {}
function Try-ReorderFirstLineDown {}
function Invoke-AB {}
function Get-LineCount { return 3 }
function Get-LineState { return @{ lines = @(@{ quantity = 3; majoration = 150 }) } }
$script:titleReads = 0
function Get-TitleOrder {
  $script:titleReads++
  if ($env:LEGACY_FAULT -eq 'delete-position' -and $script:titleReads -eq 2) { return @('wrong', 'order') }
  return @('L1', 'L2', 'L3')
}
function Wait-Until {
  param($Predicate, $TimeoutMessage, $TimeoutSeconds)
  Write-Host "CHECK:$TimeoutMessage"
  if ($env:LEGACY_FAULT -eq $TimeoutMessage) { throw "INJECTED: $TimeoutMessage" }
}
` + invokeLegacyMain;

const inlineFixture = loadLegacySource + common + `
function Add-Line {}
function Set-LineValues { if ($env:LEGACY_FAULT -eq 'numeric-fixture') { throw 'INJECTED: numeric fixture' } }
function Initialize-InlineSelectors {
  if ($env:LEGACY_FAULT -eq 'inline-fixture') { throw 'INJECTED: inline fixture' }
  return @{ titleCellId = 'line::title'; unitPriceCellId = 'line::unit_price'; lastEditableCellId = 'line::k_mo'; puCellId = 'line::pu_ht'; totalCellId = 'line::line_total_ht' }
}
function Set-CellInputValue {}
function Wait-ForFormattedPrice { return '1 234,50' }
$script:lastKey = ''
$script:tabs = 0
function Get-ActiveInlineTarget {
  param($Session, $PuCellId, $TotalCellId)
  $script:tabs++
  if ($script:tabs -eq 1) {
    if ($env:LEGACY_FAULT -eq 'skipped-pu') { return 'total-cell' }
    return 'pu-input'
  }
  if ($env:LEGACY_FAULT -eq 'total-tab') { return 'next-row' }
  return 'total-cell'
}
function Invoke-AB {
  param($Session, $Action, $Payload)
  if ($Action -eq 'press') { $script:lastKey = $Payload; return }
  if ($Action -ne 'eval') { return }
  if ($Payload -like '*readOnly*' -or $Payload -like '*aria-readonly*') {
    if ($env:LEGACY_FAULT -eq 'readonly-marker') { return 'false' }
    return 'true'
  }
  if ($Payload -like '*input?.disabled*') {
    if ($env:LEGACY_FAULT -eq 'disabled-pu') { return 'true' }
    return 'false'
  }
  if ($Payload -like '*textContent*') { return '10,00' }
  if ($Payload -like '*document.activeElement ===*') { return 'true' }
  if ($Payload -like '*selectionStart*') { return '0' }
  if ($Payload -like '*selectionEnd*' -or $Payload -like '*.length)*') { return '10' }
  if ($Payload -like 'document.querySelector*') {
    if ($Payload -like '*inline-pu-input*') {
      if ($env:LEGACY_FAULT -eq 'readonly-value' -and $script:lastKey -eq '9') { return '9' }
      return '12,00'
    }
    if ($script:lastKey -eq 'N') {
      if ($env:LEGACY_FAULT -eq 'select-all') { return 'RN' }
      return 'N'
    }
    if ($script:lastKey -eq 'Control+z' -and $env:LEGACY_FAULT -eq 'undo-value') { return 'N' }
    if ($env:LEGACY_FAULT -eq 'replacement' -and $script:lastKey -eq 'R') { return 'ANCIENNE VALEURR' }
    return 'R'
  }
}
` + invokeLegacyMain;

function runJourney(file: string, source: string, fault = "") {
  return runPowerShell(source, { LEGACY_SOURCE_FILE: path.resolve("e2e/hex", file), LEGACY_FAULT: fault });
}

// Faults originate at real validation boundaries, not from matching source text.
// Browser correctness remains the job of the real editor journeys. These cases
// prove that failed checks cannot be swallowed by their own script's catches.
describe.skipIf(!hasPowerShell)("legacy editor assertion propagation", () => {
  it.each([
    "Quantity patch was not applied.",
    "Undo should restore patched line quantity.",
    "Undo should restore deleted line count.",
    "Redo should delete the same line again.",
    "Undo should restore lines before bulk action checks.",
    "Bulk majoration should set first line majoration to 150.",
    "Undo should rollback bulk majoration.",
    "Redo should reapply bulk majoration.",
    "Expected line order to change after reorder.",
    "Undo should restore line order before reorder.",
    "Redo should reapply reordered line order.",
    "Line order should remain stable after refresh.",
  ])("propagates undo/redo validation failure: %s", (fault) => {
    const result = runJourney("est-106-undo-redo.ps1", undoFixture, fault);
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stderr).toContain(`INJECTED: ${fault}`);
    expect(result.stdout).not.toContain("EST-106 UNDO REDO PASS");
    expect(result.stdout.match(/LEGACY_CLEANUP/gu)).toHaveLength(1);
  });

  it("keeps the exact restored-line order assertion fatal", () => {
    const result = runJourney("est-106-undo-redo.ps1", undoFixture, "delete-position");
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stderr).toContain("Deleted line should be restored at original position after undo.");
    expect(result.stdout).not.toContain("EST-106 UNDO REDO PASS");
    expect(result.stdout.match(/LEGACY_CLEANUP/gu)).toHaveLength(1);
  });

  it("completes every undo/redo validation boundary when none fails", () => {
    const result = runJourney("est-106-undo-redo.ps1", undoFixture);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("EST-106 UNDO REDO PASS");
    expect(result.stdout).toContain("CHECK:Line order should remain stable after refresh.");
    expect(result.stdout.match(/LEGACY_CLEANUP/gu)).toHaveLength(1);
  });

  it.each([false, true])("requires the fallback-added line title (fails=%s)", (fails) => {
    const fixture = loadLegacySource + `
$script:count = 3
function Get-LineCount { return $script:count }
function Add-Line { throw 'Use the verified setup fallback' }
function Try-ClickButtonByLabels { $script:count = 4; return $true }
function Wait-Until { param($Predicate, $TimeoutMessage, $TimeoutSeconds); if (-not (& $Predicate)) { throw $TimeoutMessage } }
function Set-LineTitleByIndex {
  if ($env:LEGACY_FAULT -eq 'title') { throw 'INJECTED: fallback line title' }
  Write-Host 'TITLE_SET'
}
Add-LineSafe -Session fixture -Designation 'expected title'
`;
    const result = runJourney("est-106-undo-redo.ps1", fixture, fails ? "title" : "");
    if (fails) {
      expect(result.status, result.stdout + result.stderr).not.toBe(0);
      expect(result.stderr).toContain("INJECTED: fallback line title");
    } else {
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain("TITLE_SET");
    }
  });

  it.each([
    ["numeric-fixture", "INJECTED: numeric fixture"],
    ["inline-fixture", "INJECTED: inline fixture"],
    ["readonly-marker", "PU input should expose its read-only state"],
    ["disabled-pu", "PU input should remain enabled"],
    ["replacement", "Typing should replace the cell value"],
    ["select-all", "Ctrl+A typing should replace the active cell value"],
    ["undo-value", "Ctrl+Z should undo local edit in active cell"],
    ["readonly-value", "PU readonly cell should remain non editable"],
    ["skipped-pu", "Keyboard navigation should reach readonly PU cell"],
    ["total-tab", "Keyboard navigation should reach readonly total cell"],
  ])("propagates an inline editor failure: %s", (fault, diagnostic) => {
    const result = runJourney("est-102-inline-edit.ps1", inlineFixture, fault);
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stderr).toContain(diagnostic);
    expect(result.stdout).not.toContain("EST-102 INLINE EDIT PASS");
    expect(result.stdout.match(/LEGACY_CLEANUP/gu)).toHaveLength(1);
  });

  it("accepts the valid inline path and still runs cleanup", () => {
    const result = runJourney("est-102-inline-edit.ps1", inlineFixture);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("EST-102 INLINE EDIT PASS");
    expect(result.stdout.match(/LEGACY_CLEANUP/gu)).toHaveLength(1);
  });
});
