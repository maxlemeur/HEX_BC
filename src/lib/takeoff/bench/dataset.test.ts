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
    [["e-plan-01"], /e-plan-01 has no quantity truth/],
    [["load-plan-01"], /load-plan-01 has no quantity truth/],
    [["a-devis-01"], /a-devis-01 has no quantity truth/],
    [["b-plan-01"], /b-plan-01 has no verified binary/],
    [["a-plan-01", "a-plan-01"], /a-plan-01 is given twice/],
  ])("refuses the explicit documents %j", async (ids, message) => {
    await expect(loadBenchDataset(dataset.root, ids)).rejects.toThrow(message);
  });

  it("hashes manifest.json and every truth/**/*.json, sorted, and nothing else", async () => {
    const first = await datasetSha256(dataset.root);
    expect(first).toBe(await expectedSha(dataset.root));
    expect((await loadBenchDataset(dataset.root, "all")).sha256).toBe(first);

    await dataset.mutateJson("truth/pages/a-plan-01.json", (value) => { value.pages = [{ page: 1, type: "plan" }]; });
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
