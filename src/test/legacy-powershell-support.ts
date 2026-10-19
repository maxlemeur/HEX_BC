import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

const executable = process.env.LEGACY_PWSH_PATH ?? "pwsh";
const probe = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
  encoding: "utf8",
  timeout: 10_000,
  // Match the fixtures' isolated environment. Inheriting the user's HOME made
  // this portable runtime crash in .NET startup before any script was loaded.
  env: { NODE_ENV: "test", PATH: process.env.PATH },
});
if (process.env.LEGACY_PWSH_PATH && (probe.error || probe.status !== 0)) {
  throw new Error(`Configured PowerShell runtime failed: ${probe.error?.message ?? probe.stderr}`);
}

export const hasPowerShell = !probe.error && probe.status === 0;
export const powerShellVersion = probe.stdout?.trim();

// These tests execute the real PowerShell control flow with isolated browser
// boundaries. Browser E2E cannot expose a test script swallowing its own failures.
export function runPowerShell(source: string, variables: Record<string, string> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mergeone-legacy-assertions-"));
  try {
    const fixture = path.join(directory, "case.ps1");
    fs.writeFileSync(fixture, "$ErrorActionPreference = 'Stop'\n$PSStyle.OutputRendering = 'PlainText'\n" + source);
    const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", fixture], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10_000,
      env: { NODE_ENV: "test", PATH: process.env.PATH, DOTNET_CLI_HOME: directory, ...variables },
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: stripVTControlCharacters(result.stdout), stderr: stripVTControlCharacters(result.stderr) };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// Parse the actual source rather than matching its text or copying its checks.
// Definitions load in the caller's scope; helpers that touch the browser are
// replaced by each fixture before invoking the unchanged top-level try/finally.
export const loadLegacySource = `
$tokens = $null
$parseErrors = $null
$legacyAst = [System.Management.Automation.Language.Parser]::ParseFile($env:LEGACY_SOURCE_FILE, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
foreach ($statement in $legacyAst.EndBlock.Statements) {
  if ($statement -is [System.Management.Automation.Language.FunctionDefinitionAst]) {
    . ([scriptblock]::Create($statement.Extent.Text))
  }
}
$legacyMain = @($legacyAst.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.TryStatementAst] })
if ($legacyMain.Count -ne 1) { throw 'Expected one top-level legacy try/finally.' }
`;

export const invokeLegacyMain = "& ([scriptblock]::Create($legacyMain[0].Extent.Text))";
