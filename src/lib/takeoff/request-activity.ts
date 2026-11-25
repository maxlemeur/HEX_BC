import { TAKEOFF_PLAN_PUBLIC_FAILURE_CODES, TAKEOFF_PUBLIC_FAILURE_CODES } from "@/lib/takeoff/completion-outcome";
import { readPosteReadingBoundsFacts } from "@/lib/takeoff/poste-reading-bounds-text";
import {
  describeTakeoffLaunchReason,
  isTakeoffLaunchReason,
  TAKEOFF_GROUPED_UNIT_KEY,
  type TakeoffLaunchPiece,
} from "@/lib/takeoff/launch-request";
import {
  describeTakeoffCoverage,
  summarizeTakeoffCoverage,
  type TakeoffLaunchRequestUnits,
  type TakeoffRequestUnitView,
  type TakeoffUnitState,
} from "@/lib/takeoff/launch-request-coverage";
import {
  resolveTakeoffOperatorState,
  toTakeoffOperatorStateInput,
  type TakeoffOperatorStateRow,
  type TakeoffResumeViewer,
} from "@/lib/takeoff/operator-state";
import type {
  TakeoffRequestActivity,
  TakeoffRequestActivityJob,
  TakeoffRequestActivityResponse,
} from "@/lib/takeoff/request-activity-contracts";
import { rejectedProviderAnswerMessage } from "@/lib/takeoff/visible-status";

/**
 * What the affaire's activity shows of its launch requests (migration 20261121170448_takeoff_launch_requests.sql): each
 * request, the units its manifest recorded in their order, each in one state, and what the member who reads may do with
 * each analysis. Both formats are read: the grouped unit of lot 2 (one analysis of several plans, never shown as several
 * analyses) and one analysis per plan. The page decides from this alone how often to read it again.
 */

/** A request as its readers may read it (the columns granted to members). */
export type TakeoffRequestRow = {
  id: string;
  origin: string;
  intent: string;
  state: string;
  reason_code: string | null;
  reason_details: unknown;
  outcome: string | null;
  mandate_revision: number;
  units_expected: number | null;
  created_at: string;
  admitted_at: string | null;
  closed_at: string | null;
};

/** A job of a request as the member reads it: what the resume policy reads, and the count of its lines. */
export type TakeoffRequestJobRow = TakeoffOperatorStateRow & {
  id: string;
  launch_request_id: string | null;
  plan_set_id: string | null;
  estimate_version_id: string | null;
  error_message?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  analysis_finished_at?: string | null;
  /** When a member sent it back to its queue (migration 20261121020321). */
  analysis_queued_at?: string | null;
  /** Its lines that are not excluded: a reading that kept only excluded hypotheses retains none. */
  item_count: number;
};

/**
 * The sources (plan copies, dossier pieces) the member may read, by the same rules as their own policies: a plan's or a
 * piece's name and pages are shown only for those; otherwise a neutral « Plan N ». `all`: the member reads every plan
 * file of the affaire (its owner or an administrator).
 */
export type TakeoffVisibleSources = "all" | { planFiles: ReadonlySet<string>; documents: ReadonlySet<string> };

export function isTakeoffSourceVisible(visible: TakeoffVisibleSources, ...ids: Array<string | null | undefined>) {
  if (visible === "all") return true;
  return ids.some((id) => Boolean(id) && (visible.planFiles.has(id!.toLowerCase()) || visible.documents.has(id!.toLowerCase())));
}

/** The error codes this activity carries: those with a public French reason; any other is the generic one. */
export const TAKEOFF_GENERIC_FAILURE_CODE = "OTHER";

/** A job of a request as its unit's state is derived from it (read by the server, whatever the member may read). */
export type TakeoffRequestUnitJobRow = {
  id: string;
  launch_request_id: string | null;
  launch_unit_key: string | null;
  status: string;
  started_at: string | null;
  next_retry_at: string | null;
  analysis_outcome: string | null;
  error_code: string | null;
  updated_at: string;
};

type ManifestPlan = { planFileId: string | null; logicalId: string | null; documentId: string | null; name: string;
  pages: number[]; pageCount: number | null; contentSha256?: string };

/** The part of a sealed manifest the activity reads: its units in order, the plans they name, the plans set aside. */
export type TakeoffRequestManifest = {
  formatVersion: number | null;
  /** The sealed order asked about the affaire's list of items (lot 4): its plans are sent item by item. */
  itemList: boolean;
  units: Array<{ key: string; ordinal: number; plans: string[]; pages: number[] | null }>;
  plans: Map<string, ManifestPlan>;
  omitted: Array<TakeoffRequestActivity["plansOmitted"][number] & { id: string | null }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OMITTED_REASONS = new Set(["alternate", "identical_copy", "unsupported_format", "not_requested", "not_selected"]);
const PUBLIC_CODES = new Set<string>(TAKEOFF_PUBLIC_FAILURE_CODES);
const PLAN_PUBLIC_CODES = new Set<string>(TAKEOFF_PLAN_PUBLIC_FAILURE_CODES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const toPages = (value: unknown) => Array.isArray(value)
  ? value.filter((page): page is number => Number.isSafeInteger(page) && (page as number) > 0).sort((left, right) => left - right)
  : [];

/**
 * The manifest's units and plans, in format 1 (one grouped unit) or 2 (one unit per plan, with its ordinal and pages): a
 * unit names the entry keys of its plans, a plan entry its name, its copy and its original pages. A manifest without
 * units is unreadable here (null).
 */
export function parseTakeoffRequestManifest(raw: unknown): TakeoffRequestManifest | null {
  if (!isRecord(raw) || !Array.isArray(raw.units) || raw.units.length === 0) return null;
  const units: TakeoffRequestManifest["units"] = [];
  for (const [index, unit] of raw.units.entries()) {
    if (!isRecord(unit) || typeof unit.key !== "string" || !Array.isArray(unit.plans)) return null;
    units.push({
      key: unit.key,
      ordinal: Number.isSafeInteger(unit.ordinal) && (unit.ordinal as number) > 0 ? unit.ordinal as number : index + 1,
      plans: unit.plans.filter((plan): plan is string => typeof plan === "string"),
      pages: Array.isArray(unit.pages) ? toPages(unit.pages) : null,
    });
  }
  const plans = new Map<string, ManifestPlan>();
  for (const plan of Array.isArray(raw.plans) ? raw.plans : []) {
    if (!isRecord(plan) || typeof plan.entry_key !== "string" || typeof plan.name !== "string") continue;
    plans.set(plan.entry_key, {
      planFileId: typeof plan.plan_file_id === "string" && UUID.test(plan.plan_file_id) ? plan.plan_file_id.toLowerCase() : null,
      logicalId: typeof plan.logical_id === "string" ? plan.logical_id : null,
      documentId: typeof plan.intake_document_id === "string" ? plan.intake_document_id : null,
      name: plan.name,
      pages: toPages(plan.pages),
      pageCount: typeof plan.page_count === "number" && Number.isSafeInteger(plan.page_count) && plan.page_count > 0 ? plan.page_count : null,
      ...(typeof plan.content_sha256 === "string" && /^[0-9a-f]{64}$/.test(plan.content_sha256)
        ? { contentSha256: plan.content_sha256 } : {}),
    });
  }
  const coverage = isRecord(raw.coverage) ? raw.coverage : {};
  const omitted = (Array.isArray(coverage.plans_omitted) ? coverage.plans_omitted : []).flatMap((entry) =>
    isRecord(entry) && typeof entry.name === "string" && typeof entry.reason === "string" && OMITTED_REASONS.has(entry.reason)
      ? [{ id: typeof entry.id === "string" ? entry.id : null, name: entry.name,
        reason: entry.reason as TakeoffRequestActivity["plansOmitted"][number]["reason"] }]
      : []);
  return {
    formatVersion: typeof raw.format_version === "number" ? raw.format_version : null,
    itemList: raw.order_kind === "item_list",
    units: [...units].sort((left, right) => left.ordinal - right.ordinal), plans, omitted,
  };
}

/** A failure whose analysis never began on the Mac: its unit did not start. */
const NOT_STARTED_CODES = new Set(["TAKEOFF_WORKER_NOT_STARTED", "TAKEOFF_WORKER_QUEUE_EXPIRED", "TAKEOFF_WORKER_HOST_SILENT"]);

/**
 * The state of a unit from its job, until the dispatcher's reading contract (readTakeoffLaunchRequestUnits) is on main:
 * the same rule as its SQL (private.takeoff_unit_state, migration A of lot 3), so that the swap changes no state. The
 * recorded end decides first; a failure that never began is « not started »; a job still pending, or failed with its
 * technical retry still to decide or to run, waits in the queue. Never a success from the presence of a result row.
 */
export function resolveTakeoffRequestUnitState(job: Pick<TakeoffRequestUnitJobRow, "analysis_outcome" | "status" | "started_at" | "error_code">): TakeoffUnitState {
  const outcome = job.analysis_outcome;
  if (outcome === "success" || (!outcome && (job.status === "completed" || job.status === "applied"))) return "succeeded";
  if (outcome === "canceled" || (!outcome && job.status === "canceled")) return "canceled";
  if (outcome === "failure") return !job.started_at || NOT_STARTED_CODES.has(job.error_code ?? "") ? "not_started" : "failed";
  if (job.status === "processing") return "running";
  return "queued";
}

/**
 * The units of an admitted request in the shape of the dispatcher's reading contract (TakeoffLaunchRequestUnits), from
 * its sealed manifest and its jobs, as its SQL reader builds them (read_takeoff_launch_request_units): the format is per
 * plan for a manifest of format 2 and grouped otherwise; a plan's identity, name and pages come from its entry in format 2
 * only. A grouped unit carries no plan (the SQL reader leaves its name null: its reader in TypeScript names it, here
 * « Analyse groupée de N plans », which the screens do not show; they list the manifest's plans). Null for a manifest
 * this version cannot read.
 */
export function deriveTakeoffRequestUnits(input: {
  requestId: string;
  manifest: TakeoffRequestManifest | null;
  jobs: ReadonlyArray<TakeoffRequestUnitJobRow>;
}): Omit<TakeoffLaunchRequestUnits, "usage"> | null {
  const { manifest } = input;
  if (!manifest) return null;
  const jobsByUnit = new Map(input.jobs.filter((job) => job.launch_request_id === input.requestId && job.launch_unit_key)
    .map((job) => [job.launch_unit_key as string, job]));
  const perPlan = manifest.formatVersion === 2;
  const units: TakeoffRequestUnitView[] = manifest.units.flatMap((unit) => {
    const job = jobsByUnit.get(unit.key);
    if (!job) return [];
    const state = resolveTakeoffRequestUnitState(job);
    const plan = perPlan && unit.plans[0] ? manifest.plans.get(unit.plans[0]) : undefined;
    return [{
      key: unit.key, ordinal: unit.ordinal,
      planFileId: plan?.planFileId ?? null, logicalId: plan?.logicalId ?? null,
      name: perPlan ? plan?.name ?? "Plan sans nom" : `Analyse groupée de ${unit.plans.length} plans`,
      pages: plan?.pages ?? [],
      jobId: job.id, state,
      reasonCode: state === "failed" || state === "not_started" ? toPublicFailureCode(job.error_code, perPlan) : null,
      retryAt: job.status === "failed" && !job.analysis_outcome ? job.next_retry_at : null,
      updatedAt: job.updated_at,
      reviewable: state === "succeeded",
    }];
  });
  return {
    requestId: input.requestId,
    format: perPlan ? "per_plan" : "grouped",
    units,
    coverage: summarizeTakeoffCoverage(units),
  };
}

/**
 * A code with a public French reason as is; any other code the generic one; none stays none. A plan of one analysis per
 * plan (`perPlan`) also publishes its own reasons (TAKEOFF_PLAN_PUBLIC_FAILURE_CODES).
 */
export function toPublicFailureCode(code: string | null | undefined, perPlan = false) {
  if (!code) return null;
  return (perPlan ? PLAN_PUBLIC_CODES : PUBLIC_CODES).has(code) ? code : TAKEOFF_GENERIC_FAILURE_CODE;
}

function latestOf(values: Array<string | null | undefined>) {
  let best: string | null = null;
  for (const value of values) {
    if (value && Number.isFinite(Date.parse(value)) && (!best || Date.parse(value) > Date.parse(best))) best = value;
  }
  return best;
}

/**
 * A list of named pieces where a piece the member may not read is « Plan N » (its rank in the list) with an opaque
 * identifier, `hidden:[list:]N`, the same at each read of the same list: never its source's name or identifier.
 */
export function maskTakeoffPieces<T extends { id: string; name: string }>(pieces: ReadonlyArray<T>, visible: TakeoffVisibleSources,
  list?: string): T[] {
  return pieces.map((piece, index) => isTakeoffSourceVisible(visible, piece.id) ? piece
    : { ...piece, id: `hidden:${list ? `${list}:` : ""}${index + 1}`, name: `Plan ${index + 1}` });
}

/** The dossier's changes since a seal, each name and identifier shown only to a member who may read its source. */
export function maskTakeoffDossierChange<T extends { added: Array<{ id: string; name: string }>; replaced: Array<{ id: string; name: string }>;
  removed: Array<{ id: string; name: string }> }>(change: T | null, visible: TakeoffVisibleSources): T | null {
  if (!change) return null;
  return { ...change, added: maskTakeoffPieces(change.added, visible, "added"),
    replaced: maskTakeoffPieces(change.replaced, visible, "replaced"), removed: maskTakeoffPieces(change.removed, visible, "removed") };
}

function toPieces(details: unknown): TakeoffLaunchPiece[] {
  const pieces = isRecord(details) && Array.isArray(details.pieces) ? details.pieces : [];
  return pieces.flatMap((piece) => isRecord(piece) && typeof piece.id === "string" && typeof piece.name === "string"
    ? [{ id: piece.id, name: piece.name }] : []);
}

/** What this member may do with an analysis, by the same policy as its detail, the list and the retry command. */
function toActivityJob(job: TakeoffRequestJobRow, viewer: TakeoffResumeViewer, now: Date, sendsItems: boolean): TakeoffRequestActivityJob {
  const decision = resolveTakeoffOperatorState(toTakeoffOperatorStateInput(job, viewer, now));
  const transition = latestOf([job.created_at, job.analysis_queued_at, job.started_at, job.completed_at, job.analysis_finished_at]);
  const failureMessage = rejectedProviderAnswerMessage(job.error_code, job.error_message);
  return {
    jobId: job.id,
    planSetId: job.plan_set_id,
    estimateVersionId: job.estimate_version_id,
    lastTransitionAt: transition,
    itemCount: job.item_count,
    applied: job.status === "applied",
    errorCode: toPublicFailureCode(job.error_code),
    ...(failureMessage && { failureMessage }),
    retryCount: job.retry_count ?? 0,
    resume: decision.resume.reason === "not_stopped" ? null : decision.resume,
    canCancel: decision.canCancel,
    canResubmit: decision.canResubmit,
    // Read against the list, read to its end and not sent yet, for a member who writes the affaire: the send by item.
    ...(sendsItems && job.status === "applied" && job.estimate_version_id ? { canRedistributeItems: true } : {}),
    canSendItems: sendsItems && job.status === "completed" && job.estimate_version_id === null,
  };
}

/**
 * One request as its reader sees it: its state and reason, its units (in the dispatcher's shape) and, for the analyses
 * this member may read, what they may do with them.
 */
export function buildTakeoffRequestActivity(input: {
  request: TakeoffRequestRow;
  units: (Omit<TakeoffLaunchRequestUnits, "usage"> & { usage?: TakeoffLaunchRequestUnits["usage"] }) | null;
  /** The request's calls whose consumption stayed unknown, read for the page's requests at once; null when not read. */
  unknownCalls?: number | null;
  manifest: TakeoffRequestManifest | null;
  /** The request's jobs the member reads (their own access rules). */
  jobs: ReadonlyArray<TakeoffRequestJobRow>;
  viewer: TakeoffResumeViewer;
  now: Date;
  /** The sources the member may read: the names, pages and identifiers of the others are not shown. */
  visible: TakeoffVisibleSources;
  action?: TakeoffRequestActivity["action"];
  /** As the shared reader (readDossierChangeSinceAnalysis) masked it for this member: shown as given. */
  dossierChanged?: TakeoffRequestActivity["dossierChanged"];
  /** The member writes the affaire's list of items (public.takeoff_item_list_may_write, the send's own rule); read once. */
  writesItems?: boolean;
}): TakeoffRequestActivity {
  const { request, manifest, visible } = input;
  const reason = isTakeoffLaunchReason(request.reason_code)
    ? { code: request.reason_code,
      message: describeTakeoffLaunchReason(request.reason_code, maskTakeoffPieces(toPieces(request.reason_details), visible),
        readPosteReadingBoundsFacts(isRecord(request.reason_details) ? request.reason_details.reading_bounds : null)) }
    : request.state === "superseded"
      ? { code: "SUPERSEDED", message: describeTakeoffLaunchReason("SUPERSEDED") }
      : null;
  // A plan's name, pages and identity only where the member may read its copy or its dossier piece; otherwise its key is
  // its position in the sealed manifest.
  const units = input.units ? {
    ...input.units,
    units: input.units.units.map((unit) => unit.key === TAKEOFF_GROUPED_UNIT_KEY || isTakeoffSourceVisible(visible, unit.planFileId, unit.logicalId)
      ? unit : { ...unit, key: `unit:${unit.ordinal}`, name: `Plan ${unit.ordinal}`, pages: [], planFileId: null, logicalId: null }),
  } : null;
  // The plans of a grouped unit, with their pages: the manifest's, never several analyses.
  const groupedUnit = units?.format === "grouped" && manifest
    ? manifest.units.find((unit) => unit.key === TAKEOFF_GROUPED_UNIT_KEY) ?? manifest.units[0] : undefined;
  const grouped = (groupedUnit?.plans ?? []).flatMap((entry, index) => {
    const plan = manifest?.plans.get(entry);
    if (!plan) return [];
    return isTakeoffSourceVisible(visible, plan.planFileId, plan.documentId, plan.logicalId)
      ? [{ planFileId: plan.planFileId, name: plan.name, pages: plan.pages }]
      : [{ planFileId: null, name: `Plan ${index + 1}`, pages: [] }];
  });
  const unitJobs = new Set(units?.units.map((unit) => unit.jobId) ?? []);

  return {
    id: request.id,
    origin: request.origin === "manual" ? "manual" : "automatic",
    intent: request.intent === "reread_plans" || request.intent === "remeasure_items" ? request.intent : "initial",
    order: manifest?.itemList ? "item_list" : "free",
    state: request.state as TakeoffRequestActivity["state"],
    outcome: request.outcome === "success" || request.outcome === "failure" || request.outcome === "canceled"
      || request.outcome === "partial" ? request.outcome : null,
    reason,
    createdAt: request.created_at,
    admittedAt: request.admitted_at,
    closedAt: request.closed_at,
    units: units ? {
      format: units.format, units: units.units, coverage: units.coverage,
      unknownCalls: units.usage?.unknownCalls ?? input.unknownCalls ?? null,
    } : null,
    groupedPlans: grouped,
    plansOmitted: request.admitted_at && manifest ? manifest.omitted.map((entry, index) => ({
      name: isTakeoffSourceVisible(visible, entry.id) ? entry.name : `Plan ${index + 1}`, reason: entry.reason,
    })) : [],
    jobs: input.jobs.filter((job) => job.launch_request_id === request.id && unitJobs.has(job.id))
      .map((job) => toActivityJob(job, input.viewer, input.now, manifest?.itemList === true && input.writesItems === true)),
    action: input.action ?? null,
    dossierChanged: input.dossierChanged ?? null,
  };
}

/** How a request can still change by itself: a plan is read, plans wait their turn, or the request waits for its Mac. */
export type TakeoffRequestProgress = "running" | "queued" | "waiting" | null;

export function takeoffRequestProgress(request: Pick<TakeoffRequestActivity, "state" | "reason" | "units">): TakeoffRequestProgress {
  if (request.state === "admitted") {
    const coverage = request.units?.coverage;
    if (coverage?.running) return "running";
    if (coverage?.queued) return "queued";
    // Every unit ended (or its manifest is unreadable here) and the request is not closed yet: its closure is on its way.
    return "waiting";
  }
  // Closed and set aside are final. Any other state can still move without this page: its Mac evaluates it, a change of
  // the dossier marks it for a new evaluation, or another member takes it on.
  return request.state === "closed" || request.state === "superseded" ? null : "waiting";
}

/** While a plan is read: the next state shows within this delay plus the read. */
export const TAKEOFF_REQUEST_LIVE_REFRESH_MS = 5_000;
/** While nothing is read: the Mac, a retry or a closure is awaited, or the last read failed. */
export const TAKEOFF_REQUEST_WAITING_REFRESH_MS = 30_000;
/** A plan waits its turn behind another that ended this recently: the queue moves, it is followed as a reading. */
const QUEUE_MOVED_MS = 60_000;

function latest(values: Array<string | null | undefined>) {
  let best = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const time = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(time) && time > best) best = time;
  }
  return best;
}

/**
 * How often the page reads the activity again, from its last answer: every 5 s while a plan is read or the queue just
 * moved, every 30 s while only the Mac, a retry or a closure is awaited, not at all when nothing can change by itself.
 * After a failed read the next one comes 30 s later (useTakeoffRequestActivity retries it). One delay for the page,
 * whatever its number of requests or plans. `ownRequestOnly`: the review of a plan follows its own request alone.
 */
export function takeoffRequestRefreshInterval(data: TakeoffRequestActivityResponse | undefined, lastReadFailed = false,
  options: { ownRequestOnly?: boolean } = {}): number {
  if (!data) return 0;
  const observedAt = Date.parse(data.observedAt);
  const own = options.ownRequestOnly === true;
  let fast = !own && (data.standalone.running > 0 || data.elsewhere.running);
  let slow = !own && (data.standalone.waiting > 0 || data.elsewhere.waiting);
  for (const request of own ? [data.current] : [data.current, ...data.history]) {
    if (!request) continue;
    const progress = takeoffRequestProgress(request);
    if (progress === "running") fast = true;
    else if (progress === "waiting") slow = true;
    else if (progress === "queued") {
      const units = request.units?.units ?? [];
      // A technical retry due later is awaited, not a moving queue.
      const waitsItsTurn = units.some((unit) => unit.state === "queued" && !unit.retryAt);
      const moved = latest([request.admittedAt, ...units.filter((unit) => unit.state !== "queued").map((unit) => unit.updatedAt)]);
      if (waitsItsTurn && Number.isFinite(observedAt) && observedAt - moved < QUEUE_MOVED_MS) fast = true;
      else slow = true;
    }
  }
  if (!fast && !slow) return 0;
  return fast && !lastReadFailed ? TAKEOFF_REQUEST_LIVE_REFRESH_MS : TAKEOFF_REQUEST_WAITING_REFRESH_MS;
}

const GROUPED_STATE: Record<TakeoffUnitState, string> = {
  queued: "en attente", running: "en lecture", succeeded: "lue", failed: "en échec", canceled: "arrêtée",
  not_started: "non démarrée",
};

/**
 * The coverage of a request in one line: the dispatcher's wording for plans (« 1 plan lu sur 3 · 1 en lecture · 1 en
 * attente »); a grouped analysis is one analysis of several plans (« Analyse groupée de 3 plans · en lecture »), never
 * three plans read. Null before admission.
 */
export function describeTakeoffRequestActivityCoverage(request: Pick<TakeoffRequestActivity, "units" | "groupedPlans">): string | null {
  const units = request.units;
  if (!units || units.units.length === 0) return null;
  if (units.format === "grouped") {
    const count = request.groupedPlans.length;
    const states = units.units.map((unit) => GROUPED_STATE[unit.state]);
    return `${count > 1 ? `Analyse groupée de ${count} plans` : "Analyse groupée"} · ${states.join(", ")}`;
  }
  if (units.units.length === 1) {
    const [plan] = units.units;
    return `${plan.name} · ${describeTakeoffRequestUnitState(plan, null)}`;
  }
  return describeTakeoffCoverage(units.coverage);
}

/** A unit's state in French, as its row says it; a read plan says whether it has lines and whether they were sent. */
export function describeTakeoffRequestUnitState(unit: Pick<TakeoffRequestUnitView, "state" | "retryAt">,
  job: Pick<TakeoffRequestActivityJob, "applied" | "itemCount"> | null): string {
  switch (unit.state) {
    case "queued": return unit.retryAt ? "Nouvelle tentative programmée" : "En attente";
    case "running": return "En lecture";
    case "succeeded":
      if (!job) return "Lu";
      if (job.applied) return "Reporté au devis";
      return job.itemCount > 0 ? "Prêt à revoir" : "Lu, aucune ligne retenue";
    case "failed": return "Échec";
    case "canceled": return "Arrêté";
    case "not_started": return "Non démarré";
  }
}

export function describeTakeoffRequestOrigin(request: Pick<TakeoffRequestRow, "origin" | "intent">) {
  if (request.origin === "automatic") return "Démarrage automatique à la confirmation du dossier";
  return request.intent === "remeasure_items" ? "Nouvelle mesure de postes" : "Relance de l’analyse";
}

/** The original pages a plan was read on. */
export function describeTakeoffRequestPages(pages: readonly number[]): string {
  if (pages.length === 0) return "toutes les pages";
  return `${pages.length > 1 ? "pages" : "page"} ${pages.join(", ")}`;
}

/**
 * The units this member may open the review of: read (sent or not, with lines or not) and an analysis the member reads.
 * Their order is the recorded one: « plan suivant » follows it.
 */
export function reviewableTakeoffRequestUnits(request: Pick<TakeoffRequestActivity, "units" | "jobs">) {
  const readable = new Set(request.jobs.map((job) => job.jobId));
  return (request.units?.units ?? []).filter((unit) => unit.reviewable && readable.has(unit.jobId));
}
