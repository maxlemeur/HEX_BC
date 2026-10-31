import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFixtureDataset,
  FAKE_PLAN_PATH,
  type FixtureDataset,
} from "@/lib/takeoff/bench/bench-dataset.test-utils";
import { checkTakeoffBenchDataset, type BenchCheckResult } from "@/lib/takeoff/bench/check";

// Ways `takeoff:bench:check` could let a broken dataset through, written before
// the check (AGENTS.md). Each one is a case below, on a fictional dataset:
// - a byte changes but the size does not: only the SHA-256 sees it;
// - the decoded size differs from Drive's fileSize (truncated or padded download);
// - a truncated PDF or an undecoded base64 XLSX is recorded with its own size and
//   hash: only the structure check (header, %%EOF, ZIP central directory) sees it;
// - a binary is missing, or raw/ holds a file the manifest does not name (an
//   original title used as a file name);
// - a raw_path leaves raw/ or is not named after the anonymous id;
// - a truth file is out of schema (comma decimal, missing field, unknown field);
// - a network, material, organ, unit or DN outside the known keys;
// - a truth line or header refers to a document absent from the manifest;
// - the same key twice in a file, or one devis cell in two truth lines (a quantity
//   split between plans or counted twice), except a lot C module line;
// - a module quantity that does not follow devis x modules_on_plan / devis_modules,
//   or a fractional count not flagged ambiguous;
// - a line zone or level outside its truth documents;
// - truth on a no_truth document, reserve and truth mixed in one file, a truth or
//   reserve plan left without truth;
// - a raw quantity in noise.json;
// - a missing manifest or invalid JSON stops the check instead of being reported;
// - only the first error is reported.

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
      documents: 9,
      verifiedBinaries: 6,
      truthFiles: 4,
      truthLines: 10,
      noise: "measured",
      pageFiles: 1,
      groupFiles: 0,
    });
    expect(result.summary.lots.a).toEqual({ lines: 4, observable: 3 });
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
      lines.push({ ...lines[0], source: { document: "a-devis-01", sheet: "Lot", row: 40, text: "Fictional" } });
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/a-plan-01.json", "lines[3]", /same key as lines\[0\]/);
  });

  it("rejects one devis cell used by two truth lines, except module lines on disjoint plans", async () => {
    await dataset.mutateJson("truth/a-plan-02.json", (truth) => {
      const line = (truth.lines as Array<{ source: Record<string, unknown> }>)[0];
      line.source = { document: "a-devis-01", sheet: "Lot", row: 4, text: "Fictional split" };
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

  it("rejects raw quantities in noise.json", async () => {
    await dataset.mutateJson("truth/noise.json", (noise) => {
      (noise.keys as Array<Record<string, unknown>>)[0].baseline_quantity = 12.5;
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/noise.json", "keys[0]", /baseline_quantity/);
  });

  it("validates the page truth owned by TI-663 when present", async () => {
    await dataset.writeJson("truth/pages/a-plan-02.json", {
      schema_version: 1, document: "a-plan-02", pages: [{ page: 3, type: "plan" }],
    });
    await dataset.writeJson("truth/groups/a-plan-09.json", {
      schema_version: 1, document: "a-plan-09", groups: [{ page: 1, group: "layer:fictional", class: "EF" }],
    });
    const result = await checkTakeoffBenchDataset(dataset.root);
    expectIssue(result, "truth/pages/a-plan-02.json", "pages[0].page", /1 page/);
    expectIssue(result, "truth/groups/a-plan-09.json", "document", /not in the manifest/);
  });
});
