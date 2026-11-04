// Which vector page a model line belongs to (TI-664 L5b), for the scale rule:
// the page of its own document (metadata.source_document: a plan file, or the
// job's upload) and page number, never another file of the same display name.
// A line that names no document, or a document whose pages still collide (two
// uploads of one name), takes the page whose scale a cote contradicts when
// there is one: the line then fails rather than passes (fail closed).

export type RulePageCandidate = {
  id: string;
  job_id: string;
  plan_file_id: string | null;
  source_file_name: string | null;
  source_page: number;
  /** The page's scale is contradicted by a cote (dimension_mismatch). */
  scale_mismatch: boolean;
};

export type RuleLineSource = {
  job_id: string;
  source_file_name: string | null;
  source_page: number | null;
  metadata: unknown;
};

/** The plan file a line's metadata names: its id, "" for the job's upload, undefined when it names none. */
function documentOf(metadata: unknown): string | undefined {
  const document = typeof metadata === "object" && metadata !== null ? (metadata as { source_document?: unknown }).source_document : undefined;
  if (typeof document !== "object" || document === null) return undefined;
  const { kind, plan_file_id: planFileId } = document as { kind?: unknown; plan_file_id?: unknown };
  if (kind === "plan_file" && typeof planFileId === "string") return planFileId;
  if (kind === "job_upload") return "";
  return undefined;
}

export function ruleLinePage(line: RuleLineSource, pages: readonly RulePageCandidate[]): string | null {
  if (!line.source_page) return null;
  const document = documentOf(line.metadata);
  const candidates = pages.filter((page) => page.job_id === line.job_id && page.source_page === line.source_page
    && (page.source_file_name ?? "") === (line.source_file_name ?? "")
    && (document === undefined || (page.plan_file_id ?? "") === document));
  if (candidates.length === 0) return null;
  return (candidates.find((page) => page.scale_mismatch) ?? candidates[0]).id;
}
