// TI-682 lot D: a plan page enters an estimate once. This module says which pages a takeoff reads that another
// takeoff already brought into the same estimate version, so that the estimator is warned before applying it.
// Pure and shared by the server read (page-contributions-server.ts) and the screens; the SQL twin of the
// application's guard reads the same cases (page-contributions.test.ts).
//
// The earlier contribution of a page is read in the estimate's lines (what is really there: a deleted line no
// longer counts, a copied version keeps its provenance), traced back to the frozen takeoff lines they came from:
// - engine 3: `source_metadata.takeoff_item_id`, every source of a rounded length
//   (`takeoff_length_rounding.item_ids`) and every source of a DPGF target (`takeoff_quantity_policy.item_ids`);
// - engines 1 and 2 (no source identifier): the line's takeoff, file and page.
// A DPGF target's own file and page are the DPGF's, never a plan page. A pasted or manual line has no provenance:
// it is invisible here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const UPLOAD_PREFIX = "upload:";

/** What identifies a plan document. Any of them may be missing; all missing means the line reads no known document. */
export type TakeoffPageDocument = {
  plan_file_id: string | null;
  content_hash: string | null;
  /** The « plan reference » the user gives a document, the same for all its revisions. */
  logical_document_id: string | null;
  file_name: string | null;
};
export type TakeoffPageIdentity = { document: TakeoffPageDocument; page: number | null };

/** A source of a takeoff's preparation snapshot, as stored (`preparation_snapshot.preparation.sources`). */
export type PageDocumentSource = {
  document_id: string;
  kind?: string | null;
  active?: boolean | null;
  content_hash?: string | null;
  logical_document_id?: string | null;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const uuid = (value: unknown) => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
const page = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
/** Lower case, spaces reduced: « Plan  R+1.PDF » and « plan r+1.pdf » are one name. */
const normalizedName = (value: string | null) => value?.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim() || null;
const uploadHash = (documentId: string) =>
  documentId.startsWith(UPLOAD_PREFIX) && SHA256.test(documentId.slice(UPLOAD_PREFIX.length)) ? documentId.slice(UPLOAD_PREFIX.length).toLowerCase() : null;

/**
 * Same document when any of these holds: the same plan file; the same content hash (two uploads of one PDF); the
 * same non-empty plan reference (a revision replaces the previous one); or, when one of the two has neither a plan
 * file nor a hash, the same file name. Two plan files of the same name without a common reference stay two
 * documents.
 */
export function isSameDocument(left: TakeoffPageDocument, right: TakeoffPageDocument) {
  if (left.plan_file_id && left.plan_file_id.toLowerCase() === right.plan_file_id?.toLowerCase()) return true;
  if (left.content_hash && left.content_hash.toLowerCase() === right.content_hash?.toLowerCase()) return true;
  const leftReference = normalizedName(left.logical_document_id);
  if (leftReference && leftReference === normalizedName(right.logical_document_id)) return true;
  const nameOnly = (document: TakeoffPageDocument) => !document.plan_file_id && !document.content_hash;
  if (!nameOnly(left) && !nameOnly(right)) return false;
  const leftName = normalizedName(left.file_name);
  return leftName !== null && leftName === normalizedName(right.file_name);
}

/** Same document, and the same page or a page missing on either side: without proof, it is the same page (D27). */
export function isSamePage(left: TakeoffPageIdentity, right: TakeoffPageIdentity) {
  return isSameDocument(left.document, right.document) && (left.page === null || right.page === null || left.page === right.page);
}

/**
 * The page a takeoff line reads: its file and page, its source document (`metadata.source_document`: a plan file,
 * stable from one takeoff to the next, or the job's own upload, which is not), and what its takeoff's preparation
 * says of that document (content hash, plan reference). Null when nothing identifies a document: such a line is
 * compared to nothing (a multi-file takeoff without preparation, whose page fell outside the set).
 */
export function takeoffLinePageIdentity(
  line: { source_file_name: string | null; source_page: number | null; source_document?: unknown },
  jobSources?: readonly PageDocumentSource[] | null
): TakeoffPageIdentity | null {
  const reference = record(line.source_document);
  const planFileId = reference?.kind === "plan_file" ? uuid(reference.plan_file_id) : null;
  const sources = (jobSources ?? []).filter((source) => source.active !== false && (source.kind ?? "plan") === "plan");
  const uploads = sources.filter((source) => source.document_id.startsWith(UPLOAD_PREFIX));
  const source = planFileId ? sources.find((candidate) => candidate.document_id.toLowerCase() === planFileId)
    : reference?.kind === "job_upload" && uploads.length === 1 ? uploads[0] : undefined;
  const contentHash = source ? (text(source.content_hash) && SHA256.test(source.content_hash!.trim()) ? source.content_hash!.trim().toLowerCase()
    : uploadHash(source.document_id)) : null;
  const document: TakeoffPageDocument = {
    plan_file_id: planFileId,
    content_hash: contentHash,
    logical_document_id: text(source?.logical_document_id),
    file_name: text(line.source_file_name),
  };
  if (!document.plan_file_id && !document.content_hash && !document.logical_document_id && !document.file_name) return null;
  return { document, page: page(line.source_page) };
}

/**
 * The takeoff lines an estimate line comes from (engine 3 provenance), each once, in the order read. A rounding or
 * DPGF key written by another takeoff than the line's last one (`sourceJobId`) is stale: a later `merge` rewrote the
 * line's quantity and `takeoff_item_id` but kept the key. Its lines no longer feed the line and are not read.
 */
export function estimateLineTakeoffItemIds(sourceMetadata: unknown, sourceJobId?: string | null): string[] {
  const metadata = record(sourceMetadata);
  if (!metadata) return [];
  const lineJob = uuid(sourceJobId);
  const listed = (key: string) => {
    const entry = record(metadata[key]);
    const keyJob = uuid(entry?.job_id);
    if (lineJob && keyJob && keyJob !== lineJob) return [];
    return Array.isArray(entry?.item_ids) ? entry.item_ids : [];
  };
  const ids = [metadata.takeoff_item_id, ...listed("takeoff_length_rounding"), ...listed("takeoff_quantity_policy")]
    .map(uuid).filter((value): value is string => value !== null);
  return [...new Set(ids)];
}

export type EstimateLineProvenance = {
  id: string;
  source_provider: string | null;
  source_job_id: string | null;
  source_file_name: string | null;
  source_page: number | null;
  source_metadata: unknown;
};
/** A frozen line of another takeoff that an estimate line names as its source. */
export type EarlierTakeoffLine = { id: string; job_id: string; identity: TakeoffPageIdentity | null };
export type NewTakeoffLine = { id: string; identity: TakeoffPageIdentity | null };

/** One source of an estimate line: its takeoff, the page, and the frozen takeoff line when the estimate line names it. */
type Contribution = { job_id: string; item_id: string | null; identity: TakeoffPageIdentity | null };

/**
 * Where an estimate line's quantity comes from: the takeoff lines it names, else (engines 1 and 2, or sources no
 * longer readable) its takeoff, file and page when it came from a takeoff. A DPGF target is read only through the
 * takeoff lines it names: its own file and page are the DPGF's.
 */
export function estimateLineContributions(line: EstimateLineProvenance, earlierItems: ReadonlyMap<string, EarlierTakeoffLine>): Contribution[] {
  const sources = estimateLineTakeoffItemIds(line.source_metadata, line.source_job_id).flatMap((itemId) => {
    const item = earlierItems.get(itemId);
    return item ? [{ job_id: item.job_id.toLowerCase(), item_id: itemId, identity: item.identity }] : [];
  });
  if (sources.length > 0) return sources;
  const jobId = uuid(line.source_job_id);
  if (line.source_provider !== "takeoff" || !jobId) return [];
  const fileName = text(line.source_file_name);
  return [{ job_id: jobId, item_id: null, identity: fileName ? { document: { plan_file_id: null, content_hash: null, logical_document_id: null, file_name: fileName },
    page: page(line.source_page) } : null }];
}

export type PageAlreadyInEstimate = {
  /** The page's file name, as the new takeoff reads it. */
  file_name: string | null;
  /** Null only when the page is known on neither side. */
  page: number | null;
  /** The new takeoff's lines on that page (none for a launch). */
  item_ids: string[];
  /**
   * Each other takeoff that brought this page, with the estimate lines it brought there and its own frozen lines on
   * the page that feed them (none for an engine 1/2 line, which names no source line).
   */
  earlier: Array<{ job_id: string; estimate_item_ids: string[]; takeoff_item_ids: string[] }>;
  /** The estimate lines this takeoff itself brought on the page (an applied takeoff whose lines are still there). */
  own_estimate_item_ids: string[];
};
export type PagesAlreadyInEstimate = {
  pages: PageAlreadyInEstimate[];
  /** The new takeoff's lines that read no known document: compared to nothing. */
  unidentified_item_ids: string[];
  /** Estimate lines another takeoff brought, on any page. */
  other_takeoff_line_count: number;
};

/**
 * The pages of `newLines` that the estimate already holds from another takeoff than `jobId`. A new line without a
 * page meets every page of its document the estimate holds; an estimate line on a page the new takeoff does not read
 * is not reported.
 */
export function findPagesAlreadyInEstimate(input: {
  jobId: string | null;
  newLines: readonly NewTakeoffLine[];
  estimateLines: readonly EstimateLineProvenance[];
  earlierItems: ReadonlyMap<string, EarlierTakeoffLine>;
}): PagesAlreadyInEstimate {
  const jobId = input.jobId?.toLowerCase() ?? null;
  const unidentified = input.newLines.filter((line) => line.identity === null).map((line) => line.id);
  // Compared page by page, not line by line: the lines of one page share one identity.
  const newPages = new Map<string, { identity: TakeoffPageIdentity; item_ids: string[] }>();
  for (const line of input.newLines) {
    if (!line.identity) continue;
    const key = JSON.stringify(line.identity);
    const group = newPages.get(key) ?? { identity: line.identity, item_ids: [] };
    group.item_ids.push(line.id);
    newPages.set(key, group);
  }
  const contributed = new Map<string, { job_id: string; identity: TakeoffPageIdentity; estimate_item_ids: Set<string>; takeoff_item_ids: Set<string> }>();
  const otherLines = new Set<string>();
  for (const line of input.estimateLines) {
    for (const contribution of estimateLineContributions(line, input.earlierItems)) {
      if (contribution.job_id !== jobId) otherLines.add(line.id);
      if (!contribution.identity) continue;
      const key = JSON.stringify([contribution.job_id, contribution.identity]);
      const group = contributed.get(key) ?? { job_id: contribution.job_id, identity: contribution.identity,
        estimate_item_ids: new Set<string>(), takeoff_item_ids: new Set<string>() };
      group.estimate_item_ids.add(line.id);
      if (contribution.item_id) group.takeoff_item_ids.add(contribution.item_id);
      contributed.set(key, group);
    }
  }
  // One entry per page as the screen names it: two documents the new takeoff names alike are one row. Each entry keeps
  // the pages it stands for (the new page's document at the page shown), to place this takeoff's own lines on it.
  type Entry = { file_name: string | null; page: number | null; identities: TakeoffPageIdentity[]; item_ids: Set<string>;
    earlier: Map<string, { estimate_item_ids: Set<string>; takeoff_item_ids: Set<string> }>; own: Set<string> };
  const pages = new Map<string, Entry>();
  for (const { identity, item_ids } of newPages.values()) {
    for (const contribution of contributed.values()) {
      if (contribution.job_id === jobId || !isSamePage(identity, contribution.identity)) continue;
      const shown = identity.page ?? contribution.identity.page;
      const fileName = identity.document.file_name ?? contribution.identity.document.file_name;
      const key = JSON.stringify([normalizedName(fileName) ?? identity.document.plan_file_id ?? identity.document.content_hash, shown]);
      const entry = pages.get(key) ?? { file_name: fileName, page: shown, identities: [], item_ids: new Set<string>(),
        earlier: new Map<string, { estimate_item_ids: Set<string>; takeoff_item_ids: Set<string> }>(), own: new Set<string>() };
      entry.identities.push({ document: identity.document, page: shown });
      for (const id of item_ids) entry.item_ids.add(id);
      const earlier = entry.earlier.get(contribution.job_id) ?? { estimate_item_ids: new Set<string>(), takeoff_item_ids: new Set<string>() };
      for (const id of contribution.estimate_item_ids) earlier.estimate_item_ids.add(id);
      for (const id of contribution.takeoff_item_ids) earlier.takeoff_item_ids.add(id);
      entry.earlier.set(contribution.job_id, earlier);
      pages.set(key, entry);
    }
  }
  // This takeoff's own estimate lines, on a reported page by the same rule as the comparison: a page unknown on either
  // side is the same page. Not by the row's key: an own line without page would miss the page an earlier one names.
  for (const contribution of contributed.values()) {
    if (contribution.job_id !== jobId) continue;
    for (const entry of pages.values()) {
      if (!entry.identities.some((identity) => isSamePage(identity, contribution.identity))) continue;
      for (const id of contribution.estimate_item_ids) entry.own.add(id);
    }
  }
  const found: PageAlreadyInEstimate[] = [...pages.values()].map((entry) => ({ file_name: entry.file_name, page: entry.page,
    item_ids: [...entry.item_ids].sort(),
    earlier: [...entry.earlier].map(([job, ids]) => ({ job_id: job, estimate_item_ids: [...ids.estimate_item_ids].sort(),
      takeoff_item_ids: [...ids.takeoff_item_ids].sort() })).sort((a, b) => a.job_id.localeCompare(b.job_id)),
    own_estimate_item_ids: [...entry.own].sort() }));
  return {
    pages: found.sort((left, right) => (left.file_name ?? "").localeCompare(right.file_name ?? "", "fr")
      || (left.page ?? Number.MAX_SAFE_INTEGER) - (right.page ?? Number.MAX_SAFE_INTEGER)),
    unidentified_item_ids: unidentified,
    other_takeoff_line_count: otherLines.size,
  };
}

export type LaunchPageDocument = {
  plan_file_id: string | null;
  content_hash: string | null;
  logical_document_id: string | null;
  file_name: string;
  /** The pages selected; none means the whole document. */
  pages: number[];
};

/** The plan documents a launch is about to read: the active plan sources of its preparation. */
export function launchDocumentsOf(sources: ReadonlyArray<PageDocumentSource & { document_name: string; pages: readonly number[] }>): LaunchPageDocument[] {
  return sources.filter((source) => source.active !== false && (source.kind ?? "plan") === "plan").map((source) => ({
    plan_file_id: uuid(source.document_id),
    content_hash: text(source.content_hash) && SHA256.test(source.content_hash!.trim()) ? source.content_hash!.trim().toLowerCase() : uploadHash(source.document_id),
    logical_document_id: text(source.logical_document_id),
    file_name: source.document_name,
    pages: [...source.pages],
  }));
}

/** A launch's documents as lines of the takeoff to come: one per selected page, or one without page for the whole document. */
export function launchLinesOf(documents: readonly LaunchPageDocument[]): NewTakeoffLine[] {
  return documents.flatMap((document, index) => {
    const identity = (sourcePage: number | null): TakeoffPageIdentity => ({ document: { plan_file_id: document.plan_file_id,
      content_hash: document.content_hash, logical_document_id: text(document.logical_document_id), file_name: text(document.file_name) }, page: sourcePage });
    const pages = document.pages.length ? [...new Set(document.pages)] : [null];
    return pages.map((sourcePage) => ({ id: `${index}:${sourcePage ?? "all"}`, identity: identity(sourcePage) }));
  });
}
