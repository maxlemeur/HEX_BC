param(
  [string]$Suite = "quick",
  [switch]$ListSuites,
  [object]$ContinueOnFailure = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. "$PSScriptRoot/suites.ps1"

function ConvertTo-Bool {
  param([object]$Value)

  if ($Value -is [bool]) {
    return $Value
  }
  if ($null -eq $Value) {
    return $false
  }

  $normalized = "$Value".Trim().ToLowerInvariant()
  if (@("1", "true", "yes", "on").Contains($normalized)) {
    return $true
  }
  if (@("0", "false", "no", "off").Contains($normalized)) {
    return $false
  }

  throw "Invalid value for ContinueOnFailure: '$Value'. Use true/false or 1/0."
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$suites = Get-HexSuites
$continueOnFailureFlag = ConvertTo-Bool -Value $ContinueOnFailure

if ($ListSuites) {
  Write-Host "Available HEX suites:"
  foreach ($suiteName in $suites.Keys) {
    $count = @($suites[$suiteName]).Count
    Write-Host "- $suiteName ($count tests)"
  }
  return
}

$suiteKey = $Suite.ToLowerInvariant()
if (-not $suites.Contains($suiteKey)) {
  throw "Unknown suite '$Suite'. Use -ListSuites to see available suites."
}

$tests = @($suites[$suiteKey])
if ($tests.Count -eq 0) {
  throw "Suite '$suiteKey' does not contain any tests."
}

$missingTests = @()
foreach ($test in $tests) {
  $path = Join-Path $root $test
  if (-not (Test-Path $path)) {
    $missingTests += $test
  }
}
if ($missingTests.Count -gt 0) {
  throw "Suite '$suiteKey' references missing test files: $($missingTests -join ', ')"
}

Write-Host "Running HEX suite '$suiteKey' ($($tests.Count) tests, ContinueOnFailure=$continueOnFailureFlag)"

$failures = @()
$index = 0
$total = $tests.Count

foreach ($test in $tests) {
  $index += 1
  $path = Join-Path $root $test
  $testSession = "e2e-hex-$PID-$($suiteKey)-$($test -replace '\.ps1$', '')"
  $env:E2E_SESSION = $testSession
  Write-Host "[$index/$total] $test"

  try {
    & $path
    Write-Host "PASS $test"
  } catch {
    $errorMessage = $_.Exception.Message
    $failures += [pscustomobject]@{
      Test = $test
      Error = $errorMessage
    }
    Write-Host "FAIL ${test}: $errorMessage"
    if (-not $continueOnFailureFlag) {
      throw "Suite '$suiteKey' stopped on first failure: $test"
    }
  } finally {
    Remove-Item Env:E2E_SESSION -ErrorAction SilentlyContinue
  }
}

if ($failures.Count -gt 0) {
  Write-Host ""
  Write-Host "HEX suite '$suiteKey' failed on $($failures.Count) test(s):"
  foreach ($failure in $failures) {
    Write-Host "- $($failure.Test): $($failure.Error)"
  }
  throw "E2E suite '$suiteKey' failures: $($failures.Test -join ', ')"
}

Write-Host "HEX suite '$suiteKey' passed ($total/$total)."
