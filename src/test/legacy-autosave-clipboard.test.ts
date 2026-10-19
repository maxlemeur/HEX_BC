import path from "node:path";

import { describe, expect, it } from "vitest";

import { hasPowerShell, invokeLegacyMain, loadLegacySource, runPowerShell } from "./legacy-powershell-support";

// These real PowerShell scripts can catch their own failed assertions and still
// report PASS, which a product-browser journey cannot expose. Browser I/O and
// polling are fixture boundaries; the parsed production try/finally, predicates
// and assertions execute unchanged, including cleanup after a failure.
const boundaries = `
$BaseUrl = 'http://localhost:3107'
$Session = 'isolated-fixture'
$project = 'isolated-fixture'
function Login-E2E {}
function New-Estimate { 'fixture-version' }
function Go-EditorTab {}
function Add-Chapter {}
function Add-Line {}
function Close-AgentBrowser { [Console]::WriteLine('FIXTURE_CLEANED') }
function Wait-Until {
  param([scriptblock]$Predicate, [string]$TimeoutMessage, [int]$TimeoutSeconds, [int]$PollMilliseconds)
  if (-not (& $Predicate)) { throw $TimeoutMessage }
}
`;

function autosave(scenario: string) {
  return runPowerShell(`${loadLegacySource}
${boundaries}
$initialLineTitle = 'Ligne EST-105 initiale'
$updatedLineTitle = 'Ligne EST-105 autosave fixture'
$script:edited = $false
function Install-AutosaveProbe {}
function Set-LastLineTitle {
  if ($env:LEGACY_CASE -eq 'missing-edit') { throw 'Last line title input is missing.' }
  $script:edited = $true
}
function Get-AutosaveBadgeSnapshot {
  if ($script:edited -and $env:LEGACY_CASE -eq 'missing-badge') {
    return [pscustomobject]@{ found = $false; text = ''; className = '' }
  }
  if ($script:edited -and $env:LEGACY_CASE -eq 'pending-badge') {
    return [pscustomobject]@{ found = $true; text = 'Synchronisation...'; className = 'status-badge status-sent' }
  }
  return [pscustomobject]@{ found = $true; text = 'Sauvegardé'; className = 'status-badge status-accepted' }
}
function Get-AutosaveProbeEvents {
  if ($env:LEGACY_CASE -eq 'fast-save') {
    return @([pscustomobject]@{ text = 'Sauvegardé'; className = 'status-accepted' })
  }
  return @(
    [pscustomobject]@{ text = 'Synchronisation...'; className = 'status-sent' },
    [pscustomobject]@{ text = 'Sauvegardé'; className = 'status-accepted' }
  )
}
function Invoke-AB { $true }
function Get-CurrentUrl { 'http://localhost:3107/dashboard/affaires' }
function Open-EstimateEdit {}
function Get-LineTitles {
  if ($env:LEGACY_CASE -eq 'stale-title') { return @($initialLineTitle) }
  return @($updatedLineTitle)
}
${invokeLegacyMain}`, {
    LEGACY_SOURCE_FILE: path.resolve("e2e/hex/est-105-autosave.ps1"),
    LEGACY_CASE: scenario,
  });
}

function clipboard(scenario: string) {
  return runPowerShell(`${loadLegacySource}
${boundaries}
$script:pasteConfirmed = $false
$script:dialogClosed = $false
$script:duplicateMapping = $false
function Open-PastePreviewFromText {}
function Get-LineCount {
  if ($script:pasteConfirmed -and $env:LEGACY_CASE -eq 'extra-inserted') { return 3 }
  if ($script:pasteConfirmed -and $env:LEGACY_CASE -ne 'not-inserted') { return 2 }
  return 1
}
function Get-PasteDialogState {
  return [pscustomobject]@{
    isOpen = (-not $script:dialogClosed -and $env:LEGACY_CASE -ne 'missing-dialog')
    badge = 'BDC'
    invalidReasonCount = 1
    duplicateWarning = $script:duplicateMapping
  }
}
function Invoke-AB {
  param($Session, $Command, $Script)
  if ($Script -match "mappingSelects\\[1\\].value = 'designation'") { $script:duplicateMapping = $true }
  if ($Script -match 'confirmButton.click\\(\\)') {
    $script:pasteConfirmed = $true
    if ($env:LEGACY_CASE -ne 'remaining-open') { $script:dialogClosed = $true }
  }
  if ($Script -match 'closeButton.click\\(\\)') { $script:dialogClosed = $true }
  if ($Script -match 'JSON.stringify' -and $Script -match 'input.estimate-input--title') {
    $inserted = if ($env:LEGACY_CASE -eq 'invalid-inserted') { 'Ligne invalide' } else { 'Porte coupe-feu' }
    return (@('Ligne initiale', $inserted) | ConvertTo-Json -Compress)
  }
  if ($Script -eq "window.__e2eCopiedTsv || ''") {
    if ($env:LEGACY_CASE -eq 'missing-tab') { return 'Ligne initiale' }
    return "Designation\`tQuantité\`nLigne initiale\`t1"
  }
  return $true
}
${invokeLegacyMain}`, {
    LEGACY_SOURCE_FILE: path.resolve("e2e/hex/est-104-clipboard.ps1"),
    LEGACY_CASE: scenario,
  });
}

describe.skipIf(!hasPowerShell)("legacy autosave assertions through real PowerShell", () => {
  it.each(["saved", "fast-save"])("accepts final saved state and exact reloaded title (%s)", (scenario) => {
    const result = autosave(scenario);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("EST-105 PASS");
    expect(result.stdout).toContain("FIXTURE_CLEANED");
  });

  it.each([
    ["missing-edit", "Last line title input is missing."],
    ["missing-badge", "Autosave badge should end on saved state"],
    ["pending-badge", "Autosave badge should end on saved state"],
    ["stale-title", "Edited line title should persist"],
  ])("rejects %s and still closes the browser boundary", (scenario, message) => {
    const result = autosave(scenario);
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(result.stdout).not.toContain("EST-105 PASS");
    expect(result.stdout).toContain("FIXTURE_CLEANED");
  });
});

describe.skipIf(!hasPowerShell)("legacy clipboard assertions through real PowerShell", () => {
  it("accepts paste preview, insertion and copied TSV", () => {
    const result = clipboard("copied-tsv");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("EST-104 CLIPBOARD PASS");
    expect(result.stdout).toContain("FIXTURE_CLEANED");
  });

  it.each([
    ["missing-dialog", "Paste dialog did not open."],
    ["not-inserted", "Expected pasted lines to be inserted."],
    ["missing-tab", "TSV"],
    ["remaining-open", "Paste preview dialog should close after confirm."],
    ["extra-inserted", "exactly one valid"],
    ["invalid-inserted", "valid pasted designation"],
  ])("rejects %s and still closes the browser boundary", (scenario, message) => {
    const result = clipboard(scenario);
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(result.stdout).not.toContain("EST-104 CLIPBOARD PASS");
    expect(result.stdout).toContain("FIXTURE_CLEANED");
  });
});
