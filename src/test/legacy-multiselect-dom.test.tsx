import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hasPowerShell, loadLegacySource, runPowerShell } from "./legacy-powershell-support";

afterEach(() => { document.body.innerHTML = ""; });

// Execute the actual browser script emitted by the real PowerShell function.
// A process-only fixture replacing Get-MultiSelectSnapshot cannot detect a
// stale DOM selector that treats today's role combobox as a native select.
describe.skipIf(!hasPowerShell)("legacy multiselect current DOM reader", () => {
  it.each(["combobox", "native-select"])("reads the role label from %s", (kind) => {
    const result = runPowerShell(`${loadLegacySource}
function Invoke-AB {
  param($Session, $Command, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Values)
  $source = $Values -join ' '
  [Console]::WriteLine('BROWSER_SCRIPT:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($source)))
  return '{}'
}
Get-MultiSelectSnapshot -Session 'isolated' | Out-Null`, {
      LEGACY_SOURCE_FILE: path.resolve("e2e/hex/est-103-multiselect.ps1"),
    });
    expect(result.status, result.stderr).toBe(0);
    const encoded = result.stdout.match(/BROWSER_SCRIPT:([^\r\n]+)/u)?.[1];
    expect(encoded).toBeTruthy();
    document.body.innerHTML = `<div class="estimate-row" data-estimate-item-id="line-a">
      <input class="estimate-input--title" value="Fixture line" />
      <div data-cell-id="line-a::supply_type"><input role="combobox" value="Acier" /></div>
      <div data-cell-id="line-a::labor_role">${kind === "combobox"
        ? '<input role="combobox" value="Ouvrier" />'
        : '<select><option value="role-id" selected>Ouvrier</option></select>'}</div>
    </div>`;
    const snapshot = JSON.parse(window.eval(Buffer.from(encoded!, "base64").toString("utf8"))) as {
      lines: Array<{ id?: string; supplyType: string; role: string }>;
    };
    expect(snapshot.lines[0]).toMatchObject({ supplyType: "Acier", role: "Ouvrier" });
  });
});
