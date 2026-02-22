param(
  [string]$BaseUrl,
  [string]$Session
)

. "$PSScriptRoot/common.ps1"

$config = Get-HexConfig -BaseUrl $BaseUrl -Session $Session
$BaseUrl = $config.BaseUrl
$Session = $config.Session

Require-AgentBrowser

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$project = "E2E-HEX-TI152-$stamp"
$tempDir = Get-E2ETempDir
$xlsxPath = Join-Path $tempDir "ti-152-$stamp.xlsx"
$csvPath = Join-Path $tempDir "ti-152-$stamp.csv"

try {
  Login-E2E -BaseUrl $BaseUrl -Session $Session

  $versionId = New-Estimate -BaseUrl $BaseUrl -Session $Session -Project $project -Title "E2E TI-152" -Date "2026-02-02" -Validite "30"
  Go-EditorTab -Session $Session
  Add-Chapter -Session $Session -Title "Chapitre 1"
  Add-Line -Session $Session -Designation "Planches bois"
  Set-LineValues -Session $Session -Quantity "2" -Unit "m2" -PriceFo "100" -TypeFo "Materiaux" -Kfo "1.2" -HoursMo "3" -Kmo "0.5"

  try {
    Click-FirstEnabledButtonByText -Session $Session -ButtonText "Exporter" -ScopeSelector "main"
  } catch {
    Invoke-AB $Session "find" "role" "button" "click" "--name" "Exporter" | Out-Null
  }
  Invoke-AB $Session "download" "text=Excel (.xlsx)" $xlsxPath
  try {
    Click-FirstEnabledButtonByText -Session $Session -ButtonText "Exporter" -ScopeSelector "main" | Out-Null
  } catch {
    Invoke-AB $Session "find" "role" "button" "click" "--name" "Exporter" | Out-Null
  }
  try {
    Invoke-AB $Session "download" "text=Fichier CSV (.csv)" $csvPath
  } catch {
    Invoke-AB $Session "download" "text=CSV (.csv)" $csvPath
  }

  if (-not (Test-Path $xlsxPath)) { throw "Missing Excel export" }
  if (-not (Test-Path $csvPath)) { throw "Missing CSV export" }

  $verificationJson = & node -e @"
const fs = require('fs');
const xlsx = require('xlsx');

const xlsxPath = process.argv[1];
const csvPath = process.argv[2];
const requiredSupplierHeaders = ['Fournisseur 1', 'Fournisseur 2', 'Fournisseur 3'];

const workbook = xlsx.readFile(xlsxPath);
if (!workbook.SheetNames.includes('Recap') || !workbook.SheetNames.includes('Lignes')) {
  throw new Error('missing_expected_sheets');
}

const linesSheet = workbook.Sheets['Lignes'];
const excelRows = xlsx.utils.sheet_to_json(linesSheet, { header: 1, defval: '' });
const excelHeaders = Array.isArray(excelRows[0])
  ? excelRows[0].map((value) => String(value).trim())
  : [];
const missingExcelHeaders = requiredSupplierHeaders.filter(
  (header) => !excelHeaders.includes(header)
);
if (missingExcelHeaders.length > 0) {
  throw new Error('missing_excel_headers:' + missingExcelHeaders.join(','));
}

const excelSupplierIndexes = requiredSupplierHeaders.map(
  (header) => excelHeaders.indexOf(header)
);
const excelHasSupplierValues = excelRows.slice(1).some((row) => {
  return excelSupplierIndexes.some((index) => {
    const value = Array.isArray(row) ? row[index] : '';
    return String(value ?? '').trim().length > 0;
  });
});

const csvRaw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const csvRows = csvRaw
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter((line) => line.length > 0);
const csvHeaders = (csvRows[0] ?? '').split(';').map((value) => value.trim());
const missingCsvHeaders = requiredSupplierHeaders.filter(
  (header) => !csvHeaders.includes(header)
);
if (missingCsvHeaders.length > 0) {
  throw new Error('missing_csv_headers:' + missingCsvHeaders.join(','));
}

const csvSupplierIndexes = requiredSupplierHeaders.map(
  (header) => csvHeaders.indexOf(header)
);
const csvHasSupplierValues = csvRows.slice(1).some((line) => {
  const columns = line.split(';');
  return csvSupplierIndexes.some((index) => String(columns[index] ?? '').trim().length > 0);
});

process.stdout.write(
  JSON.stringify({
    excelHasSupplierValues,
    csvHasSupplierValues,
  })
);
"@ $xlsxPath $csvPath
  if ($LASTEXITCODE -ne 0) {
    throw "Export validation failed (sheets or supplier columns missing)."
  }

  $verification = $verificationJson | ConvertFrom-Json
  if (-not $verification.excelHasSupplierValues -and -not $verification.csvHasSupplierValues) {
    Write-Host "TI-152 WARN: colonnes fournisseur presentes mais vides sur cette fixture."
  }

  Write-Host "TI-152 PASS"
} finally {
  Close-AgentBrowser -Session $Session
}
