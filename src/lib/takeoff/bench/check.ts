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
  type RowBasis,
  type TruthFile,
  type TruthLine,
  type TruthSource,
} from "@/lib/takeoff/bench/schemas";
import { pdfStructureError, xlsxStructureError } from "@/lib/takeoff/bench/structure";

// Read-only check of the private takeoff bench dataset (TI-659): every binary
// matches its Drive size, its SHA-256 and a structure check (structure.ts); every
// truth file validates, refers to manifest documents of its own lot and uses known
// keys; every workbook row is numbered by a basis its download supports, one per
// document; no devis cell is split between plans or counted twice; truth/noise.json
// records the noise result. It reports every error with its file and JSON path,
// and never writes to the dataset. A truth plan whose download failed keeps its
// devis truth: it is listed in summary.truthWithoutBinary, and the bench skips it.

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
  /** Truth or reserve plans without a verified binary, whose truth comes from a devis. */
  truthWithoutBinary: string[];
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
const MODULE_CLAIM_EPSILON = 1e-9;

type KnownDocument = { index: number; document: ManifestDocument };
/**
 * One use of a workbook row; `column` null means the whole row, which overlaps
 * every column. A module line claims `modules / devisModules` of the cell for
 * each of its `kinds`, the kinds of documents its file covers (plan, schema): a
 * file covering a plan and a schema charges both budgets.
 */
type CellUse = {
  file: string;
  path: string;
  column: string | null;
  module: boolean;
  claim: { modules: number; devisModules: number } | null;
  kinds: readonly string[];
  documents: ReadonlySet<string>;
};

/** The errno code of a file system error; null for any other error, which is a bug of the check. */
function errnoCode(error: unknown) {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? code : null;
}

class DatasetCheck {
  readonly errors: BenchIssue[] = [];
  readonly summary: BenchCheckSummary = {
    documents: 0, verifiedBinaries: 0, truthFiles: 0, truthLines: 0, noise: "absent", pageFiles: 0, groupFiles: 0, lots: {},
    truthWithoutBinary: [],
  };
  /** Every id the manifest lists, even on an entry that fails its schema. */
  readonly knownIds = new Set<string>();
  readonly documents = new Map<string, KnownDocument>();
  readonly coverage = new Set<string>();
  /** raw_path of every manifest entry, valid or not, so that only unnamed files are reported. */
  readonly listedRawPaths = new Set<string>();
  readonly cells = new Map<string, CellUse[]>();
  /** The first row basis each workbook is cited by: one document keeps one numbering of its rows. */
  readonly rowBases = new Map<string, { basis: RowBasis; at: string }>();
  readonly truthWithoutBinary = new Set<string>();
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
      const code = errnoCode(error);
      if (code === null) throw error;
      this.error(file, [], code === "ENOENT" ? "missing" : `unreadable (${code})`);
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
    } catch (error) {
      const code = errnoCode(error);
      if (code === null) throw error;
      if (code !== "ENOENT" && code !== "ENOTDIR") this.error(directory, [], `unreadable directory (${code})`);
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

async function checkBinary(check: DatasetCheck, { index, document }: KnownDocument) {
  const file = document.raw_path as string;
  const absolute = path.join(check.root, file);
  let bytes: Buffer;
  try {
    const stats = await lstat(absolute);
    if (!stats.isFile()) {
      check.error(file, [], "not a regular file (store the file itself, not a link or a folder)");
      return;
    }
    bytes = await readFile(absolute);
  } catch (error) {
    const code = errnoCode(error);
    if (code === null) throw error;
    check.error(file, [], code === "ENOENT" ? `missing, while documents[${index}] says binary` : `unreadable (${code})`);
    return;
  }
  let verified = true;
  if (bytes.length !== document.file_size) {
    check.error(file, [], `size ${bytes.length} bytes differs from the Drive fileSize ${document.file_size}`);
    verified = false;
  } else if (createHash("sha256").update(bytes).digest("hex") !== document.sha256) {
    check.error(file, [], `SHA-256 differs from documents[${index}].sha256`);
    verified = false;
  }
  const structure = document.file_type === "pdf"
    ? await pdfStructureError(bytes, document.pages)
    : xlsxStructureError(bytes);
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

function isTruthPlan(document: ManifestDocument) {
  return (document.role === "truth" || document.role === "reserve")
    && (document.kind === "plan" || document.kind === "schema");
}

/** A level truth holds every zone of its level, a lot truth every plan of its lot (TI-659 section 6). */
function checkScopeCompleteness(check: DatasetCheck, file: string, truth: TruthFile, covered: readonly ManifestDocument[]) {
  let level: string | null = null;
  if (truth.scope === "level") {
    const levels = new Set(covered.map((document) => document.level));
    if (levels.size !== 1 || levels.has(null)) {
      check.error(file, ["documents"], "a level truth covers documents of one level");
      return;
    }
    [level] = levels;
  } else if (truth.scope !== "lot") {
    return;
  }
  const missing = [...check.documents.values()]
    .map(({ document }) => document)
    .filter((document) => document.lot === truth.lot && isTruthPlan(document)
      && (level === null || document.level === level) && !truth.documents.includes(document.id))
    .map((document) => document.id);
  if (missing.length > 0) {
    const scope = level === null ? `lot ${truth.lot}` : `level ${level} of lot ${truth.lot}`;
    check.error(file, ["documents"], `a ${truth.scope} truth covers every truth or reserve plan of ${scope}: `
      + `${missing.join(", ")} missing`);
  }
}

/** A source is a devis or surfaces table of the truth's lot, or the text layer of a plan the truth covers. */
function checkSourceDocument(check: DatasetCheck, file: string, segments: ReadonlyArray<PropertyKey>, truth: TruthFile,
  id: string) {
  const document = check.reference(file, segments, id);
  if (!document) return null;
  if (document.lot !== truth.lot) {
    check.error(file, segments, `${id} belongs to lot ${document.lot}: a lot ${truth.lot} truth reads its own lot's sources`);
  }
  if ((document.kind === "plan" || document.kind === "schema") && !truth.documents.includes(id)) {
    check.error(file, segments, `${id} is a ${document.kind}, not a document of this truth: `
      + "a plan's text layer is a source only of its own truth");
  }
  return document;
}

function checkTruthDocuments(check: DatasetCheck, file: string, truth: TruthFile) {
  const stem = path.posix.basename(file, ".json");
  if (truth.scope === "document" && (truth.documents.length !== 1 || truth.documents[0] !== stem)) {
    check.error(file, ["scope"], "a document truth covers one document and is named truth/<that id>.json");
  }
  const source = checkSourceDocument(check, file, ["source_document"], truth, truth.source_document);
  if (source?.raw_status === "failed") check.error(file, ["source_document"], `${truth.source_document} failed to download`);
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
    if (document.raw_status !== "binary") {
      // Its devis truth stays valid: the bench skips the plan until a binary is stored.
      if (source?.kind === "devis" || source?.kind === "surfaces") {
        check.truthWithoutBinary.add(id);
      } else {
        check.error(file, ["documents", index], `${id} has no verified binary: only a devis or surfaces table `
          + "can be the source of its truth, not its own text layer");
      }
    }
    if (document.lot !== truth.lot) check.error(file, ["documents", index], `${id} belongs to lot ${document.lot}`);
  }
  const roles = new Set(covered.map((document) => document.role));
  if (roles.has("reserve") && roles.has("truth")) {
    check.error(file, ["documents"], "documents mix reserve and truth roles: a reserve is held out whole");
  }
  checkScopeCompleteness(check, file, truth, covered);
  return covered;
}

function lineSources(line: TruthLine, index: number) {
  return [
    { source: line.source, segments: ["lines", index, "source"] },
    ...(line.additional_sources ?? []).map((source, position) => ({
      source, segments: ["lines", index, "additional_sources", position],
    })),
  ];
}

/**
 * A workbook row is numbered as the source's row_basis says: worksheet rows only
 * on a stored binary, Drive text records otherwise, and one basis per document
 * so that one cell keeps one row number across the dataset.
 */
function checkRowBasis(check: DatasetCheck, file: string, segments: ReadonlyArray<PropertyKey>, source: TruthSource,
  document: ManifestDocument) {
  const basis = source.row_basis ?? null;
  if (basis === null) return;
  const at = [...segments, "row_basis"];
  if (document.file_type !== "xlsx") {
    check.error(file, at, `${source.document} is a PDF: a row basis numbers workbook rows`);
    return;
  }
  if (document.raw_status === "failed") return;
  if (basis === "workbook" && document.raw_status !== "binary") {
    check.error(file, at, `${source.document} is ${document.raw_status}: no stored binary shows its worksheet rows, `
      + "cite them by drive_text");
    return;
  }
  const first = check.rowBases.get(source.document);
  if (first === undefined) {
    check.rowBases.set(source.document, { basis, at: `${file}#${formatPath(segments)}` });
  } else if (first.basis !== basis) {
    check.error(file, at, `${source.document} rows are cited by ${first.basis} row in ${first.at}: `
      + "one row basis per document, so that one cell keeps one row number");
  }
}

function checkTruthLines(check: DatasetCheck, file: string, truth: TruthFile, covered: readonly ManifestDocument[]) {
  const { zones, levels } = zonesAndLevels(covered);
  const coveredIds = new Set(truth.documents);
  const names = truth.documents.join(", ");
  const complete = covered.length === truth.documents.length;
  const kinds = [...new Set(covered.map((document) => document.kind))].sort();
  // Rule 7: the lengths of a schema without a title-block scale are not observable on it.
  const unscaled = complete && covered.length > 0 && covered.every((document) => document.kind === "schema"
    && document.scale === null && document.scales === undefined);
  for (const [index, line] of truth.lines.entries()) {
    if (line.zone !== null && complete && !zones.has(line.zone)) {
      check.error(file, ["lines", index, "zone"], `zone ${line.zone} is not a zone of ${names}`);
    }
    if (line.level !== null && complete && !levels.has(line.level)) {
      check.error(file, ["lines", index, "level"], `level ${line.level} is not a level of ${names}`);
    }
    if (unscaled && line.unit === "ml" && line.observable_on_plan) {
      check.error(file, ["lines", index, "observable_on_plan"], `${names} is a schema with no scale: its lengths are `
        + "not observable on the plan (rule 7, plan_cause no_scale)");
    }
    const claim = line.module_scope === "module" && truth.modules_on_plan != null && line.devis_modules !== undefined
      ? { modules: truth.modules_on_plan, devisModules: line.devis_modules }
      : null;
    for (const { source, segments } of lineSources(line, index)) {
      const document = checkSourceDocument(check, file, [...segments, "document"], truth, source.document);
      if (document?.raw_status === "failed") check.error(file, segments, `${source.document} failed to download: it is no source`);
      if (document?.file_type === "xlsx" && (source.sheet === null || source.row === null)) {
        check.error(file, segments, `${source.document} is a workbook: the source names its sheet and row`);
      }
      if (document?.file_type === "pdf" && (source.page ?? null) === null) {
        check.error(file, segments, `${source.document} is a PDF: the source names its page`);
      }
      if (document?.file_type === "pdf" && source.page != null && document.pages != null && source.page > document.pages) {
        check.error(file, [...segments, "page"],
          `page ${source.page} is beyond the ${document.pages} page${document.pages > 1 ? "s" : ""} of ${document.id}`);
      }
      if (document) checkRowBasis(check, file, segments, source, document);
      if (document && source.column != null) {
        if (document.columns === undefined) {
          check.error(file, [...segments, "column"], `${source.document} declares no columns in the manifest: `
            + "a source names a column by a header its document declares");
        } else if (!document.columns.includes(source.column)) {
          check.error(file, [...segments, "column"],
            `${source.column} is not a column ${source.document} declares (${document.columns.join(", ")})`);
        }
      }
      if (source.sheet !== null && source.row !== null) {
        const cell = `${source.document} / ${source.sheet} / row ${source.row}`;
        const uses = check.cells.get(cell) ?? [];
        uses.push({
          file, path: formatPath(segments), column: source.column ?? null,
          module: line.module_scope === "module", claim, kinds, documents: coveredIds,
        });
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

function sameCell(left: CellUse, right: CellUse) {
  return left.column === null || right.column === null || left.column === right.column;
}

function formatClaim(uses: readonly CellUse[]) {
  const claims = uses.map((use) => use.claim as NonNullable<CellUse["claim"]>);
  const [first] = claims;
  if (claims.every((claim) => claim.devisModules === first.devisModules)) {
    return `${claims.reduce((sum, claim) => sum + claim.modules, 0)}/${first.devisModules}`;
  }
  return `${Number(claims.reduce((sum, claim) => sum + claim.modules / claim.devisModules, 0).toFixed(4))} times`;
}

/**
 * Lot C: the plans (or the schemas) that cite one cell never claim more modules
 * than the devis counts. A file covering both kinds counts in both budgets.
 */
function checkModuleClaims(check: DatasetCheck, row: string, uses: readonly CellUse[]) {
  const views = new Map<string, CellUse[]>();
  for (const use of uses) {
    if (!use.module || use.claim === null) continue;
    for (const kind of use.kinds) views.set(kind, [...(views.get(kind) ?? []), use]);
  }
  const reported = new Set<CellUse>();
  for (const [view, viewUses] of views) {
    const columns = [...new Set(viewUses.map((use) => use.column).filter((column) => column !== null))];
    const buckets = columns.length === 0
      ? [{ column: null, uses: viewUses }]
      : columns.map((column) => ({ column, uses: viewUses.filter((use) => use.column === null || use.column === column) }));
    for (const bucket of buckets) {
      let total = 0;
      for (const [position, use] of bucket.uses.entries()) {
        const claim = use.claim as NonNullable<CellUse["claim"]>;
        total += claim.modules / claim.devisModules;
        if (total <= 1 + MODULE_CLAIM_EPSILON || reported.has(use)) continue;
        reported.add(use);
        const cell = bucket.column === null ? row : `${row}, column ${bucket.column}`;
        const claimed = bucket.uses.slice(0, position + 1);
        check.errors.push({
          file: use.file,
          path: use.path,
          message: `devis cell ${cell}: the ${view} files claim ${formatClaim(claimed)} of its modules `
            + `(${[...new Set(claimed.map((entry) => entry.file))].join(", ")}): more modules than the devis counts`,
        });
        break;
      }
    }
  }
}

function checkCells(check: DatasetCheck) {
  for (const [row, uses] of check.cells) {
    for (const [position, use] of uses.entries()) {
      const conflict = uses.slice(0, position).find((earlier) => sameCell(earlier, use) && !(earlier.module && use.module
        && earlier.file !== use.file && [...earlier.documents].every((id) => !use.documents.has(id))));
      if (conflict) {
        const cell = use.column === null ? row : `${row}, column ${use.column}`;
        const other = conflict.column === use.column ? "" : ` (${conflict.column === null ? "whole row" : `column ${conflict.column}`})`;
        check.errors.push({
          file: use.file,
          path: use.path,
          message: `devis cell ${cell} is already used by ${conflict.file}#${conflict.path}${other}: `
            + "a quantity is never split between plans nor counted twice",
        });
      }
    }
    checkModuleClaims(check, row, uses);
  }
}

function checkCoverage(check: DatasetCheck) {
  if (!check.coverageComplete) return;
  for (const { index, document } of check.documents.values()) {
    if (isTruthPlan(document) && !check.coverage.has(document.id)) {
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
  if (!entries.some((entry) => entry.name === "noise.json")) {
    check.error("truth/noise.json", [], "missing: record the noise result, or status not_measured with its reason "
      + "when it cannot be measured (TI-659 section 9)");
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
  check.summary.truthWithoutBinary = [...check.truthWithoutBinary].sort();
  return { ok: check.errors.length === 0, errors: check.errors, summary: check.summary };
}
