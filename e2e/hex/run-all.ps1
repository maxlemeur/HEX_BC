Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tests = @(
  "ti-140-epic.ps1",
  "est-101-keyboard.ps1",
  "est-102-inline-edit.ps1",
  "est-103-multiselect.ps1",
  "ti-143-navigation.ps1",
  "ti-144-list.ps1",
  "ti-145-create.ps1",
  "ti-146-parameters.ps1",
  "ti-147-editor.ps1",
  "ti-148-calculations.ps1",
  "ti-149-duplicate.ps1",
  "ti-182-assemblies.ps1",
  "ti-150-status.ps1",
  "ti-151-print.ps1",
  "ti-152-export.ps1",
  "ti-153-suggestions.ps1",
  "ti-141-db-rls.ps1",
  "ti-142-types.ps1"
)

$failures = @()
foreach ($test in $tests) {
  $path = Join-Path $root $test
  $testSession = "e2e-hex-$PID-$($test -replace '\.ps1$', '')"
  $env:E2E_SESSION = $testSession
  try {
    & $path
  } catch {
    $failures += $test
    Write-Host "FAIL ${test}: $($_.Exception.Message)"
  } finally {
    Remove-Item Env:E2E_SESSION -ErrorAction SilentlyContinue
  }
}

if ($failures.Count -gt 0) {
  throw "E2E failures: $($failures -join ', ')"
}

Write-Host "All HEX E2E scripts passed."
