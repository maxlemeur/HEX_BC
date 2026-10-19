// File-boundary regression defined before the public corpus and consumer changes.
// Reads the exact application inputs; this is not browser/persistence qualification.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { normalizeMappedRowsForEstimateCreation } from "../../../src/lib/affaires/import-flow";
import { detectPriceBookProfile, suggestPriceBookColumnMappingForProfile, validatePriceBookRows } from "../../../src/lib/catalogue/csv-import";
import { detectImportProfile, normalizeProfileHeader } from "../../../src/lib/imports/optima-profile";
import { parseImportFile } from "../../../src/lib/imports/parser";

const originals = process.argv.includes("--reject-originals");
const base = path.resolve("e2e/fixtures/business");
const lots = [
  { key: "HYDRAULIQUE", file: "optima-hydraulique-fictif.xlsx", priced: 785, sections: 130, items: 2030,
    withoutQuantity: 46, statuses: { priced: 1821, out_of_scope: 61, included: 10, not_priced: 7, for_memory: 1 },
    totals: [7_161_553, 6_729_803, 5_508_747] },
  { key: "PLOMBERIE", file: "optima-plomberie-fictif.xlsx", priced: 656, sections: 231, items: 1050,
    withoutQuantity: 24, statuses: { priced: 737, out_of_scope: 74, not_priced: 4, not_applicable: 3, for_memory: 1 },
    totals: [5_974_745, 5_614_445, 4_595_840] },
];

async function main() {
  for (const lot of lots) {
    const file = originals ? path.resolve(`docs/prd_file/exemple chiffrage OPTIMA/BEING - DPGF ${lot.key}.xlsx`) : path.join(base, lot.file);
    const bytes = await readFile(file);
    const parsed = await parseImportFile(new File([bytes], path.basename(file)));
    const profile = detectImportProfile(parsed.headers);
    assert.equal(profile?.id, "optima", "OPTIMA header profile must survive export");
    const mapped = parsed.rows.map((raw, index) => ({
      id: `fixture-${index}`,
      payload: { row_index: index, raw_row: raw, mapped_row: Object.fromEntries(
        Object.entries(profile!.mapping).filter(([, target]) => target).map(([source, target]) => [target,
          raw[parsed.headers.find((header) => normalizeProfileHeader(header) === normalizeProfileHeader(source))!]])
      ) },
    }));
    // No cell text is included in a failure; reject any non-public designation before upload.
    const titles = parsed.rows.map((row) => String(row.Designation ?? "")).filter(Boolean);
    assert.ok(titles.every((title) => /^(?:Section|Ligne|Statut|Réserve|Sous-total|Total) ficti[fv]/u.test(title)),
      "Input is not the declared wholly fictitious public corpus");
    const results = [[1.3, 1.3], [1.3, 1.2], [1, 1]].map(([fo, mo]) => normalizeMappedRowsForEstimateCreation(mapped,
      { marginMultiplier: 1, defaultTaxRateBp: 2000, entry: "preview", engine: 3,
        saleCoefficientFo: fo, saleCoefficientMo: mo,
        laborRole: { id: "00000000-0000-4000-8000-000000000000", hourlyRateCents: 4000 } },
      { detectStructure: true }));
    const result = results[0]!;
    assert.equal(result.validItems.length, lot.items, "full item volume");
    assert.equal(result.validSections.length, lot.sections, "bold section hierarchy");
    assert.equal(result.invalidLines.length, 0, "no generated row may be lost as invalid");
    assert.equal(result.validLines.filter((line) => line.quantity > 0 && line.puHtCents > 0).length, lot.priced);
    assert.deepEqual(result.validLines.reduce<Record<string, number>>((counts, line) => {
      const status = line.pricingStatus!; counts[status] = (counts[status] ?? 0) + 1; return counts;
    }, {}), lot.statuses);
    assert.equal(result.validLines.filter((line) => line.pricingStatus !== "priced" && !line.quantity).length, lot.withoutQuantity);
    assert.ok(result.validItems.every((item) => typeof item.sourceMetadata.source_row_number === "number"));
    assert.equal(result.unitPriceChecks.length, lot.priced, "all priced lines have cached controls");
    assert.ok(result.unitPriceChecks.every((check) => check.deltaCents === 0),
      "every cached workbook unit-price control must match");
    assert.deepEqual(results.map((pass) => pass.validLines.reduce((sum, line) => sum + line.lineTotalHtCents, 0)), lot.totals,
      "literal independent totals at workbook, offer and cost coefficients");
    console.log(`${lot.key}: fictitious file, ${lot.items} entries, ${lot.priced} priced lines, ${lot.sections} sections, exact totals OK`);
  }
  const file = path.join(base, "bdc-fictif.csv");
  const bytes = await readFile(file);
  assert.ok(bytes.includes(0xc9) && !bytes.includes(Buffer.from("É", "utf8")), "Windows-1252 accent bytes");
  const parsed = await parseImportFile(new File([bytes], "bdc-fictif.csv", { type: "text/csv" }));
  assert.equal(parsed.rows.length, 539);
  const rows = parsed.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? "")])));
  const profile = detectPriceBookProfile(parsed.headers);
  assert.equal(profile, "mm_bdc");
  const checked = await validatePriceBookRows(rows, suggestPriceBookColumnMappingForProfile(parsed.headers, profile),
    { profile, lookups: { suppliers: [], products: [] } });
  assert.equal(checked.ignoredRows.length, 412);
  assert.equal(checked.rejectedRows.length, 127);
  assert.equal(checked.acceptedItems.length, 0);
  console.log("BDC: Windows-1252, 539 rows, 127 unresolved supplier prices, 412 ignored OK");
}

main().catch((error: unknown) => {
  // Assertion diagnostics must not echo original values/cells in the red run.
  console.error(error instanceof Error ? error.message : "Corpus verification failed");
  process.exitCode = 1;
});
