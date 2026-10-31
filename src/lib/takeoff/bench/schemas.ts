import { z } from "zod";

import { DN_KEY_PATTERN, knownDnKeys } from "@/lib/takeoff/bench/diameters";
import {
  BENCH_LOTS,
  DOCUMENT_ID_PATTERN,
  DOCUMENT_KINDS,
  LINE_KINDS,
  MATERIAL_CODES,
  NETWORK_CODES,
  ORGAN_CODES,
  PLAN_CAUSES,
  TRUTH_LOTS,
  UNITS,
  UNITS_BY_KIND,
} from "@/lib/takeoff/bench/keys";

// Schemas of the private takeoff bench dataset (TI-659). The dataset lives outside
// Git (`outputs/takeoff-bench-dataset/`): `manifest.json`, `raw/<id>.<ext>`,
// `truth/<id>.json`, `truth/noise.json`, and the optional `truth/pages/` (page
// types, owned by TI-663) and `truth/groups/` (path-group classes, owned by
// TI-662). Objects are strict so that a misspelt field fails instead of being
// ignored; the pages and groups schemas stay minimal and open for their owners.

type Path = Array<string | number>;
type Ctx = z.RefinementCtx;

function addIssue(ctx: Ctx, path: Path, message: string) {
  ctx.addIssue({ code: "custom", path, message });
}

const Text = z.string().trim().min(1);
const NullableText = Text.nullable();

export const DocumentIdSchema = z.string().regex(
  DOCUMENT_ID_PATTERN,
  "must be an anonymous id <lot>-<kind>-<nn>, e.g. a-plan-01"
);

function knownCode<const T extends readonly [string, ...string[]]>(codes: T, name: string) {
  return z.enum(codes, {
    error: (issue) => issue.input === undefined
      ? `${name} is required`
      : `unknown ${name} ${JSON.stringify(issue.input)} (known keys: src/lib/takeoff/bench/keys.ts)`,
  });
}

const DnSchema = z.string()
  .regex(DN_KEY_PATTERN, { message: "must look like \"DN 22\"", abort: true })
  .superRefine((value, ctx) => {
    if (!knownDnKeys(null).has(value)) {
      ctx.addIssue({
        code: "custom",
        message: `unknown ${value}: no series has this size (src/lib/takeoff/bench/diameters.ts)`,
      });
    }
  });

// ---------------------------------------------------------------------------
// manifest.json

export const RAW_STATUSES = ["binary", "text_only", "failed"] as const;
export const DOCUMENT_ROLES = ["truth", "reserve", "no_truth", "load_test"] as const;
export const FILE_TYPES = ["pdf", "xlsx"] as const;

const StructureCheckSchema = z.strictObject({
  status: z.enum(["passed", "failed", "not_run"]),
  /** What was run, e.g. "pdfjs pages + %%EOF" or "unzip -tq". */
  method: NullableText,
  detail: NullableText,
});

const ScaleSchema = z.string().regex(/^1\/[1-9]\d*$/, "must look like \"1/50\"");

const PageRangeSchema = z.strictObject({
  from: z.number().int().min(1),
  to: z.number().int().min(1),
  level: NullableText,
  zone: NullableText,
  notes: NullableText.optional(),
});

export const ManifestDocumentSchema = z.strictObject({
  id: DocumentIdSchema,
  lot: z.enum(BENCH_LOTS),
  kind: z.enum(DOCUMENT_KINDS),
  drive_id: Text,
  original_title: Text,
  project: NullableText.optional(),
  file_type: z.enum(FILE_TYPES),
  /** Drive `fileSize` in bytes, recorded at inventory. */
  file_size: z.number().int().nonnegative().nullable(),
  /** Drive `modifiedTime`. */
  modified_time: z.iso.datetime({ offset: true }),
  raw_status: z.enum(RAW_STATUSES),
  raw_path: z.string().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hexadecimal SHA-256").nullable(),
  structure_check: StructureCheckSchema,
  pages: z.number().int().min(1).nullable(),
  /** Paper format from the title block (A0, A1…), not the file type. */
  format: NullableText,
  /** Title-block scale, e.g. "1/50"; null for an unscaled schema or a sheet with several scales. */
  scale: ScaleSchema.nullable(),
  /** The scales of a sheet whose views have several (title block "as indicated"); scale is null then. */
  scales: z.array(ScaleSchema).min(2, "scales lists at least 2 scales (a single one goes in scale)").optional(),
  /** Title-block revision index (indice). */
  index: NullableText,
  vector: z.boolean().nullable(),
  ocg_count: z.number().int().nonnegative().nullable(),
  level: NullableText,
  zone: NullableText,
  /** Levels and zones by page range when one PDF holds several. */
  page_ranges: z.array(PageRangeSchema).optional(),
  /**
   * Workbook columns that truth sources cite, by their header as printed (one
   * quantity column per zone, for instance). A source names a column only from
   * this list, so that one cell never gets two names (a letter and a header).
   */
  columns: z.array(Text).min(1).optional(),
  role: z.enum(DOCUMENT_ROLES),
  duplicate_of: DocumentIdSchema.nullable(),
  notes: NullableText,
}).superRefine((document, ctx) => {
  const [, lot, kind] = DOCUMENT_ID_PATTERN.exec(document.id) ?? [];
  if (lot !== document.lot) addIssue(ctx, ["id"], `id ${document.id} does not match lot ${document.lot}`);
  if (kind !== document.kind) addIssue(ctx, ["id"], `id ${document.id} does not match kind ${document.kind}`);

  const expectedPath = `raw/${document.id}.${document.file_type}`;
  if (document.raw_status === "binary") {
    if (document.raw_path !== expectedPath) addIssue(ctx, ["raw_path"], `a binary is stored at "${expectedPath}"`);
    if (document.sha256 === null) addIssue(ctx, ["sha256"], "a binary needs its SHA-256");
    if (document.file_size === null) addIssue(ctx, ["file_size"], "a binary needs the Drive fileSize");
    if (document.structure_check.status !== "passed") {
      addIssue(ctx, ["structure_check", "status"], "a binary must have passed its structure check");
    }
    if (document.file_type === "pdf" && document.pages === null) addIssue(ctx, ["pages"], "a binary PDF needs its page count");
  } else {
    if (document.raw_path !== null) {
      addIssue(ctx, ["raw_path"], `only a binary has a raw_path (it would be "${expectedPath}")`);
    }
    if (document.sha256 !== null) addIssue(ctx, ["sha256"], `a ${document.raw_status} document has no SHA-256`);
  }
  if (document.raw_status === "failed" && document.notes === null) {
    addIssue(ctx, ["notes"], "a failed download says what failed in notes");
  }
  if (document.role === "reserve" && document.kind !== "plan" && document.kind !== "schema") {
    addIssue(ctx, ["role"], "only a plan or a schema is held in reserve");
  }
  if ((document.role === "load_test") !== (document.lot === "load")) {
    addIssue(ctx, ["role"], "the load_test role belongs to lot load, and only to it");
  }
  if (document.duplicate_of === document.id) addIssue(ctx, ["duplicate_of"], "a document does not duplicate itself");
  if (document.scales !== undefined) {
    if (document.scale !== null) addIssue(ctx, ["scales"], "with scales, scale is null: a sheet with several scales has no single one");
    if (new Set(document.scales).size !== document.scales.length) addIssue(ctx, ["scales"], "a scale is listed twice");
  }
  if (document.columns !== undefined) {
    if (document.file_type !== "xlsx") addIssue(ctx, ["columns"], "only a workbook declares columns");
    if (new Set(document.columns).size !== document.columns.length) addIssue(ctx, ["columns"], "a column is listed twice");
  }

  let previousEnd = 0;
  for (const [index, range] of (document.page_ranges ?? []).entries()) {
    if (range.from > range.to) addIssue(ctx, ["page_ranges", index], "from is after to");
    if (range.from <= previousEnd) addIssue(ctx, ["page_ranges", index], "page ranges are sorted and do not overlap");
    if (document.pages !== null && range.to > document.pages) {
      addIssue(ctx, ["page_ranges", index, "to"], `beyond the ${document.pages} pages of the document`);
    }
    previousEnd = Math.max(previousEnd, range.to);
  }
});

export const ManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  notes: NullableText.optional(),
  documents: z.array(ManifestDocumentSchema),
});

// ---------------------------------------------------------------------------
// Quantity keys, shared by truth lines and noise keys

const keyShape = {
  kind: knownCode(LINE_KINDS, "kind"),
  zone: NullableText,
  level: NullableText,
  network: knownCode(NETWORK_CODES, "network").nullable(),
  material: knownCode(MATERIAL_CODES, "material").nullable(),
  dn: DnSchema.nullable(),
  organ: knownCode(ORGAN_CODES, "organ").nullable(),
  /** Printed room label; a label repeated on one level takes " #2", " #3" in reading order. */
  room: NullableText,
  unit: knownCode(UNITS, "unit"),
};

type QuantityKey = z.infer<z.ZodObject<typeof keyShape>>;

function checkKey(key: QuantityKey, ctx: Ctx) {
  const forbid = (field: keyof QuantityKey) => {
    if (key[field] !== null) addIssue(ctx, [field], `a ${key.kind} line has no ${field}`);
  };
  const need = (field: keyof QuantityKey) => {
    if (key[field] === null) addIssue(ctx, [field], `a ${key.kind} line needs its ${field}`);
  };
  if (key.kind === "network") {
    need("network");
    forbid("organ");
    forbid("room");
  } else if (key.kind === "count") {
    need("organ");
    forbid("room");
  } else {
    need("room");
    need("level");
    for (const field of ["network", "material", "dn", "organ"] as const) forbid(field);
  }
  if (!UNITS_BY_KIND[key.kind].includes(key.unit)) {
    addIssue(ctx, ["unit"], `unit ${key.unit} is not used by a ${key.kind} line (${UNITS_BY_KIND[key.kind].join(", ")})`);
  }
  if (key.dn !== null && key.material !== null && !knownDnKeys(key.material).has(key.dn)) {
    addIssue(ctx, ["dn"], `unknown ${key.dn} for material ${key.material} (src/lib/takeoff/bench/diameters.ts)`);
  }
}

function keyIdentity(key: QuantityKey, phase: string | null = null) {
  return JSON.stringify([key.kind, key.zone, key.level, key.network, key.material, key.dn, key.organ, key.room,
    key.unit, phase]);
}

// ---------------------------------------------------------------------------
// truth/<id>.json

export const TruthSourceSchema = z.strictObject({
  document: DocumentIdSchema,
  /** Workbook sheet (onglet); required when the document is an XLSX. */
  sheet: NullableText,
  /** 1-based workbook row; required when the document is an XLSX. */
  row: z.number().int().min(1).nullable(),
  /**
   * Column header when one row holds several quantities (one per zone), as the
   * manifest declares it in the document's `columns`; never a column letter.
   * Absent: the whole row.
   */
  column: NullableText.optional(),
  /** 1-based PDF page; required when the document is a PDF (text layer). */
  page: z.number().int().min(1).nullable().optional(),
  /** Designation of the cell or printed text the quantity comes from. */
  text: Text,
});

export const TruthLineSchema = z.strictObject({
  ...keyShape,
  /** Expected quantity over the truth file's scope; null only when ambiguous. */
  quantity: z.number().nonnegative().nullable(),
  source: TruthSourceSchema,
  /** Further cells summed into this key when the devis spreads it over several rows. */
  additional_sources: z.array(TruthSourceSchema).optional(),
  observable_on_plan: z.boolean(),
  plan_cause: z.enum(PLAN_CAUSES).optional(),
  // Lot C (repeated modules), rule 7 of TI-659.
  devis_quantity: z.number().nonnegative().optional(),
  devis_modules: z.number().int().min(1).optional(),
  module_scope: z.enum(["module", "commun"]).optional(),
  phase: z.enum(["atelier", "chantier"]).optional(),
  ambiguous: z.boolean().optional(),
  ambiguity_reason: Text.optional(),
  notes: Text.optional(),
}).superRefine((line, ctx) => {
  checkKey(line, ctx);
  if (line.plan_cause !== undefined && line.observable_on_plan) {
    addIssue(ctx, ["plan_cause"], "plan_cause explains a line that is not observable on the plan");
  }
  if (line.ambiguous === true && line.ambiguity_reason === undefined) {
    addIssue(ctx, ["ambiguity_reason"], "an ambiguous line says why");
  }
  if (line.ambiguous !== true && line.ambiguity_reason !== undefined) {
    addIssue(ctx, ["ambiguous"], "ambiguity_reason is set but ambiguous is not true");
  }
  if (line.quantity === null && line.ambiguous !== true) {
    addIssue(ctx, ["quantity"], "only an ambiguous line leaves its quantity null");
  }
});

export type TruthLine = z.infer<typeof TruthLineSchema>;

const QUANTITY_TOLERANCE = (expected: number) => Math.max(0.01, Math.abs(expected) * 1e-6);

function formatNumber(value: number) {
  return String(Number(value.toFixed(4)));
}

function checkModuleQuantity(line: TruthLine, modulesOnPlan: number | null, ctx: Ctx, index: number) {
  if (line.module_scope === undefined || line.devis_quantity === undefined) return;
  const ambiguous = line.ambiguous === true;
  if (line.module_scope === "commun") {
    if (!ambiguous && (line.quantity === null
      || Math.abs(line.quantity - line.devis_quantity) > QUANTITY_TOLERANCE(line.devis_quantity))) {
      addIssue(ctx, ["lines", index, "quantity"],
        `a commun line keeps the devis quantity ${formatNumber(line.devis_quantity)}, never divided`);
    }
    return;
  }
  if (modulesOnPlan === null || line.devis_modules === undefined) {
    if (!ambiguous) {
      addIssue(ctx, ["lines", index], "a module line without modules_on_plan or devis_modules is ambiguous");
    }
    return;
  }
  const expected = (line.devis_quantity * modulesOnPlan) / line.devis_modules;
  const formula = `${formatNumber(line.devis_quantity)} x ${modulesOnPlan} / ${line.devis_modules} = ${formatNumber(expected)}`;
  if (line.unit === "u" && Math.abs(expected - Math.round(expected)) > 1e-9) {
    if (!ambiguous) addIssue(ctx, ["lines", index], `${formula} is not a whole count: the line is ambiguous`);
    return;
  }
  if (!ambiguous && (line.quantity === null || Math.abs(line.quantity - expected) > QUANTITY_TOLERANCE(expected))) {
    addIssue(ctx, ["lines", index, "quantity"], `module line: devis x modules_on_plan / devis_modules, ${formula}`);
  }
}

export const TRUTH_SCOPES = ["document", "level", "lot"] as const;

export const TruthFileSchema = z.strictObject({
  schema_version: z.literal(1),
  lot: z.enum(TRUTH_LOTS),
  /** `document`: one plan, file named truth/<id>.json; `level`: every zone of one level; `lot`: the whole lot. */
  scope: z.enum(TRUTH_SCOPES),
  documents: z.array(DocumentIdSchema).min(1),
  /** Main source (devis, surfaces table, or the plan's own text layer). */
  source_document: DocumentIdSchema,
  /** Rules applied to build this file, in plain text. */
  rules: Text,
  /** Lot C: modules drawn on this plan (title block, title or legend); null when unknown. */
  modules_on_plan: z.number().int().min(1).nullable().optional(),
  modules_on_plan_source: NullableText.optional(),
  notes: NullableText.optional(),
  lines: z.array(TruthLineSchema),
}).superRefine((truth, ctx) => {
  if (new Set(truth.documents).size !== truth.documents.length) addIssue(ctx, ["documents"], "a document is listed twice");
  if (truth.lot === "c" && truth.modules_on_plan === undefined) {
    addIssue(ctx, ["modules_on_plan"], "required on lot c truth (null when unknown)");
  }
  const seen = new Map<string, number>();
  for (const [index, line] of truth.lines.entries()) {
    const identity = keyIdentity(line, line.phase ?? null);
    const first = seen.get(identity);
    if (first === undefined) seen.set(identity, index);
    else addIssue(ctx, ["lines", index], `same key as lines[${first}]: one line per key, with additional_sources`);
    if (truth.lot === "c") {
      for (const field of ["devis_quantity", "module_scope", "phase"] as const) {
        if (line[field] === undefined) addIssue(ctx, ["lines", index, field], "required on lot c lines (rule 7)");
      }
    }
    checkModuleQuantity(line, truth.modules_on_plan ?? null, ctx, index);
  }
});

export type TruthFile = z.infer<typeof TruthFileSchema>;

// ---------------------------------------------------------------------------
// truth/noise.json: relative deviation per key between two revisions of the same
// devis on unchanged plans, never a raw quantity.

export const NoiseKeySchema = z.strictObject({
  ...keyShape,
  /** (comparison - baseline) / baseline; null when undefined (zero baseline, key on one side only). */
  relative_deviation: z.number().nullable(),
  reason: NullableText,
}).superRefine((key, ctx) => {
  checkKey(key, ctx);
  if (key.relative_deviation === null && key.reason === null) {
    addIssue(ctx, ["reason"], "say why the deviation is undefined");
  }
});

export const NoiseFileSchema = z.strictObject({
  schema_version: z.literal(1),
  status: z.enum(["measured", "not_measured"]),
  reason: NullableText,
  baseline_document: DocumentIdSchema.nullable(),
  comparison_document: DocumentIdSchema.nullable(),
  documents: z.array(DocumentIdSchema),
  plan_index_same: z.boolean().nullable(),
  rules: Text,
  keys: z.array(NoiseKeySchema),
}).superRefine((noise, ctx) => {
  if (noise.status === "measured") {
    if (noise.baseline_document === null) addIssue(ctx, ["baseline_document"], "a measured noise names its baseline");
    if (noise.comparison_document === null) addIssue(ctx, ["comparison_document"], "a measured noise names its comparison");
    if (noise.documents.length === 0) addIssue(ctx, ["documents"], "a measured noise names its plans");
    if (noise.plan_index_same !== true) addIssue(ctx, ["plan_index_same"], "noise is measured only on an unchanged plan index");
    if (noise.keys.length === 0) addIssue(ctx, ["keys"], "a measured noise has keys");
  } else {
    if (noise.reason === null) addIssue(ctx, ["reason"], "say why the noise was not measured");
    if (noise.keys.length > 0) addIssue(ctx, ["keys"], "a noise that was not measured has no keys");
  }
  const seen = new Map<string, number>();
  for (const [index, key] of noise.keys.entries()) {
    const identity = keyIdentity(key);
    const first = seen.get(identity);
    if (first === undefined) seen.set(identity, index);
    else addIssue(ctx, ["keys", index], `same key as keys[${first}]`);
  }
});

export type NoiseFile = z.infer<typeof NoiseFileSchema>;

// ---------------------------------------------------------------------------
// truth/pages/<id>.json (page types, TI-663) and truth/groups/<id>.json (path
// group classes, TI-662): minimal and open, their owners extend them.

export const PageTruthFileSchema = z.looseObject({
  schema_version: z.literal(1),
  document: DocumentIdSchema,
  pages: z.array(z.looseObject({ page: z.number().int().min(1), type: Text })).min(1),
});

export const GroupTruthFileSchema = z.looseObject({
  schema_version: z.literal(1),
  document: DocumentIdSchema,
  groups: z.array(z.looseObject({ page: z.number().int().min(1), group: Text, class: Text })),
});

export type ManifestDocument = z.infer<typeof ManifestDocumentSchema>;
export type TakeoffBenchManifest = z.infer<typeof ManifestSchema>;
export type PageTruthFile = z.infer<typeof PageTruthFileSchema>;
export type GroupTruthFile = z.infer<typeof GroupTruthFileSchema>;
