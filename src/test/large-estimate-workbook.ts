import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeMappedRowsForEstimateCreation } from "@/lib/affaires/import-flow";
import { detectImportProfile, normalizeProfileHeader } from "@/lib/imports/optima-profile";
import { parseImportFile } from "@/lib/imports/parser";

const WORKBOOK = "e2e/fixtures/business/optima-hydraulique-fictif.xlsx";
const ROLE_ID = "29200000-0000-4000-8000-000000000301";
const uuid = (index: number) => `29300000-0000-4000-8000-${String(index).padStart(12, "0")}`;

/** Prepare only the owned runner's SQL input, from the exact public IO01 bytes. */
async function prepareLargeEstimateWorkbook(workdir: string, root = process.cwd()) {
  const bytes = await fs.readFile(path.join(root, WORKBOOK));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "e2e/fixtures/business/manifest.json"), "utf8")) as {
    files: Array<{ file: string; sha256: string }>;
  };
  assert.equal(sha256, manifest.files.find(file => file.file === path.basename(WORKBOOK))?.sha256,
    "The SQL probe must consume the pinned public IO01 workbook");
  const parsed = await parseImportFile(new File([bytes], path.basename(WORKBOOK)));
  const profile = detectImportProfile(parsed.headers);
  assert.equal(profile?.id, "optima");
  const mapped = parsed.rows.map((raw, index) => ({
    id: uuid(index + 1),
    payload: { row_index: index, raw_row: raw, mapped_row: Object.fromEntries(
      Object.entries(profile!.mapping).filter(([, target]) => target).map(([source, target]) => [target,
        raw[parsed.headers.find(header => normalizeProfileHeader(header) === normalizeProfileHeader(source))!]])
    ) },
  }));
  const result = normalizeMappedRowsForEstimateCreation(mapped, {
    marginMultiplier: 1, defaultTaxRateBp: 2000, entry: "preview", engine: 3,
    saleCoefficientFo: 1.3, saleCoefficientMo: 1.2,
    laborRole: { id: ROLE_ID, hourlyRateCents: 4000 },
  }, { detectStructure: true });
  assert.equal(result.invalidLines.length, 0);
  assert.equal(result.validItems.length, 2030);
  assert.equal(result.validSections.length, 130);
  assert.equal(result.validLines.length, 1900);
  assert.equal(result.validLines.filter(line => line.quantity > 0 && line.puHtCents > 0).length, 785);
  assert.equal(result.validLines.reduce((sum, line) => sum + line.lineTotalHtCents, 0), 6_729_803,
    "Independent public-corpus oracle at 1.30 / 1.20");

  const rootId = uuid(10_000);
  const items: Array<Record<string, unknown>> = [{ id: rootId, parent_id: null, item_type: "section", position: 1,
    title: "Import public OPTIMA", source_provider: "dpgf", source_file_name: path.basename(WORKBOOK),
    source_metadata: { import_id: uuid(20_000), kind: "import_root" } }];
  let levelOne = rootId;
  let levelTwo: string | null = null;
  result.validItems.forEach((item, index) => {
    const id = uuid(30_000 + index);
    const metadata = { ...item.sourceMetadata, import_id: uuid(20_000), mapping_id: uuid(20_001),
      mapped_row_id: item.mappedRowId, row_index: item.rowIndex };
    const base = { id, item_type: item.itemType, position: index + 1, title: item.title,
      source_provider: "dpgf", source_file_name: path.basename(WORKBOOK), source_page: item.sourcePage,
      source_metadata: metadata };
    if (item.itemType === "section") {
      items.push({ ...base, parent_id: item.level === 1 ? rootId : levelOne });
      if (item.level === 1) { levelOne = id; levelTwo = null; } else { levelTwo = id; }
    } else {
      items.push({ ...base, parent_id: levelTwo ?? levelOne, description: item.description,
        quantity: item.quantity, unit_price_ht_cents: item.unitPriceHtCents, tax_rate_bp: item.taxRateBp,
        k_fo: item.kFo, h_mo: item.hMo, h_mo_per_unit: item.hoursPerUnit ?? null,
        h_mo_majoration: item.hMoMajoration, k_mo: item.kMo, labor_role_id: item.laborRoleId ?? null,
        unit_code: item.unitCode ?? null, pricing_status: item.pricingStatus,
        pu_ht_cents: item.puHtCents, line_total_ht_cents: item.lineTotalHtCents,
        line_tax_cents: item.lineTaxCents, line_total_ttc_cents: item.lineTotalTtcCents });
    }
  });
  const json = JSON.stringify(items);
  const delimiter = `$workbook_${sha256}$`;
  assert(!json.includes(delimiter));
  const receipt = { source: WORKBOOK, sha256, items: items.length, sections: result.validSections.length + 1,
    lines: result.validLines.length, priced: 785, payloadSha256: createHash("sha256").update(json).digest("hex") };
  const directory = path.join(workdir, "supabase/tests/fixtures");
  await fs.writeFile(path.join(directory, "large-v3-workbook.sql"),
    `-- Owned input generated from ${WORKBOOK}; SHA-256 ${sha256}\n` +
    `create temporary table lb29_workbook as select ${delimiter}${json}${delimiter}::jsonb as items;\n` +
    `select diag('workbook fixture: ${JSON.stringify(receipt)}');\n`, { flag: "wx" });
  return receipt;
}

Promise.resolve().then(() => {
  assert(process.argv.length === 3 && process.argv[2], "Expected the owned runner workdir");
  return prepareLargeEstimateWorkbook(process.argv[2]);
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Workbook fixture preparation failed");
  process.exitCode = 1;
});
