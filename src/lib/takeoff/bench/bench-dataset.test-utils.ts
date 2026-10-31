import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

// Fictional takeoff bench dataset, built in a temporary directory for the
// isolated checks of `takeoff:bench:check`. Every title, identifier, quantity
// and label below is invented; the real dataset never enters a test.

export const FAKE_PLAN_PATH = path.resolve("docs/test-fixtures/fake-plan-lot-archi.pdf");

type Json = Record<string, unknown>;

export function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function blankPdf(label: string) {
  const document = await PDFDocument.create();
  document.setTitle(label);
  document.addPage([420, 297]);
  return document.save();
}

function fictionalWorkbook() {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8("<workbook><sheets><sheet name=\"Lot\"/></sheets></workbook>"),
    "xl/worksheets/sheet1.xml": strToU8("<worksheet/>"),
  });
}

function document(id: string, overrides: Json): Json {
  const [lot, kind] = id.split("-");
  return {
    id,
    lot,
    kind,
    drive_id: `fixture-drive-${id}`,
    original_title: `Fictional ${id}`,
    project: "Fictional project",
    file_type: "pdf",
    file_size: null,
    modified_time: "2026-01-06T10:00:00.000Z",
    raw_status: "binary",
    raw_path: `raw/${id}.pdf`,
    sha256: null,
    structure_check: { status: "passed", method: "pdfjs pages + %%EOF", detail: null },
    pages: 1,
    format: "A0",
    scale: "1/50",
    index: "A",
    vector: true,
    ocg_count: 0,
    level: null,
    zone: null,
    role: "truth",
    duplicate_of: null,
    notes: null,
    ...overrides,
  };
}

function line(overrides: Json): Json {
  return {
    kind: "network",
    zone: null,
    level: null,
    network: null,
    material: null,
    dn: null,
    organ: null,
    room: null,
    unit: "ml",
    quantity: 1,
    source: { document: "a-devis-01", sheet: "Lot", row: 1, text: "Fictional row" },
    observable_on_plan: true,
    ...overrides,
  };
}

export type FixtureDataset = {
  root: string;
  readJson(relativePath: string): Promise<Json>;
  writeJson(relativePath: string, value: unknown): Promise<void>;
  mutateJson(relativePath: string, mutate: (value: Json) => void): Promise<void>;
  /** Replaces a raw file; with `record`, the manifest takes its new size and hash. */
  replaceRaw(id: string, bytes: Uint8Array, options?: { record?: boolean }): Promise<void>;
  cleanup(): Promise<void>;
};

export async function createFixtureDataset(): Promise<FixtureDataset> {
  const root = await mkdtemp(path.join(os.tmpdir(), "takeoff-bench-fixture-"));
  await mkdir(path.join(root, "raw"));
  await mkdir(path.join(root, "truth", "pages"), { recursive: true });

  const raws: Record<string, Uint8Array> = {
    "a-plan-01": await readFile(FAKE_PLAN_PATH),
    "a-plan-02": await blankPdf("Fictional zone 2"),
    "a-devis-01": fictionalWorkbook(),
    "c-plan-01": await blankPdf("Fictional module plan"),
    "d-plan-01": await blankPdf("Fictional surfaces"),
    "load-plan-01": await blankPdf("Fictional load test"),
  };

  const documents: Json[] = [
    document("a-plan-01", { pages: 2, level: "R+1", zone: "Z1" }),
    document("a-plan-02", { level: "R+1", zone: "Z2", role: "reserve" }),
    document("a-devis-01", {
      file_type: "xlsx", raw_path: "raw/a-devis-01.xlsx", pages: null, format: null, scale: null,
      index: "0", vector: null, ocg_count: null, columns: ["Fictional Z1 column", "Fictional Z2 column"],
      structure_check: { status: "passed", method: "unzip -tq", detail: null },
    }),
    document("a-devis-02", {
      file_type: "xlsx", raw_status: "text_only", raw_path: null, file_size: 2048, pages: null,
      format: null, scale: null, index: "3", vector: null, ocg_count: null,
      structure_check: { status: "not_run", method: null, detail: "returned inline" },
    }),
    document("c-plan-01", { level: "R+1", zone: null, index: "B" }),
    document("c-devis-01", {
      file_type: "xlsx", raw_status: "text_only", raw_path: null, file_size: 4096, pages: null,
      format: null, scale: null, index: "V1", vector: null, ocg_count: null,
      structure_check: { status: "not_run", method: null, detail: "returned inline" },
    }),
    document("d-plan-01", { level: "RDC", scale: "1/100" }),
    document("e-plan-01", {
      raw_status: "failed", raw_path: null, file_size: 1_234_567, pages: null, role: "no_truth",
      structure_check: { status: "not_run", method: null, detail: null },
      notes: "Fictional failure: exceeded the persist byte limit.",
    }),
    document("load-plan-01", { role: "load_test", scale: null, index: null }),
    document("b-devis-01", {
      file_type: "xlsx", raw_status: "text_only", raw_path: null, file_size: 3072, pages: null,
      format: null, scale: null, index: "F1", vector: null, ocg_count: null,
      structure_check: { status: "not_run", method: null, detail: "returned inline" },
    }),
    // A truth plan whose download failed: its truth comes from a devis, so it is kept.
    document("b-plan-01", {
      raw_status: "failed", raw_path: null, file_size: 12_345_678, pages: null, level: "R+1", zone: "Z1",
      structure_check: { status: "not_run", method: null, detail: null },
      notes: "Fictional failure: over the connector size limit.",
    }),
  ];
  for (const entry of documents) {
    const bytes = raws[entry.id as string];
    if (!bytes) continue;
    entry.file_size = bytes.length;
    entry.sha256 = sha256(bytes);
    await writeFile(path.join(root, entry.raw_path as string), bytes);
  }

  const files: Record<string, unknown> = {
    "manifest.json": { schema_version: 1, documents },
    "truth/a-plan-01.json": {
      schema_version: 1, lot: "a", scope: "document", documents: ["a-plan-01"],
      source_document: "a-devis-01", rules: "Fictional rule: one line per devis key.",
      lines: [
        line({ zone: "Z1", level: "R+1", network: "EF", material: "cuivre", dn: "DN 22", quantity: 12.5,
          source: { document: "a-devis-01", sheet: "Lot", row: 4, text: "Fictional copper 20/22" } }),
        line({ kind: "count", zone: "Z1", level: "R+1", network: "EF", dn: "DN 20", organ: "vanne",
          unit: "u", quantity: 3, source: { document: "a-devis-01", sheet: "Lot", row: 5, text: "Fictional valve" } }),
        line({ zone: "Z1", level: "R+1", network: "EV", material: "pvc", dn: "DN 100", quantity: 6,
          observable_on_plan: false, plan_cause: "vertical",
          source: { document: "a-devis-01", sheet: "Lot", row: 6, text: "Fictional riser" } }),
      ],
    },
    "truth/a-plan-02.json": {
      schema_version: 1, lot: "a", scope: "document", documents: ["a-plan-02"],
      source_document: "a-devis-01", rules: "Fictional rule: reserve plan.",
      lines: [
        line({ zone: "Z2", level: "R+1", network: "ECS", material: "inox-316l", dn: "DN 22", quantity: 8,
          source: { document: "a-devis-01", sheet: "Lot", row: 7, text: "Fictional stainless 22x1,2" },
          additional_sources: [{ document: "a-devis-01", sheet: "Lot", row: 8, text: "Fictional same key" }] }),
      ],
    },
    "truth/b-plan-01.json": {
      schema_version: 1, lot: "b", scope: "document", documents: ["b-plan-01"],
      source_document: "b-devis-01", rules: "Fictional rule: one line per devis key.",
      lines: [
        line({ zone: "Z1", level: "R+1", network: "HW-S", material: "acier-noir", dn: "DN 50", quantity: 7,
          source: { document: "b-devis-01", sheet: "Lot", row: 2, text: "Fictional black steel 50" } }),
      ],
    },
    "truth/c-plan-01.json": {
      schema_version: 1, lot: "c", scope: "document", documents: ["c-plan-01"],
      source_document: "c-devis-01", rules: "Fictional rule: module lines divided, common lines kept.",
      modules_on_plan: 2, modules_on_plan_source: "Fictional title block",
      lines: [
        line({ level: "R+1", network: "CHW-S", material: "inox-316l", dn: "DN 100", quantity: 10,
          devis_quantity: 60, devis_modules: 12, module_scope: "module", phase: "atelier",
          source: { document: "c-devis-01", sheet: "Modules", row: 10, text: "Fictional workshop spool" } }),
        line({ level: "R+1", network: "CHW-S", material: "inox-316l", dn: "DN 100", quantity: 4,
          devis_quantity: 24, devis_modules: 12, module_scope: "module", phase: "chantier",
          source: { document: "c-devis-01", sheet: "Modules", row: 11, text: "Fictional site run" } }),
        line({ kind: "count", level: "R+1", network: "CHW-S", dn: "DN 100", organ: "vanne", unit: "u",
          quantity: 4, devis_quantity: 24, devis_modules: 12, module_scope: "module", phase: "atelier",
          source: { document: "c-devis-01", sheet: "Modules", row: 12, text: "Fictional valves" } }),
        line({ level: "R+1", network: "CHW-R", material: "inox-316l", dn: "DN 150", quantity: 30,
          devis_quantity: 30, module_scope: "commun", phase: "chantier",
          source: { document: "c-devis-01", sheet: "Modules", row: 13, text: "Fictional header" } }),
        line({ kind: "count", level: "R+1", network: "CHW-S", organ: "purgeur", unit: "u", quantity: null,
          devis_quantity: 5, devis_modules: 12, module_scope: "module", phase: "chantier",
          ambiguous: true, ambiguity_reason: "Fictional: 5 x 2 / 12 is not a whole count.",
          source: { document: "c-devis-01", sheet: "Modules", row: 14, text: "Fictional vents" } }),
      ],
    },
    "truth/d-plan-01.json": {
      schema_version: 1, lot: "d", scope: "document", documents: ["d-plan-01"],
      source_document: "d-plan-01", rules: "Fictional rule: printed room areas.",
      lines: [
        line({ kind: "surface", level: "RDC", room: "Fictional office", unit: "m2", quantity: 12.34,
          source: { document: "d-plan-01", sheet: null, row: null, page: 1, text: "Fictional office 12.34 m2" } }),
      ],
    },
    "truth/noise.json": {
      schema_version: 1, status: "measured", reason: null,
      baseline_document: "a-devis-01", comparison_document: "a-devis-02",
      documents: ["a-plan-01", "a-plan-02"], plan_index_same: true,
      rules: "Fictional rule: (comparison - baseline) / baseline per key.",
      keys: [
        { kind: "network", zone: "Z1", level: "R+1", network: "EF", material: "cuivre", dn: "DN 22",
          organ: null, room: null, unit: "ml", relative_deviation: 0.04, reason: null },
        { kind: "count", zone: "Z1", level: "R+1", network: "EF", material: null, dn: "DN 20",
          organ: "vanne", room: null, unit: "u", relative_deviation: null, reason: "Fictional: key absent from the comparison." },
      ],
    },
    "truth/pages/a-plan-01.json": {
      schema_version: 1, document: "a-plan-01",
      pages: [{ page: 1, type: "plan" }, { page: 2, type: "legend" }],
    },
  };

  async function writeJson(relativePath: string, value: unknown) {
    await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await writeFile(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`);
  }
  async function readJson(relativePath: string) {
    return JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as Json;
  }
  for (const [relativePath, value] of Object.entries(files)) await writeJson(relativePath, value);

  return {
    root,
    readJson,
    writeJson,
    async mutateJson(relativePath, mutate) {
      const value = await readJson(relativePath);
      mutate(value);
      await writeJson(relativePath, value);
    },
    async replaceRaw(id, bytes, options = {}) {
      const manifest = await readJson("manifest.json");
      const entry = (manifest.documents as Json[]).find((candidate) => candidate.id === id);
      if (!entry || typeof entry.raw_path !== "string") throw new Error(`No raw file for ${id}`);
      await writeFile(path.join(root, entry.raw_path), bytes);
      if (options.record) {
        entry.file_size = bytes.length;
        entry.sha256 = sha256(bytes);
        await writeJson("manifest.json", manifest);
      }
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
