import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { checkTakeoffBenchDataset, formatBenchIssue } from "@/lib/takeoff/bench/check";
import {
  GroupTruthFileSchema,
  ManifestSchema,
  NoiseFileSchema,
  PageTruthFileSchema,
  TruthFileSchema,
  type GroupTruthFile,
  type ManifestDocument,
  type NoiseFile,
  type PageTruthFile,
  type TakeoffBenchManifest,
} from "@/lib/takeoff/bench/schemas";
import type { ScoreTruthFile } from "@/lib/takeoff/bench/score";

// The private dataset as the bench reads it (TI-660). It is refused without
// manifest.json, raw/ and truth/, and unless takeoff:bench:check passes (every
// binary's size and SHA-256, every truth file). `--docs all` runs the documents
// a quantity truth (truth/*.json, not noise.json) covers and that have a binary;
// an explicit id needs both. Each PDF is verified again when it is read.
// The dataset SHA is the SHA-256 of the sorted lines `<path>\t<sha256>\n` of
// manifest.json and every truth/**/*.json, paths relative to the dataset.
// Page truths (truth/pages, TI-663) are loaded too. A triage run takes every
// binary PDF with a page truth (or the ids given, which need both); an explicit
// extraction also accepts a plan that only has a page truth: it is measured
// (tokens, latency) and left unscored.

export class BenchDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchDatasetError";
  }
}

export type BenchDataset = {
  root: string;
  sha256: string;
  manifest: TakeoffBenchManifest;
  truthFiles: ScoreTruthFile[];
  noise: NoiseFile | null;
  /** truth/groups/<id>.json by document id (TI-662: correspondences and page calibrations). */
  groups: Map<string, GroupTruthFile>;
  /** truth/pages/<id>.json by document id (TI-663: the page truth of the triage). */
  pageTruths: Map<string, PageTruthFile>;
  selected: Array<{ document: ManifestDocument; bytes: Buffer }>;
  skipped: Array<{ id: string; reason: string }>;
};

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function byText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function truthJsonFiles(root: string, directory = "truth"): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await truthJsonFiles(root, relative));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(relative);
  }
  return files;
}

export async function datasetSha256(datasetRoot: string) {
  const root = path.resolve(datasetRoot);
  const files = ["manifest.json", ...await truthJsonFiles(root)].sort(byText);
  const lines = await Promise.all(files.map(async (file) => `${file}\t${sha256(await readFile(path.join(root, file)))}\n`));
  return createHash("sha256").update(lines.join("")).digest("hex");
}

/** Reads a binary PDF of the manifest, refused unless its size and SHA-256 are still the manifest's. */
export async function readVerifiedPdf(datasetRoot: string, document: ManifestDocument) {
  if (document.raw_status !== "binary" || document.raw_path === null || document.file_type !== "pdf") {
    throw new BenchDatasetError(`${document.id} has no verified PDF binary.`);
  }
  const bytes = await readFile(path.join(path.resolve(datasetRoot), document.raw_path));
  if (bytes.length !== document.file_size) {
    throw new BenchDatasetError(`${document.raw_path}: size ${bytes.length} bytes, the manifest says ${document.file_size}.`);
  }
  if (sha256(bytes) !== document.sha256) throw new BenchDatasetError(`${document.raw_path}: SHA-256 differs from the manifest.`);
  return bytes;
}

async function requireEntry(root: string, entry: string, kind: "file" | "directory") {
  const stats = await stat(path.join(root, entry)).catch(() => null);
  if (!stats || (kind === "file" ? !stats.isFile() : !stats.isDirectory())) {
    throw new BenchDatasetError(`Dataset refused: ${entry}${kind === "directory" ? "/" : ""} is missing in ${root}.`);
  }
}

async function readJson(root: string, file: string) {
  return JSON.parse(await readFile(path.join(root, file), "utf8")) as unknown;
}

/**
 * `mode: "triage"` selects the documents with a page truth (TI-663). `unscored`: an explicit id may be a PDF without
 * quantity truth (the vector pipeline's load files, TI-662): it runs, unscored.
 */
export async function loadBenchDataset(datasetRoot: string, docs: "all" | readonly string[],
  options: { mode?: "extract" | "triage"; unscored?: boolean } = {}): Promise<BenchDataset> {
  const root = path.resolve(datasetRoot);
  await requireEntry(root, "manifest.json", "file");
  await requireEntry(root, "raw", "directory");
  await requireEntry(root, "truth", "directory");
  const check = await checkTakeoffBenchDataset(root);
  if (!check.ok) {
    const shown = check.errors.slice(0, 10).map(formatBenchIssue).join("\n");
    throw new BenchDatasetError(`takeoff:bench:check refuses the dataset (${check.errors.length} errors):\n${shown}`);
  }
  const manifest = ManifestSchema.parse(await readJson(root, "manifest.json"));
  const truthFiles: ScoreTruthFile[] = [];
  for (const entry of (await readdir(path.join(root, "truth"), { withFileTypes: true })).sort((left, right) => byText(left.name, right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "noise.json") continue;
    const file = `truth/${entry.name}`;
    truthFiles.push({ file, truth: TruthFileSchema.parse(await readJson(root, file)) });
  }
  const groups = new Map<string, GroupTruthFile>();
  for (const entry of await readdir(path.join(root, "truth", "groups"), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) continue;
    const parsed = GroupTruthFileSchema.parse(await readJson(root, `truth/groups/${entry.name}`));
    groups.set(parsed.document, parsed);
  }
  const noiseFile = await stat(path.join(root, "truth", "noise.json")).catch(() => null);
  const noise = noiseFile ? NoiseFileSchema.parse(await readJson(root, "truth/noise.json")) : null;
  const pageTruths = new Map<string, PageTruthFile>();
  const pagesDirectory = await stat(path.join(root, "truth", "pages")).catch(() => null);
  if (pagesDirectory?.isDirectory()) {
    for (const entry of (await readdir(path.join(root, "truth", "pages"), { withFileTypes: true })).sort((left, right) => byText(left.name, right.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const truth = PageTruthFileSchema.parse(await readJson(root, `truth/pages/${entry.name}`));
      if (truth.pages.length) pageTruths.set(truth.document, truth);
    }
  }

  const documents = new Map(manifest.documents.map((document) => [document.id, document]));
  const cited = [...new Set(truthFiles.flatMap(({ truth }) => truth.documents))].sort(byText);
  const usable = (id: string) => documents.get(id)?.raw_status === "binary" && documents.get(id)?.file_type === "pdf";
  const skipped: BenchDataset["skipped"] = [];
  let ids: string[];
  if (options.mode === "triage") {
    const labelled = [...pageTruths.keys()].filter(usable).sort(byText);
    ids = docs === "all" ? labelled : [...docs];
    if (new Set(ids).size !== ids.length) throw new BenchDatasetError("A document is given twice.");
    for (const id of ids) if (!labelled.includes(id)) throw new BenchDatasetError(`${id} has no page truth with a verified binary PDF: the triage cannot score it.`);
    ids.sort(byText);
  } else if (docs === "all") {
    ids = cited.filter((id) => {
      if (usable(id)) return true;
      skipped.push({ id, reason: `no verified binary (raw_status ${documents.get(id)?.raw_status ?? "unknown"})` });
      return false;
    });
  } else {
    ids = [];
    for (const id of docs) {
      if (ids.includes(id)) throw new BenchDatasetError(`${id} is given twice.`);
      if (!cited.includes(id) && !pageTruths.has(id) && !(options.unscored && documents.has(id))) {
        throw new BenchDatasetError(`${id} has no quantity truth nor page truth: no truth/*.json or truth/pages/*.json covers it.`);
      }
      if (!usable(id)) throw new BenchDatasetError(`${id} has no verified binary: the bench cannot read it.`);
      ids.push(id);
    }
    ids.sort(byText);
  }
  const selected = [];
  for (const id of ids) {
    const document = documents.get(id) as ManifestDocument;
    selected.push({ document, bytes: await readVerifiedPdf(root, document) });
  }
  return { root, sha256: await datasetSha256(root), manifest, truthFiles, noise, groups, pageTruths, selected, skipped };
}
