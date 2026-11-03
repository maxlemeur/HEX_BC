import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFixtureDataset,
  FAKE_PLAN_PATH,
  pageTruth,
  type FixtureDataset,
} from "@/lib/takeoff/bench/bench-dataset.test-utils";
import { checkTakeoffBenchDataset, type BenchCheckResult } from "@/lib/takeoff/bench/check";

// Ways `takeoff:bench:check` could let a broken dataset through, written before
// the check (AGENTS.md). Each one is a case below, on a fictional dataset:
// - a byte changes but the size does not: only the SHA-256 sees it;
// - the decoded size differs from Drive's fileSize (truncated or padded download);
// - a truncated PDF or an undecoded base64 XLSX is recorded with its own size and
//   hash: only the structure check (header, %%EOF, ZIP central directory) sees it;
// - a PDF that pdfjs cannot open, or whose page count differs from the manifest
//   (page ranges and page truths are bounded by that count);
// - a workbook entry corrupted inside the archive (its CRC-32 no longer matches);
// - a raw file that cannot be read (permissions) aborts the report;
// - a binary is missing, or raw/ holds a file the manifest does not name (an
//   original title used as a file name);
// - a raw_path leaves raw/ or is not named after the anonymous id;
// - a truth file is out of schema (comma decimal, missing field, unknown field);
// - a network, material, organ, unit or DN outside the known keys;
// - an insulation cell priced in m² refused on its network line (the truth would
//   have to write another unit than the cell's), or a pipe length let through in m2;
// - a truth line or header refers to a document absent from the manifest, or to
//   another lot's devis, or to a plan the truth file does not cover;
// - a manifest header out of schema, or a duplicate_of that names no document;
// - the same key twice in a file, or one devis cell in two truth lines (a quantity
//   split between plans or counted twice), except a lot C module line;
// - a devis row with one column per zone: its two columns flagged as one cell, or
//   one column (or the whole row next to a column) used twice let through, or one
//   cell cited by letter in one file and by header in another;
// - a workbook row cited without its basis: a worksheet row and a record index of
//   the Drive text export differ as soon as the sheet has a blank row, so the
//   reviewer reads another row;
// - a text_only workbook cited by worksheet row, which no stored binary can show;
// - one workbook cited by worksheet row in one file and by Drive text record in
//   another: one cell gets two row numbers (a double count passes) and two cells
//   share one (a false conflict);
// - a row basis on a PDF source, which names a page;
// - plans that together claim more modules of a devis cell than the devis counts,
//   including through a truth that covers a plan and a schema at once;
// - the module exemption from the one-use-per-cell rule granted to a line with
//   no module allocation (lot C fields outside lot C, or modules_on_plan unknown);
// - a PDF source (or additional source) citing a page its document does not have;
// - a plan known to draw no module refused (modules_on_plan 0), or its module
//   lines let through with a quantity;
// - a module quantity that does not follow devis x modules_on_plan / devis_modules,
//   or a fractional count not flagged ambiguous;
// - a line zone or level outside its truth documents;
// - truth on a no_truth document, reserve and truth mixed in one file, a truth or
//   reserve plan left without truth;
// - a truth plan whose download failed: kept when a devis is its source (the
//   bench skips it), refused when its own text layer is the source;
// - a level truth that leaves out a zone of its level, a lot truth that leaves
//   out a plan of its lot;
// - an unscaled schema with lengths marked observable (rule 7), a sheet with
//   several scales that downstream code cannot tell from an unscaled one;
// - a raw quantity in noise.json, or no noise.json at all, or a measured noise
//   that compares a document with itself, or anything but two usable devis of
//   the noise plans' lot, or a noise whose covered documents are devis instead
//   of the plans or schemas held constant; workshop and site keys that differ
//   only by phase merged or refused as duplicates;
// - a missing manifest or invalid JSON stops the check instead of being reported;
// - only the first error is reported.
// Ways truth/groups (TI-662) could let a broken correspondence through, written
// before the tests:
// - a valid groups file with a page calibration is refused, or not counted in
//   summary.groupFiles;
// - a class that is neither a network code nor mur, cloison, fond, cotation,
//   texte or autre is accepted (the vector reading would drop it silently);
// - the same group of one page listed twice (two classes, one silently wins),
//   while one group id on two pages is a legitimate pair of entries;
// - a calibration for a page the document does not have, or two calibrations
//   for one page (one silently wins), or a calibration without a positive
//   denominator;
// - a groups file not named after its document, which the bench would load
//   for another document than the reviewer meant.

let dataset: FixtureDataset;

beforeEach(async () => {
  dataset = await createFixtureDataset();
});

afterEach(async () => {
  await dataset.cleanup();
});

function expectIssue(result: BenchCheckResult, file: string, pathPrefix: string, message: RegExp) {
  expect(result.ok).toBe(false);
  expect(result.errors).toContainEqual(expect.objectContaining({
    file,
    path: expect.stringMatching(new RegExp(`^${pathPrefix.replace(/[[\].]/g, "\\$&")}`)),
    message: expect.stringMatching(message),
  }));
}

describe("takeoff bench dataset check", () => {
  it("accepts a consistent fictional dataset", async () => {
    const result = await checkTakeoffBenchDataset(dataset.root);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      documents: 11,
      verifiedBinaries: 6,
      truthFiles: 5,
      truthLines: 11,
      noise: "measured",
      pageFiles: 5,
      groupFiles: 0,
      truthWithoutBinary: ["b-plan-01"],
    });
    expect(result.summary.lots.a).toEqual({ lines: 4, observable: 3 });
    expect(result.summary.lots.b).toEqual({ lines: 1, observable: 1 });
    expect(result.summary.lots.c).toEqual({ lines: 5, observable: 5 });
  });

  it("rejects one changed byte at the same size", async () => {
    const bytes = await readFile(FAKE_PLAN_PATH);
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    await dataset.replaceRaw("a-plan-01", bytes);
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "raw/a-plan-01.pdf", "", /sha-?256/i);
    expect(result.errors).toHaveLength(1);
  });

  it("rejects a size different from the Drive fileSize", async () => {
    const bytes = await readFile(FAKE_PLAN_PATH);
    await dataset.replaceRaw("a-plan-01", Buffer.concat([bytes, Buffer.from("\n")]));
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "raw/a-plan-01.pdf", "", /size/i);
  });

  it("rejects a truncated PDF even when the manifest records its size and hash", async () => {
    const bytes = await readFile(FAKE_PLAN_PATH);
    await dataset.replaceRaw("a-plan-01", bytes.subarray(0, bytes.length - 2_000), { record: true });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "raw/a-plan-01.pdf", "", /%%EOF/);
  });

  it.each([
    ["a-plan-01", "raw/a-plan-01.pdf", /%PDF/],
    ["a-devis-01", "raw/a-devis-01.xlsx", /ZIP|zip/],
  ])("rejects an undecoded base64 copy of %s", async (id, file, message) => {
    const original = await readFile(path.join(dataset.root, file));
    await dataset.replaceRaw(id, Buffer.from(original.toString("base64")), { record: true });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, file, "", message);
  });

  it("rejects a missing binary and a raw file the manifest does not name", async () => {
    await rm(path.join(dataset.root, "raw", "a-plan-02.pdf"));
    await writeFile(path.join(dataset.root, "raw", "Fictional original title.pdf"), "%PDF-1.4\n%%EOF\n");
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "raw/a-plan-02.pdf", "", /missing/i);
    expectIssue(result, "raw/Fictional original title.pdf", "", /not listed in the manifest/i);
  });

  it.each([
    ["../outside.pdf"],
    ["raw/Fictional original title.pdf"],
    ["raw/a-plan-01.xlsx"],
  ])("rejects raw_path %s", async (rawPath) => {
    await dataset.mutateJson("manifest.json", (manifest) => {
      (manifest.documents as Array<Record<string, unknown>>)[0].raw_path = rawPath;
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "manifest.json", "documents[0].raw_path", /raw\/a-plan-01\.pdf/);
  });

  it("rejects manifest entries out of schema or inconsistent with their status", async () => {
    await dataset.mutateJson("manifest.json", (manifest) => {
      const documents = manifest.documents as Array<Record<string, unknown>>;
      documents[1].sha256 = null;
      documents[2].id = "b-devis-01";
      documents[7].notes = null;
      documents[3].sha_256 = "typo";
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "manifest.json", "documents[1].sha256", /binary/);
    expectIssue(result, "manifest.json", "documents[2].id", /lot/);
    expectIssue(result, "manifest.json", "documents[7].notes", /failed/);
    expectIssue(result, "manifest.json", "documents[3]", /sha_256/);
  });

  it("rejects truth lines out of schema with their JSON paths", async () => {
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      const lines = truth.lines as Array<Record<string, unknown>>;
      lines[0].quantity = "12,5";
      delete lines[1].observable_on_plan;
      lines[2].unexpected = true;
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-01.json", "lines[0].quantity", /number/i);
    expectIssue(result, "truth/a-plan-01.json", "lines[1].observable_on_plan", /boolean/i);
    expectIssue(result, "truth/a-plan-01.json", "lines[2]", /unexpected/);
  });

  it.each([
    ["network", "XYZ", /unknown network/],
    ["material", "unobtainium", /unknown material/],
    ["unit", "mm", /unknown unit/],
    ["dn", "DN 26", /unknown DN 26 for material cuivre/],
  ])("rejects an unknown %s key", async (field, value, message) => {
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      (truth.lines as Array<Record<string, unknown>>)[0][field] = value;
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-01.json", `lines[0].${field}`, message);
  });

  it("keeps the m2 unit of an insulation cell on a network line, and only on insulation", async () => {
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      const lines = truth.lines as Array<Record<string, unknown>>;
      lines[0].unit = "m2";
      lines.push({
        ...lines[2], material: "calorifuge", unit: "m2", quantity: 3.5, plan_cause: "not_drawn",
        source: { document: "a-devis-01", sheet: "Lot", row: 9, row_basis: "workbook", text: "Fictional insulation in m2" },
      });
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-01.json", "lines[0].unit", /m2.*calorifuge/);
    expect(result.errors.filter((issue) => issue.path.startsWith("lines[3]"))).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  // Found in review of TI-660, written before its fix: an observable line takes any
  // plan cause, so a reviewer can move an unexplained miss to the plan with « other ».
  it("takes on an observable line only a plan cause of the review (vertical, not drawn, off plan, no separation, service)", async () => {
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      const lines = truth.lines as Array<Record<string, unknown>>;
      lines[0].plan_cause = "other";
      lines[1].plan_cause = "not_drawn";
      // Not observable: any reason of the exclusion.
      lines[2].plan_cause = "other";
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-01.json", "lines[0].plan_cause", /vertical, not_drawn, off_plan, no_separation or service/);
    expect(result.errors).toHaveLength(1);
  });

  it("rejects an unknown organ and a DN that exists for no material", async () => {
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      const count = (truth.lines as Array<Record<string, unknown>>)[1];
      count.organ = "flux-capacitor";
      count.dn = "DN 21";
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-01.json", "lines[1].organ", /unknown organ/);
    expectIssue(result, "truth/a-plan-01.json", "lines[1].dn", /unknown DN 21/);
  });

  it("rejects references to documents missing from the manifest", async () => {
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      truth.source_document = "a-devis-09";
      (truth.lines as Array<{ source: Record<string, unknown> }>)[0].source.document = "a-devis-08";
    });
    await dataset.mutateJson("truth/noise.json", (noise) => {
      noise.comparison_document = "a-devis-07";
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-01.json", "source_document", /a-devis-09.*not in the manifest/);
    expectIssue(result, "truth/a-plan-01.json", "lines[0].source.document", /a-devis-08.*not in the manifest/);
    expectIssue(result, "truth/noise.json", "comparison_document", /a-devis-07.*not in the manifest/);
  });

  it("reports every error of the dataset, not only the first", async () => {
    const bytes = await readFile(FAKE_PLAN_PATH);
    bytes[100] ^= 0x01;
    await dataset.replaceRaw("a-plan-01", bytes);
    await dataset.mutateJson("truth/a-plan-02.json", (truth) => {
      (truth.lines as Array<Record<string, unknown>>)[0].network = "XYZ";
    });
    await writeFile(path.join(dataset.root, "truth", "d-plan-01.json"), "{ not json");
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "raw/a-plan-01.pdf", "", /sha-?256/i);
    expectIssue(result, "truth/a-plan-02.json", "lines[0].network", /unknown network/);
    expectIssue(result, "truth/d-plan-01.json", "", /JSON/);
  });

  it("reports a missing manifest instead of throwing", async () => {
    await rm(path.join(dataset.root, "manifest.json"));
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "manifest.json", "", /missing/i);
  });

  it("rejects a key counted twice in one truth file", async () => {
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      const lines = truth.lines as Array<Record<string, unknown>>;
      lines.push({ ...lines[0], source: { document: "a-devis-01", sheet: "Lot", row: 40, row_basis: "workbook", text: "Fictional" } });
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-01.json", "lines[3]", /same key as lines\[0\]/);
  });

  it("rejects one devis cell used by two truth lines, except module lines on disjoint plans", async () => {
    await dataset.mutateJson("truth/a-plan-02.json", (truth) => {
      const line = (truth.lines as Array<{ source: Record<string, unknown> }>)[0];
      line.source = { document: "a-devis-01", sheet: "Lot", row: 4, row_basis: "workbook", text: "Fictional split" };
    });
    await writeFile(path.join(dataset.root, "raw", "c-plan-02.pdf"),
      await readFile(path.join(dataset.root, "raw", "c-plan-01.pdf")));
    await dataset.mutateJson("manifest.json", (manifest) => {
      const documents = manifest.documents as Array<Record<string, unknown>>;
      const plan = documents.find((entry) => entry.id === "c-plan-01");
      documents.push({ ...plan, id: "c-plan-02", drive_id: "fixture-drive-c-plan-02", raw_path: "raw/c-plan-02.pdf" });
    });
    const modulePlan = await dataset.readJson("truth/c-plan-01.json");
    await dataset.writeJson("truth/c-plan-02.json", { ...modulePlan, documents: ["c-plan-02"] });
    await dataset.writeJson("truth/c-zz-lot.json", { ...modulePlan, scope: "lot" });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-02.json", "lines[0].source", /a-devis-01.*Lot.*row 4.*truth\/a-plan-01\.json/);
    expect(result.errors.filter((issue) => issue.file === "truth/c-plan-02.json"
      && /^lines\[[0-24]\]/.test(issue.path))).toEqual([]);
    expectIssue(result, "truth/c-plan-02.json", "lines[3].source", /row 13/);
    expectIssue(result, "truth/c-zz-lot.json", "lines[0].source", /row 10/);
  });

  it("tells workbook columns apart: one row feeds one zone per column, never one cell twice", async () => {
    type Source = Record<string, unknown>;
    const setZone2Source = (source: Source) => dataset.mutateJson("truth/a-plan-02.json", (truth) => {
      (truth.lines as Array<{ source: Source }>)[0].source = source;
    });
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      (truth.lines as Array<{ source: Source }>)[0].source.column = "Fictional Z1 column";
    });
    await setZone2Source({ document: "a-devis-01", sheet: "Lot", row: 4, column: "Fictional Z2 column", row_basis: "workbook", text: "Fictional zone 2" });
    expect((await checkTakeoffBenchDataset(dataset.root)).errors).toEqual([]);

    await setZone2Source({ document: "a-devis-01", sheet: "Lot", row: 4, column: "Fictional Z1 column", row_basis: "workbook", text: "Fictional zone 1 again" });
    let result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-02.json", "lines[0].source",
      /row 4, column Fictional Z1 column .*truth\/a-plan-01\.json/);

    await setZone2Source({ document: "a-devis-01", sheet: "Lot", row: 4, row_basis: "workbook", text: "Fictional whole row" });
    result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-02.json", "lines[0].source", /row 4 .*truth\/a-plan-01\.json.*column Fictional Z1 column/);

    await setZone2Source({ document: "a-devis-01", sheet: "Lot", row: 9, column: " ", row_basis: "workbook", text: "Fictional blank column" });
    result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-02.json", "lines[0].source.column", /.+/);
  });

  it("names a devis column by a header the manifest declares, never by a letter", async () => {
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      (truth.lines as Array<{ source: Record<string, unknown> }>)[0].source.column = "Fictional Z1 column";
    });
    // The same cell cited by its column letter would otherwise count as a second cell.
    await dataset.mutateJson("truth/a-plan-02.json", (truth) => {
      (truth.lines as Array<{ source: Record<string, unknown> }>)[0].source = {
        document: "a-devis-01", sheet: "Lot", row: 4, column: "F", row_basis: "workbook", text: "Fictional same cell by letter",
      };
    });
    await dataset.mutateJson("truth/b-plan-01.json", (truth) => {
      (truth.lines as Array<{ source: Record<string, unknown> }>)[0].source.column = "Fictional Z1 column";
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-02.json", "lines[0].source.column", /F is not a column a-devis-01 declares/);
    expectIssue(result, "truth/b-plan-01.json", "lines[0].source.column", /b-devis-01 declares no columns/);
  });

  it("checks lot C module quantities against devis x modules_on_plan / devis_modules", async () => {
    await dataset.mutateJson("truth/c-plan-01.json", (truth) => {
      const lines = truth.lines as Array<Record<string, unknown>>;
      lines[0].quantity = 12;
      lines[3].quantity = 15;
      lines[4].ambiguous = false;
      delete lines[4].ambiguity_reason;
      lines[4].quantity = 0.83;
      delete lines[1].phase;
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/c-plan-01.json", "lines[0].quantity", /60 x 2 \/ 12 = 10/);
    expectIssue(result, "truth/c-plan-01.json", "lines[3].quantity", /commun.*30/);
    expectIssue(result, "truth/c-plan-01.json", "lines[4]", /whole count.*ambiguous/);
    expectIssue(result, "truth/c-plan-01.json", "lines[1].phase", /lot c/);
  });

  it("names the basis of every workbook row and pairs it with the stored download", async () => {
    type Source = Record<string, unknown>;
    const sourceOf = (truth: Record<string, unknown>, index: number) =>
      (truth.lines as Array<{ source: Source }>)[index].source;
    await dataset.mutateJson("truth/c-plan-01.json", (truth) => {
      delete sourceOf(truth, 0).row_basis;
      sourceOf(truth, 1).row_basis = "sheet";
    });
    // a-devis-01 is cited by worksheet row in a-plan-01: a-plan-02 cannot cite it by Drive text record.
    await dataset.mutateJson("truth/a-plan-02.json", (truth) => {
      sourceOf(truth, 0).row_basis = "drive_text";
    });
    await dataset.mutateJson("truth/b-plan-01.json", (truth) => {
      sourceOf(truth, 0).row_basis = "workbook";
    });
    await dataset.mutateJson("truth/d-plan-01.json", (truth) => {
      sourceOf(truth, 0).row_basis = "drive_text";
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/c-plan-01.json", "lines[0].source.row_basis", /row_basis/);
    expectIssue(result, "truth/c-plan-01.json", "lines[1].source.row_basis", /workbook.*drive_text/);
    expectIssue(result, "truth/a-plan-02.json", "lines[0].source.row_basis",
      /a-devis-01 rows are cited by workbook row in truth\/a-plan-01\.json.*one row basis per document/);
    expect(result.errors.filter((issue) => issue.file === "truth/a-plan-02.json"
      && issue.path.startsWith("lines[0].additional_sources"))).toEqual([]);
    expectIssue(result, "truth/b-plan-01.json", "lines[0].source.row_basis", /b-devis-01 is text_only.*drive_text/);
    expectIssue(result, "truth/d-plan-01.json", "lines[0].source.row_basis", /row/);
  });

  it("accepts a stored workbook cited by its Drive text records, one basis for every file", async () => {
    for (const file of ["truth/a-plan-01.json", "truth/a-plan-02.json"]) {
      await dataset.mutateJson(file, (truth) => {
        for (const line of truth.lines as Array<{ source: Record<string, unknown>; additional_sources?: Array<Record<string, unknown>> }>) {
          for (const source of [line.source, ...(line.additional_sources ?? [])]) source.row_basis = "drive_text";
        }
      });
    }
    expect((await checkTakeoffBenchDataset(dataset.root)).errors).toEqual([]);
  });

  it("accepts a plan known to draw no module, whose module lines are then 0", async () => {
    await dataset.mutateJson("truth/c-plan-01.json", (truth) => {
      truth.modules_on_plan = 0;
      for (const line of truth.lines as Array<Record<string, unknown>>) {
        if (line.module_scope === "module" && line.ambiguous !== true) line.quantity = 0;
      }
    });
    expect((await checkTakeoffBenchDataset(dataset.root)).errors).toEqual([]);

    await dataset.mutateJson("truth/c-plan-01.json", (truth) => {
      (truth.lines as Array<Record<string, unknown>>)[0].quantity = 10;
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/c-plan-01.json", "lines[0].quantity", /60 x 0 \/ 12 = 0/);
  });

  it("rejects a line whose zone or level is outside its truth documents", async () => {
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      const lines = truth.lines as Array<Record<string, unknown>>;
      lines[0].zone = "Z2";
      lines[1].level = "R+2";
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-01.json", "lines[0].zone", /Z2.*a-plan-01/);
    expectIssue(result, "truth/a-plan-01.json", "lines[1].level", /R\+2/);
  });

  it("keeps roles consistent between the manifest and the truth files", async () => {
    await dataset.writeJson("truth/e-plan-01.json", {
      ...(await dataset.readJson("truth/a-plan-01.json")),
      documents: ["e-plan-01"], lot: "a",
    });
    await dataset.writeJson("truth/a-level.json", {
      ...(await dataset.readJson("truth/a-plan-01.json")),
      scope: "level", documents: ["a-plan-01", "a-plan-02"], lines: [],
    });
    await rm(path.join(dataset.root, "truth", "d-plan-01.json"));
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/e-plan-01.json", "documents[0]", /no_truth/);
    expectIssue(result, "truth/a-level.json", "documents", /reserve.*truth/);
    expectIssue(result, "manifest.json", "documents[6]", /d-plan-01.*no truth file/);
  });

  it("bounds the modules that plans claim from one devis cell, per document kind", async () => {
    type Line = Record<string, unknown>;
    const modulePlan = await dataset.readJson("truth/c-plan-01.json");
    // Every module of the devis drawn on one sheet: devis x 12 / 12, the commun line left out.
    const fullClaim = (id: string, observable: boolean) => ({
      ...modulePlan,
      documents: [id],
      modules_on_plan: 12,
      lines: (modulePlan.lines as Line[]).filter((line) => line.module_scope === "module").map((line) => ({
        ...line,
        quantity: line.devis_quantity,
        ambiguous: undefined,
        ambiguity_reason: undefined,
        ...(observable || line.unit !== "ml" ? {} : { observable_on_plan: false, plan_cause: "no_scale" }),
      })),
    });
    await dataset.mutateJson("manifest.json", (manifest) => {
      const documents = manifest.documents as Line[];
      const plan = documents.find((entry) => entry.id === "c-plan-01") as Line;
      documents.push(
        { ...plan, id: "c-plan-02", drive_id: "fixture-drive-c-plan-02", raw_path: "raw/c-plan-02.pdf", level: "R+2" },
        { ...plan, id: "c-schema-01", kind: "schema", drive_id: "fixture-drive-c-schema-01",
          raw_path: "raw/c-schema-01.pdf", scale: null, level: null },
      );
    });
    for (const id of ["c-plan-02", "c-schema-01"]) {
      await writeFile(path.join(dataset.root, "raw", `${id}.pdf`), await readFile(path.join(dataset.root, "raw", "c-plan-01.pdf")));
    }
    await dataset.writeJson("truth/c-plan-02.json", { ...fullClaim("c-plan-02", true), lines: fullClaim("c-plan-02", true)
      .lines.map((line) => ({ ...line, level: "R+2" })) });
    await dataset.writeJson("truth/c-schema-01.json", { ...fullClaim("c-schema-01", false), lines: fullClaim("c-schema-01", false)
      .lines.map((line) => ({ ...line, level: null })) });
    const result = await checkTakeoffBenchDataset(dataset.root);
    // c-plan-01 claims 2 of 12 modules, c-plan-02 all 12: 14 of 12.
    expectIssue(result, "truth/c-plan-02.json", "lines[0].source", /row 10.*14\/12 of its modules.*truth\/c-plan-01\.json/);
    expectIssue(result, "truth/c-plan-02.json", "lines[2].source", /row 12.*14\/12/);
    // A schema is another view of the same modules: its own bound, 12 of 12.
    expect(result.errors.filter((issue) => issue.file === "truth/c-schema-01.json")).toEqual([]);
  });

  it("charges a truth covering a plan and a schema against each kind's module budget", async () => {
    type Line = Record<string, unknown>;
    const modulePlan = await dataset.readJson("truth/c-plan-01.json");
    await dataset.mutateJson("manifest.json", (manifest) => {
      const documents = manifest.documents as Line[];
      const plan = documents.find((entry) => entry.id === "c-plan-01") as Line;
      documents.push(
        { ...plan, id: "c-plan-02", drive_id: "fixture-drive-c-plan-02", raw_path: "raw/c-plan-02.pdf", level: "R+2" },
        { ...plan, id: "c-schema-01", kind: "schema", drive_id: "fixture-drive-c-schema-01",
          raw_path: "raw/c-schema-01.pdf", level: "R+2" },
      );
    });
    for (const id of ["c-plan-02", "c-schema-01"]) {
      await writeFile(path.join(dataset.root, "raw", `${id}.pdf`), await readFile(path.join(dataset.root, "raw", "c-plan-01.pdf")));
    }
    // A level truth on R+2 covers a plan and a schema, every module drawn: 12 of 12.
    await dataset.writeJson("truth/c-r2.json", {
      ...modulePlan,
      scope: "level",
      documents: ["c-plan-02", "c-schema-01"],
      modules_on_plan: 12,
      lines: (modulePlan.lines as Line[]).filter((line) => line.module_scope === "module").map((line) => ({
        ...line, level: "R+2", quantity: line.devis_quantity, ambiguous: undefined, ambiguity_reason: undefined,
      })),
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    // Its plan adds to the 2 of 12 claimed on c-plan-01: 14 of 12 on the plans.
    expectIssue(result, "truth/c-r2.json", "lines[0].source", /row 10: the plan files claim 14\/12 of its modules/);
  });

  it("exempts a shared devis cell only for lot C module lines with a module allocation", async () => {
    type Line = Record<string, unknown>;
    // Lot C fields outside lot C: refused, so they cannot buy the exemption.
    for (const id of ["a-plan-01", "a-plan-02"]) {
      await dataset.mutateJson(`truth/${id}.json`, (truth) => {
        const [line] = truth.lines as Line[];
        line.source = { document: "a-devis-01", sheet: "Fictional sheet", row: 4, row_basis: "workbook", text: "Fictional row" };
        line.module_scope = "module";
      });
    }
    // A lot C plan whose modules are unknown shares c-plan-01's cells without any allocation.
    const modulePlan = await dataset.readJson("truth/c-plan-01.json");
    await dataset.mutateJson("manifest.json", (manifest) => {
      const documents = manifest.documents as Line[];
      const plan = documents.find((entry) => entry.id === "c-plan-01") as Line;
      documents.push({ ...plan, id: "c-plan-02", drive_id: "fixture-drive-c-plan-02", raw_path: "raw/c-plan-02.pdf", level: "R+2" });
    });
    await writeFile(path.join(dataset.root, "raw", "c-plan-02.pdf"), await readFile(path.join(dataset.root, "raw", "c-plan-01.pdf")));
    await dataset.writeJson("truth/c-plan-02.json", {
      ...modulePlan,
      documents: ["c-plan-02"],
      modules_on_plan: null,
      lines: (modulePlan.lines as Line[]).map((line) => ({
        ...line, level: "R+2", ambiguous: true, ambiguity_reason: "Fictional: modules not counted on this plan.",
      })),
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-01.json", "lines[0].module_scope", /only lot c lines carry it/);
    expectIssue(result, "truth/a-plan-02.json", "lines[0].module_scope", /only lot c lines carry it/);
    expectIssue(result, "truth/c-plan-02.json", "lines[0].source", /already used by truth\/c-plan-01\.json/);
  });

  it("bounds the PDF page a truth source cites by its document's page count", async () => {
    await dataset.mutateJson("truth/d-plan-01.json", (truth) => {
      const [line] = truth.lines as Array<Record<string, unknown>>;
      (line.source as Record<string, unknown>).page = 999;
      line.additional_sources = [{ document: "d-plan-01", sheet: null, row: null, page: 2, text: "Fictional second page" }];
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/d-plan-01.json", "lines[0].source.page", /page 999 is beyond the 1 page of d-plan-01/);
    expectIssue(result, "truth/d-plan-01.json", "lines[0].additional_sources[0].page", /page 2 is beyond the 1 page of d-plan-01/);
  });

  it("keeps a failed-download truth plan only when a devis is its source", async () => {
    await dataset.mutateJson("manifest.json", (manifest) => {
      const plan = (manifest.documents as Array<Record<string, unknown>>)[6];
      Object.assign(plan, {
        raw_status: "failed", raw_path: null, sha256: null, pages: null,
        structure_check: { status: "not_run", method: null, detail: null }, notes: "Fictional failure.",
      });
    });
    await rm(path.join(dataset.root, "raw", "d-plan-01.pdf"));
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/d-plan-01.json", "documents[0]", /d-plan-01 has no verified binary.*its own text layer/);
    expectIssue(result, "truth/d-plan-01.json", "lines[0].source", /d-plan-01 failed to download/);
    expect(result.summary.truthWithoutBinary).toEqual(["b-plan-01"]);
  });

  it("ties every truth source to the truth file's lot and documents", async () => {
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      const lines = truth.lines as Array<{ source: Record<string, unknown> }>;
      truth.source_document = "b-devis-01";
      lines[0].source.document = "c-devis-01";
      lines[1].source = { document: "load-plan-01", sheet: null, row: null, page: 1, text: "Fictional load-test text" };
      lines[2].source = { document: "a-plan-02", sheet: null, row: null, page: 1, text: "Fictional zone 2 text" };
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-01.json", "source_document", /b-devis-01 belongs to lot b/);
    expectIssue(result, "truth/a-plan-01.json", "lines[0].source.document", /c-devis-01 belongs to lot c/);
    expectIssue(result, "truth/a-plan-01.json", "lines[1].source.document", /load-plan-01 .*not a document of this truth/);
    expectIssue(result, "truth/a-plan-01.json", "lines[2].source.document", /a-plan-02 .*not a document of this truth/);
  });

  it("makes a level truth cover every zone of its level and a lot truth every plan of its lot", async () => {
    const zone1 = await dataset.readJson("truth/a-plan-01.json");
    await rm(path.join(dataset.root, "truth", "a-plan-01.json"));
    await dataset.writeJson("truth/a-r1.json", { ...zone1, scope: "level" });
    await dataset.writeJson("truth/a-all.json", { ...zone1, scope: "lot", lines: [] });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-r1.json", "documents", /every truth or reserve plan of level R\+1 of lot a: a-plan-02 missing/);
    expectIssue(result, "truth/a-all.json", "documents", /every truth or reserve plan of lot a: a-plan-02 missing/);
  });

  it("keeps the lengths of an unscaled schema off the plan, and records several scales", async () => {
    await dataset.mutateJson("manifest.json", (manifest) => {
      const documents = manifest.documents as Array<Record<string, unknown>>;
      const plan = documents.find((entry) => entry.id === "c-plan-01") as Record<string, unknown>;
      plan.scale = null;
      plan.scales = ["1/20", "1/500"];
      documents.push({ ...plan, id: "c-schema-01", kind: "schema", drive_id: "fixture-drive-c-schema-01",
        raw_path: "raw/c-schema-01.pdf", scales: undefined });
      documents[0].scales = ["1/20"];
      documents[6].scales = ["1/100", "1/200"];
    });
    await writeFile(path.join(dataset.root, "raw", "c-schema-01.pdf"), await readFile(path.join(dataset.root, "raw", "c-plan-01.pdf")));
    await dataset.writeJson("truth/c-schema-01.json", {
      ...(await dataset.readJson("truth/c-plan-01.json")), documents: ["c-schema-01"],
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/c-schema-01.json", "lines[0].observable_on_plan", /c-schema-01 is a schema with no scale/);
    expectIssue(result, "truth/c-schema-01.json", "lines[1].observable_on_plan", /no scale/);
    expect(result.errors.filter((issue) => issue.file === "truth/c-schema-01.json" && issue.path.startsWith("lines[2]")))
      .toEqual([]);
    expectIssue(result, "manifest.json", "documents[0].scales", /at least 2/);
    expectIssue(result, "manifest.json", "documents[6].scales", /scale is null/);
    expect(result.errors.filter((issue) => issue.file === "manifest.json" && issue.path.startsWith("documents[4]")))
      .toEqual([]);
  });

  it("opens each PDF with pdfjs and compares its page count with the manifest", async () => {
    await dataset.mutateJson("manifest.json", (manifest) => {
      (manifest.documents as Array<Record<string, unknown>>)[6].pages = 7;
    });
    await dataset.replaceRaw("a-plan-02", Buffer.from("%PDF-1.7\nFictional broken body\n%%EOF\n"), { record: true });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "raw/d-plan-01.pdf", "", /pdfjs opens 1 page.*manifest says 7/);
    expectIssue(result, "raw/a-plan-02.pdf", "", /pdfjs cannot open/);
    expect(result.summary.verifiedBinaries).toBe(4);
  });

  it("checks the CRC-32 of every workbook entry, like unzip -t", async () => {
    const stored = Buffer.from(zipSync({
      "[Content_Types].xml": strToU8("<Types>fictional</Types>"),
      "xl/workbook.xml": strToU8("<workbook><sheets><sheet name=\"Lot\"/></sheets></workbook>"),
    }, { level: 0 }));
    const dataStart = 30 + stored.readUInt16LE(26) + stored.readUInt16LE(28);
    stored[dataStart + 3] ^= 0x20;
    await dataset.replaceRaw("a-devis-01", stored, { record: true });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "raw/a-devis-01.xlsx", "", /\[Content_Types\]\.xml.*CRC-32/);
  });

  it.skipIf(process.getuid?.() === 0)("reports an unreadable binary and goes on with the report", async () => {
    await chmod(path.join(dataset.root, "raw", "a-plan-02.pdf"), 0o000);
    await dataset.mutateJson("truth/a-plan-01.json", (truth) => {
      (truth.lines as Array<Record<string, unknown>>)[0].network = "XYZ";
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "raw/a-plan-02.pdf", "", /unreadable \(EACCES\)/);
    expectIssue(result, "truth/a-plan-01.json", "lines[0].network", /unknown network/);
  });

  it("rejects a manifest header out of schema and a duplicate_of that names no document", async () => {
    await dataset.mutateJson("manifest.json", (manifest) => {
      manifest.schema_version = 2;
      manifest.extra = "Fictional";
      (manifest.documents as Array<Record<string, unknown>>)[7].duplicate_of = "e-plan-09";
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "manifest.json", "schema_version", /1/);
    expectIssue(result, "manifest.json", "", /extra/);
    expectIssue(result, "manifest.json", "documents[7].duplicate_of", /e-plan-09.*not in the manifest/);
  });

  it("requires truth/noise.json and accepts a noise that could not be measured", async () => {
    await rm(path.join(dataset.root, "truth", "noise.json"));
    expectIssue(await checkTakeoffBenchDataset(dataset.root), "truth/noise.json", "", /missing.*not_measured/);

    await dataset.writeJson("truth/noise.json", {
      schema_version: 1, status: "not_measured", reason: "Fictional: the plan index differs between the two devis.",
      baseline_document: "a-devis-01", comparison_document: "a-devis-02", documents: ["a-plan-01", "a-plan-02"],
      plan_index_same: null, rules: "Fictional rule: compare only on an unchanged plan index.", keys: [],
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expect(result.errors).toEqual([]);
    expect(result.summary.noise).toBe("not_measured");
  });

  it("requires two distinct documents for a measured noise", async () => {
    await dataset.mutateJson("truth/noise.json", (noise) => {
      noise.comparison_document = noise.baseline_document;
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/noise.json", "comparison_document", /two distinct revisions/);
  });

  it("accepts a measured noise only between two usable devis of the noise plans' lot", async () => {
    await dataset.mutateJson("truth/noise.json", (noise) => {
      noise.comparison_document = "c-devis-01";
    });
    expectIssue(await checkTakeoffBenchDataset(dataset.root), "truth/noise.json", "comparison_document",
      /c-devis-01 belongs to lot c, the noise plans to lot a/);

    await dataset.mutateJson("truth/noise.json", (noise) => {
      noise.comparison_document = "a-devis-02";
      noise.baseline_document = "a-plan-01";
    });
    expectIssue(await checkTakeoffBenchDataset(dataset.root), "truth/noise.json", "baseline_document",
      /a-plan-01 is a plan: a noise compares two revisions of a devis/);
  });

  it("requires a noise to cover the plans or schemas whose index stays the same, not a devis", async () => {
    await dataset.mutateJson("truth/noise.json", (noise) => {
      noise.documents = ["a-devis-01"];
      for (const key of noise.keys as Array<Record<string, unknown>>) {
        key.zone = null;
        key.level = null;
      }
    });
    expectIssue(await checkTakeoffBenchDataset(dataset.root), "truth/noise.json", "documents[0]",
      /a-devis-01 is a devis: a noise covers the plans or schemas whose index stays the same/);

    await dataset.mutateJson("truth/noise.json", (noise) => {
      noise.documents = ["a-plan-01", "a-devis-02"];
    });
    expectIssue(await checkTakeoffBenchDataset(dataset.root), "truth/noise.json", "documents[1]",
      /a-devis-02 is a devis: a noise covers the plans or schemas/);
  });

  it("keeps workshop and site noise keys apart by phase, as truth lines do", async () => {
    await dataset.mutateJson("truth/noise.json", (noise) => {
      const keys = noise.keys as Array<Record<string, unknown>>;
      keys.splice(1, 1, { ...keys[0], phase: "atelier", relative_deviation: 0.02 }, { ...keys[0], phase: "chantier" });
      keys[0].phase = "atelier";
    });
    expectIssue(await checkTakeoffBenchDataset(dataset.root), "truth/noise.json", "keys[1]", /same key as keys\[0\]/);

    await dataset.mutateJson("truth/noise.json", (noise) => {
      const keys = noise.keys as Array<Record<string, unknown>>;
      keys.splice(1, 1);
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expect(result.errors).toEqual([]);
  });

  it("rejects raw quantities in noise.json", async () => {
    await dataset.mutateJson("truth/noise.json", (noise) => {
      (noise.keys as Array<Record<string, unknown>>)[0].baseline_quantity = 12.5;
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/noise.json", "keys[0]", /baseline_quantity/);
  });

  // Page truths (TI-663), written before the check: a binary PDF without its page truth
  // (G1), a page missing, repeated or beyond the document, a wrong page count (G2), a
  // kept type, cited page or ambiguous page not kept, or an excluded page kept without
  // reason (G3), an unnormalised level or zone (G4), a type, status or labeller outside
  // the contract (G6), page labels on a document without PDF pages.
  it("requires a page truth for every binary PDF and allows an empty one for a document without pages", async () => {
    await rm(path.join(dataset.root, "truth/pages/c-plan-01.json"));
    await dataset.writeJson("truth/pages/e-plan-01.json", { schema_version: 1, document: "e-plan-01", page_count: null, labeled_at: "2026-11-03", pages: [] });
    await dataset.writeJson("truth/pages/a-devis-02.json", pageTruth("a-devis-02", [{ page: 1, type: "piece_ecrite", niveau: null, zone: null, garder: false }]));
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/pages/c-plan-01.json", "", /missing.*binary PDF/);
    expectIssue(result, "truth/pages/a-devis-02.json", "pages", /no PDF pages/);
    expect(result.errors.filter((issue) => issue.file === "truth/pages/e-plan-01.json")).toEqual([]);
  });

  it("requires every page exactly once with the manifest page count", async () => {
    await dataset.writeJson("truth/pages/a-plan-01.json", pageTruth("a-plan-01", [{ page: 1, type: "reseau", niveau: "R+1", zone: "Z1", garder: true }]));
    await dataset.mutateJson("truth/pages/a-plan-02.json", (truth) => {
      (truth.pages as Array<Record<string, unknown>>)[0].page = 3;
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/pages/a-plan-01.json", "page_count", /2 pages/);
    expectIssue(result, "truth/pages/a-plan-01.json", "pages", /page 2 is missing/);
    expectIssue(result, "truth/pages/a-plan-02.json", "pages[0].page", /1 page/);
  });

  it("refuses an unnormalised level or zone and values outside the contract", async () => {
    await dataset.mutateJson("truth/pages/a-plan-02.json", (truth) => {
      Object.assign((truth.pages as Array<Record<string, unknown>>)[0], { niveau: "R + 1", zone: "Zone 2", type: "plan", statut: "ok", labeled_by: "" });
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    for (const field of ["niveau", "zone", "type", "statut", "labeled_by"]) expectIssue(result, "truth/pages/a-plan-02.json", `pages[0].${field}`, /./);
    await dataset.mutateJson("truth/pages/a-plan-02.json", (truth) => {
      Object.assign((truth.pages as Array<Record<string, unknown>>)[0], { niveau: "R+01", zone: "Z02", type: "reseau", statut: "à valider", labeled_by: "agent" });
    });
    const zeros = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(zeros, "truth/pages/a-plan-02.json", "pages[0].niveau", /./);
    expectIssue(zeros, "truth/pages/a-plan-02.json", "pages[0].zone", /./);
  });

  it("keeps every kept type, cited page and ambiguous page, and only those", async () => {
    await dataset.mutateJson("truth/pages/a-plan-01.json", (truth) => {
      (truth.pages as Array<Record<string, unknown>>)[1].garder = false;
    });
    await dataset.writeJson("truth/pages/load-plan-01.json", pageTruth("load-plan-01", [{ page: 1, type: "reseau", niveau: null, zone: null, garder: false }]));
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/pages/a-plan-01.json", "pages[1].garder", /covered by a quantity truth/);
    expectIssue(result, "truth/pages/load-plan-01.json", "pages[0].garder", /kept type/);
    await dataset.writeJson("truth/pages/load-plan-01.json", pageTruth("load-plan-01", [{ page: 1, type: "facade", niveau: null, zone: null, garder: false, statut: "ambigu" }]));
    expectIssue(await checkTakeoffBenchDataset(dataset.root), "truth/pages/load-plan-01.json", "pages[0].garder", /ambiguous/);
    await dataset.writeJson("truth/pages/load-plan-01.json", pageTruth("load-plan-01", [{ page: 1, type: "coupe", niveau: null, zone: null, garder: true }]));
    expectIssue(await checkTakeoffBenchDataset(dataset.root), "truth/pages/load-plan-01.json", "pages[0].garder", /excluded type/);
  });

  it("validates the group truth owned by TI-662 when present", async () => {
    await dataset.writeJson("truth/groups/a-plan-09.json", {
      schema_version: 1, document: "a-plan-09", groups: [{ page: 1, group: "layer:fictional", class: "EF" }],
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/groups/a-plan-09.json", "document", /not in the manifest/);
  });

  const RED = "c:#ff0000|w:1|d:";
  function groupTruth(overrides: Record<string, unknown> = {}) {
    return {
      schema_version: 1, document: "a-plan-01",
      groups: [{ page: 1, group: RED, class: "EF" }, { page: 2, group: RED, class: "ECS" }, { page: 1, group: "oc:7", class: "mur" }],
      calibrations: [{ page: 1, denominator: 50, source: "Fictional cote 5,00 m checked by hand" }],
      ...overrides,
    };
  }

  it("accepts a groups file with its correspondences and a page calibration, and counts it", async () => {
    await dataset.writeJson("truth/groups/a-plan-01.json", groupTruth());
    const result = await checkTakeoffBenchDataset(dataset.root);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    // The fixture's page truths (TI-663) are unchanged; the group truth is counted apart.
    expect(result.summary).toMatchObject({ pageFiles: 5, groupFiles: 1 });
  });

  it("refuses a group class that is neither a network code nor a known class", async () => {
    await dataset.writeJson("truth/groups/a-plan-01.json", groupTruth({
      groups: [{ page: 1, group: RED, class: "EF" }, { page: 1, group: "oc:7", class: "ef" }, { page: 2, group: "oc:8", class: "chauffage" }],
    }));
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/groups/a-plan-01.json", "groups[1].class", /unknown class ef/);
    expectIssue(result, "truth/groups/a-plan-01.json", "groups[2].class", /unknown class chauffage/);
    expect(result.errors).toHaveLength(2);
  });

  it("refuses the same group of one page twice", async () => {
    await dataset.writeJson("truth/groups/a-plan-01.json", groupTruth({
      groups: [{ page: 1, group: RED, class: "EF" }, { page: 2, group: RED, class: "EF" }, { page: 1, group: RED, class: "ECS" }],
    }));
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/groups/a-plan-01.json", "groups[2]", /listed twice/);
    expect(result.errors).toHaveLength(1);
  });

  it("refuses a calibration beyond the document's pages, twice for one page, or without a positive denominator", async () => {
    await dataset.writeJson("truth/groups/a-plan-01.json", groupTruth({
      calibrations: [
        { page: 1, denominator: 50, source: "Fictional cote" },
        { page: 3, denominator: 50, source: "Fictional cote" },
        { page: 1, denominator: 100, source: "Fictional other cote" },
      ],
    }));
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/groups/a-plan-01.json", "calibrations[1].page", /beyond the 2 pages of a-plan-01/);
    expectIssue(result, "truth/groups/a-plan-01.json", "calibrations[2].page", /calibrated twice/);
    expect(result.errors).toHaveLength(2);

    await dataset.writeJson("truth/groups/a-plan-01.json", groupTruth({
      calibrations: [{ page: 1, denominator: 0, source: "Fictional cote" }, { page: 2, denominator: 50 }],
    }));
    const invalid = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(invalid, "truth/groups/a-plan-01.json", "calibrations[0].denominator", /./);
    expectIssue(invalid, "truth/groups/a-plan-01.json", "calibrations[1].source", /./);
  });

  it("refuses a groups file not named after its document", async () => {
    await dataset.writeJson("truth/groups/a-plan-02.json", groupTruth());
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/groups/a-plan-02.json", "document", /truth\/groups\/<document id>\.json/);
    expect(result.errors).toHaveLength(1);
  });
});
