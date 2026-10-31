import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { z } from "zod";

import { DOCUMENT_ID_PATTERN, type TruthLot } from "@/lib/takeoff/bench/keys";
import {
  GroupTruthFileSchema,
  ManifestDocumentSchema,
  ManifestSchema,
  NoiseFileSchema,
  PageTruthFileSchema,
  TruthFileSchema,
  type ManifestDocument,
  type TruthFile,
} from "@/lib/takeoff/bench/schemas";

// Read-only check of the private takeoff bench dataset (TI-659): every binary
// matches its Drive size, its SHA-256 and a structure check; every truth file
// validates, refers to manifest documents and uses known keys. It reports every
// error with its file and JSON path, and never writes to the dataset.

export type BenchIssue = { file: string; path: string; message: string };
export type BenchLotSummary = { lines: number; observable: number };
export type BenchCheckSummary = {
  documents: number;
  verifiedBinaries: number;
  truthFiles: number;
  truthLines: number;
  noise: "measured" | "not_measured" | "absent";
  pageFiles: number;
  groupFiles: number;
  lots: Partial<Record<TruthLot, BenchLotSummary>>;
};
export type BenchCheckResult = { ok: boolean; errors: BenchIssue[]; summary: BenchCheckSummary };

export function formatBenchIssue(issue: BenchIssue) {
  return `${issue.file}${issue.path ? `#${issue.path}` : ""}: ${issue.message}`;
}

function formatPath(segments: ReadonlyArray<PropertyKey>) {
  return segments.reduce<string>((out, segment) => typeof segment === "number"
    ? `${out}[${segment}]`
    : out ? `${out}.${String(segment)}` : String(segment), "");
}

const TRUTH_FILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;
const PDF_EDGE_BYTES = 1024;

type KnownDocument = { index: number; document: ManifestDocument };
type CellUse = { file: string; path: string; module: boolean; documents: ReadonlySet<string> };

class DatasetCheck {
  readonly errors: BenchIssue[] = [];
  readonly summary: BenchCheckSummary = {
    documents: 0, verifiedBinaries: 0, truthFiles: 0, truthLines: 0, noise: "absent", pageFiles: 0, groupFiles: 0, lots: {},
  };
  /** Every id the manifest lists, even on an entry that fails its schema. */
  readonly knownIds = new Set<string>();
  readonly documents = new Map<string, KnownDocument>();
  readonly coverage = new Set<string>();
  /** raw_path of every manifest entry, valid or not, so that only unnamed files are reported. */
  readonly listedRawPaths = new Set<string>();
  readonly cells = new Map<string, CellUse[]>();
  coverageComplete = true;

  constructor(readonly root: string) {}

  error(file: string, segments: ReadonlyArray<PropertyKey>, message: string) {
    this.errors.push({ file, path: formatPath(segments), message });
  }

  zodErrors(file: string, error: z.ZodError, prefix: ReadonlyArray<PropertyKey> = []) {
    for (const issue of error.issues) this.error(file, [...prefix, ...issue.path], issue.message);
  }

  async readJson(file: string): Promise<{ value: unknown } | null> {
    let source: string;
    try {
      source = await readFile(path.join(this.root, file), "utf8");
    } catch (error) {
      this.error(file, [], (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable");
      return null;
    }
    try {
      return { value: JSON.parse(source) as unknown };
    } catch (error) {
      this.error(file, [], `invalid JSON: ${(error as Error).message}`);
      return null;
    }
  }

  async listDirectory(directory: string) {
    try {
      return (await readdir(path.join(this.root, directory), { withFileTypes: true }))
        .filter((entry) => !entry.name.startsWith("."))
        .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    } catch {
      return null;
    }
  }

  reference(file: string, segments: ReadonlyArray<PropertyKey>, id: string) {
    if (!this.knownIds.has(id)) {
      this.error(file, segments, `${id} is not in the manifest`);
      return null;
    }
    return this.documents.get(id)?.document ?? null;
  }
}

// ---------------------------------------------------------------------------
// Binaries

function pdfStructureError(bytes: Buffer) {
  if (!bytes.subarray(0, PDF_EDGE_BYTES).toString("latin1").includes("%PDF-")) {
    return "no %PDF- header in the first 1024 bytes (undecoded base64 or not a PDF?)";
  }
  if (!bytes.subarray(Math.max(0, bytes.length - PDF_EDGE_BYTES)).toString("latin1").includes("%%EOF")) {
    return "no %%EOF marker in the last 1024 bytes (truncated download?)";
  }
  return null;
}

const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_ENTRY_SIGNATURE = 0x02014b50;

function xlsxStructureError(bytes: Buffer) {
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_END_SIGNATURE) {
      end = offset;
      break;
    }
  }
  if (end < 0) return "not a ZIP archive: no end of central directory (undecoded base64 or truncated download?)";
  const entries = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const start = bytes.readUInt32LE(end + 16);
  if (entries === 0xffff || size === 0xffffffff || start === 0xffffffff) return "ZIP64 archive: not an expected XLSX";
  if (start + size > end) return "ZIP central directory overlaps its end record";
  const names = new Set<string>();
  let cursor = start;
  for (let entry = 0; entry < entries; entry += 1) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== ZIP_ENTRY_SIGNATURE) return "corrupt ZIP central directory entry";
    const nameLength = bytes.readUInt16LE(cursor + 28);
    names.add(bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));
    cursor += 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }
  if (cursor !== start + size) return "ZIP central directory size does not match its entries";
  for (const required of ["[Content_Types].xml", "xl/workbook.xml"]) {
    if (!names.has(required)) return `ZIP archive without ${required}: not an XLSX workbook`;
  }
  return null;
}

async function checkBinary(check: DatasetCheck, { index, document }: KnownDocument) {
  const file = document.raw_path as string;
  const absolute = path.join(check.root, file);
  try {
    const stats = await lstat(absolute);
    if (!stats.isFile()) {
      check.error(file, [], "not a regular file (store the file itself, not a link or a folder)");
      return;
    }
  } catch {
    check.error(file, [], `missing, while documents[${index}] says binary`);
    return;
  }
  const bytes = await readFile(absolute);
  let verified = true;
  if (bytes.length !== document.file_size) {
    check.error(file, [], `size ${bytes.length} bytes differs from the Drive fileSize ${document.file_size}`);
    verified = false;
  } else if (createHash("sha256").update(bytes).digest("hex") !== document.sha256) {
    check.error(file, [], `SHA-256 differs from documents[${index}].sha256`);
    verified = false;
  }
  const structure = document.file_type === "pdf" ? pdfStructureError(bytes) : xlsxStructureError(bytes);
  if (structure) {
    check.error(file, [], structure);
    verified = false;
  }
  if (verified) check.summary.verifiedBinaries += 1;
}

// ---------------------------------------------------------------------------
// Manifest

async function checkManifest(check: DatasetCheck) {
  const file = "manifest.json";
  const json = await check.readJson(file);
  if (!json) return false;
  const raw = json.value as { documents?: unknown } | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.documents)) {
    check.error(file, ["documents"], "the manifest is an object with a documents array");
    return false;
  }
  // Documents are parsed one by one below, so that one bad entry does not hide the others.
  const { documents: entries, ...header } = raw as { documents: unknown[] };
  const parsedHeader = ManifestSchema.omit({ documents: true }).safeParse(header);
  if (!parsedHeader.success) check.zodErrors(file, parsedHeader.error);

  const driveIds = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    const { id, raw_path: rawPath } = (entry ?? {}) as { id?: unknown; raw_path?: unknown };
    if (typeof id === "string" && DOCUMENT_ID_PATTERN.test(id)) {
      if (check.knownIds.has(id)) check.error(file, ["documents", index, "id"], `${id} is listed twice`);
      check.knownIds.add(id);
    }
    if (typeof rawPath === "string") check.listedRawPaths.add(rawPath);
    const parsed = ManifestDocumentSchema.safeParse(entry);
    if (!parsed.success) {
      check.zodErrors(file, parsed.error, ["documents", index]);
      continue;
    }
    const document = parsed.data;
    if (!check.documents.has(document.id)) check.documents.set(document.id, { index, document });
    const sameDrive = driveIds.get(document.drive_id);
    if (sameDrive !== undefined) check.error(file, ["documents", index, "drive_id"], `same drive_id as documents[${sameDrive}]`);
    else driveIds.set(document.drive_id, index);
  }
  check.summary.documents = entries.length;

  for (const { index, document } of check.documents.values()) {
    if (document.duplicate_of !== null) check.reference(file, ["documents", index, "duplicate_of"], document.duplicate_of);
  }
  return true;
}

async function checkRawDirectory(check: DatasetCheck) {
  // The schema pins a binary's raw_path to raw/<id>.<ext>: nothing outside raw/ is read.
  for (const known of check.documents.values()) {
    if (known.document.raw_status === "binary") await checkBinary(check, known);
  }
  for (const entry of (await check.listDirectory("raw")) ?? []) {
    const file = `raw/${entry.name}`;
    if (!check.listedRawPaths.has(file)) {
      check.error(file, [], "not listed in the manifest (raw files are named <anonymous id>.<ext>)");
    }
  }
}

// ---------------------------------------------------------------------------
// Truth files

function zonesAndLevels(documents: readonly ManifestDocument[]) {
  const zones = new Set<string>();
  const levels = new Set<string>();
  for (const document of documents) {
    for (const scope of [document, ...(document.page_ranges ?? [])]) {
      if (scope.zone !== null) zones.add(scope.zone);
      if (scope.level !== null) levels.add(scope.level);
    }
  }
  return { zones, levels };
}

function checkTruthDocuments(check: DatasetCheck, file: string, truth: TruthFile) {
  const stem = path.posix.basename(file, ".json");
  if (truth.scope === "document" && (truth.documents.length !== 1 || truth.documents[0] !== stem)) {
    check.error(file, ["scope"], "a document truth covers one document and is named truth/<that id>.json");
  }
  const covered: ManifestDocument[] = [];
  for (const [index, id] of truth.documents.entries()) {
    const document = check.reference(file, ["documents", index], id);
    if (!document) continue;
    covered.push(document);
    if (document.role !== "truth" && document.role !== "reserve") {
      check.error(file, ["documents", index], `${id} has role ${document.role}: no truth file covers it`);
    }
    if (document.kind !== "plan" && document.kind !== "schema") {
      check.error(file, ["documents", index], `${id} is a ${document.kind}: truth covers plans and schemas`);
    }
    if (document.raw_status !== "binary") check.error(file, ["documents", index], `${id} has no verified binary`);
    if (document.lot !== truth.lot) check.error(file, ["documents", index], `${id} belongs to lot ${document.lot}`);
  }
  const roles = new Set(covered.map((document) => document.role));
  if (roles.has("reserve") && roles.has("truth")) {
    check.error(file, ["documents"], "documents mix reserve and truth roles: a reserve is held out whole");
  }
  if (truth.scope === "level") {
    const levels = new Set(covered.map((document) => document.level));
    if (levels.size !== 1 || levels.has(null)) check.error(file, ["documents"], "a level truth covers documents of one level");
  }
  const source = check.reference(file, ["source_document"], truth.source_document);
  if (source?.raw_status === "failed") check.error(file, ["source_document"], `${truth.source_document} failed to download`);
  return covered;
}

function checkTruthLines(check: DatasetCheck, file: string, truth: TruthFile, covered: readonly ManifestDocument[]) {
  const { zones, levels } = zonesAndLevels(covered);
  const coveredIds = new Set(truth.documents);
  const names = truth.documents.join(", ");
  for (const [index, line] of truth.lines.entries()) {
    if (line.zone !== null && covered.length === truth.documents.length && !zones.has(line.zone)) {
      check.error(file, ["lines", index, "zone"], `zone ${line.zone} is not a zone of ${names}`);
    }
    if (line.level !== null && covered.length === truth.documents.length && !levels.has(line.level)) {
      check.error(file, ["lines", index, "level"], `level ${line.level} is not a level of ${names}`);
    }
    const sources = [
      { source: line.source, segments: ["lines", index, "source"] },
      ...(line.additional_sources ?? []).map((source, position) => ({
        source, segments: ["lines", index, "additional_sources", position],
      })),
    ];
    for (const { source, segments } of sources) {
      const document = check.reference(file, [...segments, "document"], source.document);
      if (document?.file_type === "xlsx" && (source.sheet === null || source.row === null)) {
        check.error(file, segments, `${source.document} is a workbook: the source names its sheet and row`);
      }
      if (document?.file_type === "pdf" && (source.page ?? null) === null) {
        check.error(file, segments, `${source.document} is a PDF: the source names its page`);
      }
      if (source.sheet !== null && source.row !== null) {
        const cell = `${source.document} / ${source.sheet} / row ${source.row}`;
        const uses = check.cells.get(cell) ?? [];
        uses.push({ file, path: formatPath(segments), module: line.module_scope === "module", documents: coveredIds });
        check.cells.set(cell, uses);
      }
    }
  }
  const lot = check.summary.lots[truth.lot] ?? { lines: 0, observable: 0 };
  lot.lines += truth.lines.length;
  lot.observable += truth.lines.filter((line) => line.observable_on_plan).length;
  check.summary.lots[truth.lot] = lot;
  check.summary.truthLines += truth.lines.length;
}

async function checkTruthFile(check: DatasetCheck, file: string) {
  check.summary.truthFiles += 1;
  const json = await check.readJson(file);
  if (!json) {
    check.coverageComplete = false;
    return;
  }
  const rawDocuments = (json.value as { documents?: unknown } | null)?.documents;
  // Coverage stays known when the file is out of schema but still lists its documents.
  if (Array.isArray(rawDocuments)) {
    for (const id of rawDocuments) if (typeof id === "string") check.coverage.add(id);
  } else {
    check.coverageComplete = false;
  }
  const parsed = TruthFileSchema.safeParse(json.value);
  if (!parsed.success) {
    check.zodErrors(file, parsed.error);
    return;
  }
  const covered = checkTruthDocuments(check, file, parsed.data);
  checkTruthLines(check, file, parsed.data, covered);
}

function checkCells(check: DatasetCheck) {
  for (const [cell, uses] of check.cells) {
    for (const [position, use] of uses.entries()) {
      const conflict = uses.slice(0, position).find((earlier) => !(earlier.module && use.module
        && earlier.file !== use.file && [...earlier.documents].every((id) => !use.documents.has(id))));
      if (conflict) {
        check.errors.push({
          file: use.file,
          path: use.path,
          message: `devis cell ${cell} is already used by ${conflict.file}#${conflict.path}: `
            + "a quantity is never split between plans nor counted twice",
        });
      }
    }
  }
}

function checkCoverage(check: DatasetCheck) {
  if (!check.coverageComplete) return;
  for (const { index, document } of check.documents.values()) {
    if ((document.role === "truth" || document.role === "reserve")
      && (document.kind === "plan" || document.kind === "schema") && !check.coverage.has(document.id)) {
      check.error("manifest.json", ["documents", index], `${document.id} is a ${document.role} ${document.kind} with no truth file`);
    }
  }
}

async function checkNoise(check: DatasetCheck, file: string) {
  const json = await check.readJson(file);
  if (!json) return;
  const parsed = NoiseFileSchema.safeParse(json.value);
  if (!parsed.success) {
    check.zodErrors(file, parsed.error);
    return;
  }
  const noise = parsed.data;
  check.summary.noise = noise.status;
  if (noise.baseline_document !== null) check.reference(file, ["baseline_document"], noise.baseline_document);
  if (noise.comparison_document !== null) check.reference(file, ["comparison_document"], noise.comparison_document);
  const covered = noise.documents.map((id, index) => check.reference(file, ["documents", index], id))
    .filter((document): document is ManifestDocument => document !== null);
  if (covered.length !== noise.documents.length) return;
  const { zones, levels } = zonesAndLevels(covered);
  for (const [index, key] of noise.keys.entries()) {
    if (key.zone !== null && !zones.has(key.zone)) check.error(file, ["keys", index, "zone"], `zone ${key.zone} is not a zone of the noise documents`);
    if (key.level !== null && !levels.has(key.level)) check.error(file, ["keys", index, "level"], `level ${key.level} is not a level of the noise documents`);
  }
}

function parseAnnotation(kind: "pages" | "groups", value: unknown) {
  if (kind === "pages") {
    const parsed = PageTruthFileSchema.safeParse(value);
    return parsed.success
      ? { success: true as const, document: parsed.data.document, pages: parsed.data.pages.map((entry) => entry.page) }
      : parsed;
  }
  const parsed = GroupTruthFileSchema.safeParse(value);
  return parsed.success
    ? { success: true as const, document: parsed.data.document, pages: parsed.data.groups.map((entry) => entry.page) }
    : parsed;
}

async function checkAnnotationFile(check: DatasetCheck, file: string, kind: "pages" | "groups") {
  const json = await check.readJson(file);
  if (!json) return;
  const parsed = parseAnnotation(kind, json.value);
  if (!parsed.success) {
    check.zodErrors(file, parsed.error);
    return;
  }
  const document = check.reference(file, ["document"], parsed.document);
  if (kind === "pages") {
    if (path.posix.basename(file, ".json") !== parsed.document) {
      check.error(file, ["document"], "a page truth is named truth/pages/<document id>.json");
    }
    if (new Set(parsed.pages).size !== parsed.pages.length) check.error(file, ["pages"], "a page is listed twice");
  }
  if (document?.pages == null) return;
  for (const [index, page] of parsed.pages.entries()) {
    if (page > document.pages) {
      check.error(file, [kind, index, "page"],
        `page ${page} is beyond the ${document.pages} page${document.pages > 1 ? "s" : ""} of ${document.id}`);
    }
  }
}

async function checkAnnotations(check: DatasetCheck, kind: "pages" | "groups") {
  for (const entry of (await check.listDirectory(`truth/${kind}`)) ?? []) {
    const file = `truth/${kind}/${entry.name}`;
    if (!entry.isFile() || !TRUTH_FILE_NAME.test(entry.name)) {
      check.error(file, [], "unexpected entry: annotation files are <document id>.json");
      continue;
    }
    check.summary[kind === "pages" ? "pageFiles" : "groupFiles"] += 1;
    await checkAnnotationFile(check, file, kind);
  }
}

async function checkTruthDirectory(check: DatasetCheck) {
  const entries = await check.listDirectory("truth");
  if (!entries) {
    check.error("truth", [], "missing truth directory");
    check.coverageComplete = false;
    return;
  }
  for (const entry of entries) {
    const file = `truth/${entry.name}`;
    if (entry.isDirectory() && (entry.name === "pages" || entry.name === "groups")) continue;
    if (!entry.isFile() || !TRUTH_FILE_NAME.test(entry.name)) {
      check.error(file, [], "unexpected entry: truth files are <lowercase anonymous name>.json");
      continue;
    }
    if (entry.name === "noise.json") await checkNoise(check, file);
    else await checkTruthFile(check, file);
  }
  await checkAnnotations(check, "pages");
  await checkAnnotations(check, "groups");
}

export async function checkTakeoffBenchDataset(datasetRoot: string): Promise<BenchCheckResult> {
  const check = new DatasetCheck(path.resolve(datasetRoot));
  if (await checkManifest(check)) {
    await checkRawDirectory(check);
    await checkTruthDirectory(check);
    checkCells(check);
    checkCoverage(check);
  }
  return { ok: check.errors.length === 0, errors: check.errors, summary: check.summary };
}
