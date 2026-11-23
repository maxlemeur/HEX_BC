import { describeTakeoffJobFailure } from "./visible-status";

/**
 * « Analyse antérieure » (lot 4): an analysis of the affaire that was not read against its list of items — a job of the
 * first format, a grouped analysis, a failed one, one of another provider — shown read only beside the table of items,
 * as it was kept: its rows (designation, quantity, unit, page, file, and a set-aside with its reason as recorded), the
 * tables it extracted and its warnings, in their stored order. It never had a list: « liste demandée non enregistrée »,
 * and what it covered is unknown. Nothing is completed from today's list or template (no item, no state, no « non
 * trouvé »), and no human validation is inferred (the Assisted review's marks are navigation, not a verification: the
 * view carries none). Its own review, where its send is, stays one link away for an analysis that has one to open.
 */

/** The rows shown at most; the others are in the analysis's own review. */
export const EARLIER_ANALYSIS_ROWS_SHOWN = 200;
/** The statuses whose review opens (as an old version's address opens it). */
const REVIEWABLE = new Set(["completed", "applied"]);

export const EARLIER_ANALYSIS_STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  processing: "En cours",
  completed: "Terminée",
  applied: "Envoyée au devis",
  failed: "En échec",
  canceled: "Arrêtée",
};

type JobInput = { id: string; status: string; level: string; source_file_name: string | null; completed_at: string | null;
  created_at: string; error_code: string | null; estimate_version_id: string | null };
type RowInput = { id: string; designation: string; quantity: number; unit: string; source_page: number | null;
  source_file_name: string | null; is_excluded: boolean; exclusion_reason: string | null };

export type EarlierAnalysisRow = { id: string; designation: string; quantity: number; unit: string; page: number | null;
  fileName: string | null; setAside: string | null };
export type EarlierAnalysisTable = { page: number | null; title: string | null; headers: string[]; rows: string[][] };
export type EarlierAnalysisWarning = { severity: string | null; message: string };

export type EarlierAnalysisView = {
  jobId: string;
  versionId: string | null;
  fileName: string | null;
  level: string;
  provider: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  failure: string | null;
  list: "not_recorded";
  coverage: "unknown";
  rows: EarlierAnalysisRow[];
  rowsTotal: number;
  tables: EarlierAnalysisTable[];
  warnings: EarlierAnalysisWarning[];
  /** Warnings kept in a shape this version does not read: counted, never reworded. */
  unreadableWarnings: number;
  reviewable: boolean;
};

const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
const page = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null);

function tablesOf(value: unknown): EarlierAnalysisTable[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const table = record(entry);
    if (!table || !Array.isArray(table.headers)) return [];
    const rows = Array.isArray(table.rows) ? table.rows.map((row) => {
      const cells = record(row)?.cells;
      return Array.isArray(cells) ? cells.map((cell) => (typeof cell === "string" ? cell : String(cell ?? ""))) : [];
    }) : [];
    return [{ page: page(table.page), title: text(table.title), headers: table.headers.map((header) => String(header ?? "")), rows }];
  });
}

/** The warnings a result kept, in their order; those in a shape this version does not read are counted. */
export function keptWarnings(value: unknown) {
  const warnings: EarlierAnalysisWarning[] = [];
  let unreadable = 0;
  for (const entry of Array.isArray(value) ? value : []) {
    const warning = record(entry);
    const message = text(warning?.message);
    if (!message) {
      unreadable += 1;
      continue;
    }
    warnings.push({ severity: text(warning?.severity), message });
  }
  return { warnings, unreadable };
}

export function earlierAnalysisView(input: { job: JobInput; result: { warnings: unknown; tables: unknown; provider_meta: unknown } | null;
  rows: readonly RowInput[]; rowsTotal: number }): EarlierAnalysisView {
  const { job } = input;
  const { warnings, unreadable } = keptWarnings(input.result?.warnings);
  return {
    jobId: job.id,
    versionId: job.estimate_version_id,
    fileName: job.source_file_name,
    level: job.level,
    provider: text(record(input.result?.provider_meta)?.provider),
    status: job.status,
    startedAt: job.created_at,
    finishedAt: job.completed_at,
    failure: job.status === "failed" ? describeTakeoffJobFailure(job.error_code) : null,
    list: "not_recorded",
    coverage: "unknown",
    rows: input.rows.slice(0, EARLIER_ANALYSIS_ROWS_SHOWN).map((row) => ({ id: row.id, designation: row.designation,
      quantity: row.quantity, unit: row.unit, page: page(row.source_page), fileName: row.source_file_name,
      setAside: row.is_excluded ? row.exclusion_reason?.trim() || "Écartée" : null })),
    rowsTotal: Math.max(input.rowsTotal, input.rows.length),
    tables: tablesOf(input.result?.tables),
    warnings,
    unreadableWarnings: unreadable,
    reviewable: REVIEWABLE.has(job.status),
  };
}

/** The parameter of the affaire's takeoff page that opens an earlier analysis (the table one step back). */
export const EARLIER_ANALYSIS_PARAM = "anterieure";

/** The earlier analysis an address names, given once as an identifier; anything else names none. */
export function readEarlierAnalysisParam(params: { getAll(name: string): string[] }): string | null | "invalid" {
  const values = params.getAll(EARLIER_ANALYSIS_PARAM);
  if (values.length === 0) return null;
  const value = values.length === 1 ? values[0]!.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : "invalid";
}

/** An earlier analysis on the page's address as it is (the table's parameters kept for the way back). */
export function earlierAnalysisHref(projectId: string, jobId: string, from: string | URLSearchParams = "") {
  const next = new URLSearchParams(from);
  next.delete(EARLIER_ANALYSIS_PARAM);
  next.append(EARLIER_ANALYSIS_PARAM, jobId);
  return `/dashboard/affaires/${projectId}/takeoff?${next.toString()}`;
}

/** Back to the items from an earlier analysis: its parameter removed, the table's kept. */
export function earlierAnalysisReturnHref(projectId: string, query: string | URLSearchParams) {
  const next = new URLSearchParams(query);
  next.delete(EARLIER_ANALYSIS_PARAM);
  const search = next.toString();
  return `/dashboard/affaires/${projectId}/takeoff${search ? `?${search}` : ""}`;
}
