import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixtureDataset, FAKE_PLAN_PATH, type FixtureDataset } from "@/lib/takeoff/bench/bench-dataset.test-utils";
import { datasetSha256, loadBenchDataset, readVerifiedPdf } from "@/lib/takeoff/bench/dataset";

// Ways the bench could run on the wrong data (TI-660), written before the code,
// on the fictional dataset of takeoff:bench:check:
// - a dataset without manifest.json, raw/ or truth/ is run anyway (an empty
//   raw/ would make `--docs all` silently run nothing);
// - a dataset takeoff:bench:check refuses (one byte changed) is run;
// - a PDF changed after the check is sent: its size and SHA-256 are not
//   verified again when it is read;
// - `--docs all` takes a document without quantity truth (lot E, the load test,
//   the plans of truth/noise.json only), or runs a truth plan without binary
//   instead of listing it as skipped;
// - an explicit id without quantity truth or without binary, or given twice, is run;
// - the dataset SHA misses a truth file (truth/pages, truth/noise.json), covers
//   the raw files, or depends on the listing order or on the dataset path.
// Page triage (TI-663), written before the code: a triage run takes a document
// without page truth or without binary PDF; an explicit extraction refuses a plan
// that only has a page truth (lot E, measured for tokens and latency, unscored).

let dataset: FixtureDataset;

beforeEach(async () => {
  dataset = await createFixtureDataset();
});

afterEach(async () => {
  await dataset.cleanup();
});

async function expectedSha(root: string) {
  const files = ["manifest.json"];
  async function walk(directory: string) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(relative);
      else if (entry.name.endsWith(".json")) files.push(relative);
    }
  }
  await walk("truth");
  const lines = await Promise.all(files.sort().map(async (file) =>
    `${file}\t${createHash("sha256").update(await readFile(path.join(root, file))).digest("hex")}\n`));
  return createHash("sha256").update(lines.join("")).digest("hex");
}

describe("takeoff bench dataset", () => {
  it.each(["manifest.json", "raw", "truth"])("refuses a dataset without %s", async (entry) => {
    await rm(path.join(dataset.root, entry), { recursive: true, force: true });
    await expect(loadBenchDataset(dataset.root, "all")).rejects.toThrow(entry);
  });

  it("refuses a dataset takeoff:bench:check refuses", async () => {
    const bytes = await readFile(FAKE_PLAN_PATH);
    bytes[200] ^= 0x01;
    await dataset.replaceRaw("a-plan-01", bytes);
    await expect(loadBenchDataset(dataset.root, "all")).rejects.toThrow(/takeoff:bench:check[\s\S]*SHA-256/);
  });

  it("verifies the size and SHA-256 of a PDF again when it reads it", async () => {
    const loaded = await loadBenchDataset(dataset.root, ["a-plan-01"]);
    const document = loaded.selected[0].document;
    await expect(readVerifiedPdf(dataset.root, document)).resolves.toHaveLength(document.file_size as number);
    const bytes = await readFile(FAKE_PLAN_PATH);
    bytes[200] ^= 0x01;
    await dataset.replaceRaw("a-plan-01", bytes);
    await expect(readVerifiedPdf(dataset.root, document)).rejects.toThrow(/SHA-256/);
    await dataset.replaceRaw("a-plan-01", bytes.subarray(0, 100));
    await expect(readVerifiedPdf(dataset.root, document)).rejects.toThrow(/size/);
  });

  it("selects with all the documents of the quantity truth that have a binary, and lists the others", async () => {
    const loaded = await loadBenchDataset(dataset.root, "all");
    expect(loaded.selected.map(({ document }) => [document.id, document.role])).toEqual([
      ["a-plan-01", "truth"], ["a-plan-02", "reserve"], ["c-plan-01", "truth"], ["d-plan-01", "truth"],
    ]);
    expect(loaded.skipped).toEqual([{ id: "b-plan-01", reason: "no verified binary (raw_status failed)" }]);
    expect(loaded.selected[0].bytes.length).toBe(loaded.selected[0].document.file_size);
    expect(loaded.truthFiles.map(({ file }) => file)).toEqual([
      "truth/a-plan-01.json", "truth/a-plan-02.json", "truth/b-plan-01.json", "truth/c-plan-01.json", "truth/d-plan-01.json",
    ]);
    expect(loaded.noise?.status).toBe("measured");
  });

  it.each([
    [["e-plan-01"], /e-plan-01 has no quantity truth nor page truth/],
    [["a-devis-01"], /a-devis-01 has no quantity truth nor page truth/],
    [["b-plan-01"], /b-plan-01 has no verified binary/],
    [["a-plan-01", "a-plan-01"], /a-plan-01 is given twice/],
  ])("refuses the explicit documents %j", async (ids, message) => {
    await expect(loadBenchDataset(dataset.root, ids)).rejects.toThrow(message);
  });

  it("measures an explicit plan that only has a page truth, without scoring it", async () => {
    const loaded = await loadBenchDataset(dataset.root, ["load-plan-01"]);
    expect(loaded.selected.map(({ document }) => document.id)).toEqual(["load-plan-01"]);
    expect(loaded.pageTruths.get("load-plan-01")?.pages[0].type).toBe("coupe");
  });

  it("loads the hand measurements of the plans, and none when the folder is absent", async () => {
    expect((await loadBenchDataset(dataset.root, ["a-plan-01"])).measured).toEqual([]);
    await dataset.writeJson("truth/measured/a-plan-01.json", {
      schema_version: 1, document: "a-plan-01", method: "Fictional method", measured_by: "Fictional estimator", measured_on: "2026-11-12",
      lines: [{ zone: "Z1", level: "R+1", network: "EF", material: "cuivre", dn: "DN 22", length_m: 11.2 }],
    });
    const loaded = await loadBenchDataset(dataset.root, ["a-plan-01"]);
    expect(loaded.measured.map((file) => [file.document, file.lines.map((line) => line.length_m)])).toEqual([["a-plan-01", [11.2]]]);
    // A hidden file is not of the dataset: the check and the dataset SHA skip it, so it is not loaded either.
    await dataset.writeJson("truth/measured/.a-plan-02.json", { anything: true });
    expect((await loadBenchDataset(dataset.root, ["a-plan-01"])).measured.map((file) => file.document)).toEqual(["a-plan-01"]);
  });

  it("selects for a triage run every binary PDF with its page truth", async () => {
    const loaded = await loadBenchDataset(dataset.root, "all", { mode: "triage" });
    expect(loaded.selected.map(({ document }) => document.id)).toEqual(["a-plan-01", "a-plan-02", "c-plan-01", "d-plan-01", "load-plan-01"]);
    expect([...loaded.pageTruths.keys()].sort()).toEqual(["a-plan-01", "a-plan-02", "c-plan-01", "d-plan-01", "load-plan-01"]);
    await expect(loadBenchDataset(dataset.root, ["e-plan-01"], { mode: "triage" })).rejects.toThrow(/e-plan-01 has no page truth/);
    await expect(loadBenchDataset(dataset.root, ["a-devis-01"], { mode: "triage" })).rejects.toThrow(/a-devis-01 has no page truth/);
  });

  it("hashes manifest.json and every truth/**/*.json, sorted, and nothing else", async () => {
    const first = await datasetSha256(dataset.root);
    expect(first).toBe(await expectedSha(dataset.root));
    expect((await loadBenchDataset(dataset.root, "all")).sha256).toBe(first);

    await dataset.mutateJson("truth/pages/a-plan-01.json", (value) => { value.labeled_at = "2026-11-04"; });
    const afterPages = await datasetSha256(dataset.root);
    expect(afterPages).not.toBe(first);
    await dataset.mutateJson("truth/noise.json", (value) => { value.rules = "Fictional rule, revised."; });
    const afterNoise = await datasetSha256(dataset.root);
    expect(afterNoise).not.toBe(afterPages);
    await dataset.replaceRaw("a-plan-02", new Uint8Array([1, 2, 3]));
    expect(await datasetSha256(dataset.root)).toBe(afterNoise);
    expect(await datasetSha256(`${dataset.root}${path.sep}`)).toBe(afterNoise);
  });
});
