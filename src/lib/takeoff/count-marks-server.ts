import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAffaireAccess, type AffaireAccess } from "@/lib/affaires/access-server";
import { badRequest, conflict, forbidden, notFound } from "@/lib/http/api-error";
import { mapSupabaseError } from "@/lib/http/api-response";
import { asRecord } from "@/lib/value-guards";
import type { Database } from "@/types/database";
import {
  parseTakeoffCountMarkEditResult,
  parseTakeoffCountMarksPage,
  parseTakeoffCountMarkSummary,
  TAKEOFF_COUNT_MARK_EDIT_REFUSALS,
  takeoffCountMarkEditRefusal,
  type TakeoffCountMarkEditRefusal,
  type TakeoffCountMarkEditResult,
  type TakeoffCountMarkGesture,
  type TakeoffCountMarksPage,
  type TakeoffCountMarkState,
  type TakeoffCountMarkSummary,
} from "./count-marks";
import {
  COUNT_MARKS_HISTORY_LIMIT,
  COUNT_MARKS_PAGE_LIMIT,
  countMarkDuplicateDetailSchema,
  TAKEOFF_COUNT_MARK_EVENT_GESTURES,
  TAKEOFF_COUNT_MARKS_READ_CHANGING,
  TAKEOFF_COUNT_MARKS_READ_CHANGING_MESSAGE,
  type CountMarkDuplicateDetail,
  type CountMarkHistoryEvent,
  type CountMarkTargets,
  type CountMarksEditRequest,
  type CountMarksHistory,
  type CountMarksView,
  type TakeoffCountMarksReadOnlyReason,
} from "./count-marks-contracts";

/**
 * The readers and the edit of the counted marks of an affaire's items (lot 5), with the member's session: the database
 * checks the affaire's read rule, or its operator rule and the expected revisions under its locks, and answers the
 * server-side count. The worker's publication (public.publish_takeoff_count_marks) is the producer's, not a member's.
 *
 * A quantity counted from marks is shown, never sent: nothing here writes an item's row, an entry or a decision of the
 * table, which are what the table's retained quantity and the send read.
 */

type Client = SupabaseClient<Database>;
type EditArgs = Database["public"]["Functions"]["edit_takeoff_count_marks"]["Args"];

const READ_FAILURE = "Impossible de lire les repères du poste.";
/** Reads of a page and its count tried before saying the marks are changing. */
const VIEW_READ_ATTEMPTS = 3;
const EDIT_FAILURE = "Impossible d'enregistrer les repères du poste.";
const NOT_READ = "Ce poste n’a pas de lecture sur cette page du plan dans cette affaire.";

const clientOf = (access: AffaireAccess) => access.context.supabase as unknown as Client;

async function marksPage(access: AffaireAccess, query: { answerId: string; page: number; states?: readonly TakeoffCountMarkState[];
  afterMarkId?: string | null; limit?: number }) {
  const { context, project } = access;
  const { data, error } = await clientOf(access).rpc("read_takeoff_count_marks", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_answer_id: query.answerId, p_page: query.page,
    ...(query.states ? { p_states: [...query.states] } : {}),
    ...(query.afterMarkId ? { p_after_mark_id: query.afterMarkId } : {}),
    p_limit: Math.min(Math.max(query.limit ?? COUNT_MARKS_PAGE_LIMIT.default, 1), COUNT_MARKS_PAGE_LIMIT.max),
  });
  if (error) throw mapSupabaseError(error, READ_FAILURE);
  return data === null ? null : parseTakeoffCountMarksPage(data);
}

async function summaries(access: AffaireAccess, answerIds: readonly string[]) {
  const { context, project } = access;
  const { data, error } = await clientOf(access).rpc("read_takeoff_count_mark_summaries", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_answer_ids: answerIds.slice(0, 500),
  });
  if (error) throw mapSupabaseError(error, READ_FAILURE);
  return Object.fromEntries((data ?? []).map((row) => [row.answer_id, parseTakeoffCountMarkSummary(row.summary)])) as
    Record<string, TakeoffCountMarkSummary>;
}

/** The marks of one answer on one page of its scope, paged, with the server's total apart from the number loaded. */
export async function readAnswerCountMarks(projectId: string, query: {
  answerId: string;
  page: number;
  /** proposed, to attribute and retained by default; removed and pending on demand. */
  states?: readonly TakeoffCountMarkState[];
  afterMarkId?: string | null;
  limit?: number;
}): Promise<TakeoffCountMarksPage | null> {
  return marksPage(await requireAffaireAccess(projectId, "read"), query);
}

/** The server-side count of each answer given (at most 500), by answer. */
export async function readAnswerCountMarkSummaries(projectId: string, answerIds: readonly string[]):
  Promise<Record<string, TakeoffCountMarkSummary>> {
  return summaries(await requireAffaireAccess(projectId, "read"), answerIds);
}

/**
 * The operator rule of the database's edit (private.can_access_takeoff_scope with write: an administrator of the tenant,
 * or the engineer who owns the affaire), for what the screen offers; the command checks it again under its locks.
 */
function mayOperate(access: AffaireAccess) {
  const { context, project } = access;
  return !project.is_archived && (context.tenantRole === "admin"
    || (context.tenantRole === "engineer" && project.user_id === context.userId));
}

type AnswerFacts = { answerId: string; itemId: string; sent: boolean; replaced: boolean };

/**
 * What decides whether an answer's marks may still be corrected besides the member's right: its plan sent to an estimate
 * (its job applied, as the table of items says « sent ») and a later reading of the same item on the same plan. Read with
 * the member's session; an answer they may not read is absent.
 */
async function answerFacts(access: AffaireAccess, answerIds: readonly string[]): Promise<Map<string, AnswerFacts>> {
  const client = clientOf(access);
  const { context, project } = access;
  const ids = [...new Set(answerIds.map((value) => value.toLowerCase()))];
  const { data: answers, error } = await client.from("takeoff_item_answers")
    .select("id, item_id, job_id, plan_logical_id, reading_revision")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).in("id", ids);
  if (error) throw mapSupabaseError(error, READ_FAILURE);
  if (!answers?.length) return new Map();
  const [{ data: jobs, error: jobsError }, { data: later, error: laterError }] = await Promise.all([
    client.from("takeoff_jobs").select("id, status").eq("tenant_id", context.tenantId)
      .in("id", [...new Set(answers.map(({ job_id }) => job_id))]),
    client.from("takeoff_item_answers").select("item_id, plan_logical_id, reading_revision")
      .eq("tenant_id", context.tenantId).eq("project_id", project.id)
      .in("item_id", [...new Set(answers.map(({ item_id }) => item_id))])
      .in("plan_logical_id", [...new Set(answers.map(({ plan_logical_id }) => plan_logical_id))]),
  ]);
  if (jobsError) throw mapSupabaseError(jobsError, READ_FAILURE);
  if (laterError) throw mapSupabaseError(laterError, READ_FAILURE);
  const applied = new Set((jobs ?? []).filter(({ status }) => status === "applied").map(({ id }) => id));
  return new Map(answers.map((answer) => [answer.id, {
    answerId: answer.id,
    itemId: answer.item_id,
    sent: applied.has(answer.job_id),
    replaced: (later ?? []).some((other) => other.item_id === answer.item_id && other.plan_logical_id === answer.plan_logical_id
      && other.reading_revision > answer.reading_revision),
  }]));
}

async function memberNames(access: AffaireAccess, people: Iterable<string | null>) {
  const ids = [...new Set([...people].filter((value): value is string => Boolean(value)))];
  const names: Record<string, string> = {};
  if (!ids.length) return names;
  const { data, error } = await clientOf(access).from("profiles").select("id, full_name").in("id", ids);
  if (error) throw mapSupabaseError(error, "Impossible de lire les auteurs des repères.");
  for (const profile of data ?? []) if (profile.full_name?.trim()) names[profile.id] = profile.full_name.trim();
  return names;
}

/**
 * The marks of one answer on one page for the detail of its item: the page of marks (the server's total apart from the
 * number loaded), the answer's server-side count, and whether this member may correct them now (and why not). A page out
 * of the answer's scope, or an answer the member may not read, is not found.
 */
export async function readCountMarksView(projectId: string, query: { answerId: string; page: number;
  states?: readonly TakeoffCountMarkState[]; afterMarkId?: string | null; limit?: number }): Promise<CountMarksView> {
  const access = await requireAffaireAccess(projectId, "read");
  const answerId = query.answerId.toLowerCase();
  const facts = await answerFacts(access, [answerId]);
  const fact = facts.get(answerId);
  // The page and the count are two reads: they are answered together only at one revision of the answer's marks.
  let read: { page: TakeoffCountMarksPage | null; summary: TakeoffCountMarkSummary | undefined } | null = null;
  for (let attempt = 0; attempt < VIEW_READ_ATTEMPTS && !read; attempt += 1) {
    const [page, counted] = await Promise.all([marksPage(access, { ...query, answerId }), summaries(access, [answerId])]);
    const summary = counted[answerId];
    if (!page || !summary || page.revision === summary.revision) read = { page, summary };
  }
  if (!read) throw conflict(TAKEOFF_COUNT_MARKS_READ_CHANGING_MESSAGE, undefined, TAKEOFF_COUNT_MARKS_READ_CHANGING);
  const { page, summary } = read;
  if (!page || !summary || !fact) throw notFound(NOT_READ, undefined, "TAKEOFF_MARKS_ANSWER_NOT_FOUND");
  const reason: TakeoffCountMarksReadOnlyReason | null = !mayOperate(access) ? "forbidden" : fact.sent ? "sent"
    : fact.replaced ? "replaced" : null;
  const names = await memberNames(access, page.marks.flatMap((mark) => [mark.createdBy, mark.movedBy, mark.decidedBy]));
  return { ...page, summary, edit: { allowed: reason === null, reason }, viewerId: access.context.userId, names };
}

/** What a refusal for a possible duplicate names, read from the command's detail; null when it names nothing readable. */
function duplicateDetail(detail: string | null | undefined): CountMarkDuplicateDetail | null {
  try {
    const value = asRecord(JSON.parse(detail ?? "null"));
    const parsed = countMarkDuplicateDetailSchema.safeParse(value ? { gesture: value.gesture, twins: value.twins,
      addedKeys: value.added_keys } : null);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function refusalError(code: TakeoffCountMarkEditRefusal, details?: unknown) {
  const message = TAKEOFF_COUNT_MARK_EDIT_REFUSALS[code];
  switch (code) {
    case "TAKEOFF_MARKS_FORBIDDEN":
      return forbidden(message, undefined, code);
    case "TAKEOFF_MARKS_ANSWER_NOT_FOUND":
    case "TAKEOFF_MARKS_MARK_NOT_FOUND":
      return notFound(message, undefined, code);
    case "TAKEOFF_MARKS_REVISION_CONFLICT":
    case "TAKEOFF_MARKS_INTENT_CONFLICT":
    case "TAKEOFF_MARKS_ANSWER_REPLACED":
    case "TAKEOFF_MARKS_ATTRIBUTION_TAKEN":
    case "TAKEOFF_MARKS_OBJECT_DUPLICATE":
    case "TAKEOFF_MARKS_PAGE_GEOMETRY_CONFLICT":
    case "TAKEOFF_MARKS_PLAN_SENT":
      return conflict(message, details, code);
    default:
      return badRequest(message, undefined, code);
  }
}

async function runEdit(access: AffaireAccess, command: { intentKey: string; revisions: Record<string, number>;
  gestures: readonly TakeoffCountMarkGesture[] }): Promise<TakeoffCountMarkEditResult> {
  const { context, project } = access;
  const { data, error } = await clientOf(access).rpc("edit_takeoff_count_marks", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_intent_key: command.intentKey,
    p_revisions: command.revisions, p_gestures: command.gestures as unknown as EditArgs["p_gestures"],
  });
  if (error) {
    const refusal = takeoffCountMarkEditRefusal(error.message);
    if (refusal === "TAKEOFF_MARKS_OBJECT_DUPLICATE") throw refusalError(refusal, duplicateDetail(error.details) ?? undefined);
    throw refusal ? refusalError(refusal) : mapSupabaseError(error, EDIT_FAILURE);
  }
  return parseTakeoffCountMarkEditResult(data);
}

/**
 * An operator's edit of N gestures at once, under the expected marks revision of every answer it changes; the same
 * intention key with the same content answers the same, replayed. A refusal of the command is answered in French with
 * its own code; nothing is written.
 */
export async function editAnswerCountMarks(projectId: string, command: {
  intentKey: string;
  /** Every answer the edit changes, with the marks revision it was shown. */
  revisions: Record<string, number>;
  gestures: readonly TakeoffCountMarkGesture[];
}): Promise<TakeoffCountMarkEditResult> {
  return runEdit(await requireAffaireAccess(projectId, "write"), command);
}

/**
 * The edit of the detail of an item: the database's command. It refuses a plan already sent to an estimate
 * (TAKEOFF_MARKS_PLAN_SENT) itself, under its locks and after the replay of the intention: a send and an edit exclude
 * each other, and the same intention sent again after a lost answer gets its receipt even once the plan is sent.
 */
export async function editCountMarksAsMember(projectId: string, command: CountMarksEditRequest): Promise<TakeoffCountMarkEditResult> {
  // A member who may not operate is refused before the command; the command checks the right again.
  const access = await requireAffaireAccess(projectId, "read");
  if (!mayOperate(access)) throw refusalError("TAKEOFF_MARKS_FORBIDDEN");
  // The database names answers in lower case; an answer named twice in two cases is refused, never merged (the schema).
  const revisions = Object.fromEntries(Object.entries(command.revisions).map(([answerId, revision]) => [answerId.toLowerCase(), revision]));
  return runEdit(access, { intentKey: command.intentKey, revisions, gestures: command.gestures as readonly TakeoffCountMarkGesture[] });
}

/** The journal of an answer's marks, in order, after the position given. */
export async function readAnswerCountMarkEvents(projectId: string, query: {
  answerId: string; after?: { revision: number; ordinal: number } | null; limit?: number;
}) {
  return events(await requireAffaireAccess(projectId, "read"), query);
}

async function events(access: AffaireAccess, query: { answerId: string; after?: { revision: number; ordinal: number } | null;
  limit?: number }) {
  const { context, project } = access;
  const { data, error } = await clientOf(access).rpc("read_takeoff_count_mark_events", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_answer_id: query.answerId,
    p_after_revision: query.after?.revision ?? 0, p_after_ordinal: query.after?.ordinal ?? 0,
    p_limit: Math.min(Math.max(query.limit ?? 200, 1), 500),
  });
  if (error) throw mapSupabaseError(error, READ_FAILURE);
  return data ?? [];
}

const EVIDENCE_TEXT_MAX = 300;
const cut = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const characters = [...value.trim()];
  return characters.length > EVIDENCE_TEXT_MAX ? `${characters.slice(0, EVIDENCE_TEXT_MAX - 1).join("")}…` : characters.join("");
};
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value
  : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const positiveInteger = (value: unknown) => {
  const parsed = finite(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
};

/** What the journal kept of a retained mark's support, for a reader: its methods and its observations' words, cut. */
function evidenceOf(value: unknown): CountMarkHistoryEvent["evidence"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).flatMap((entry) => {
    const proposal = asRecord(entry);
    if (!proposal) return [];
    const observation = asRecord(proposal.observation);
    const generation = finite(proposal.generation);
    return [{
      method: typeof proposal.method === "string" ? proposal.method : null,
      methodVersion: typeof proposal.method_version === "string" ? proposal.method_version : null,
      generation: generation !== null && Number.isInteger(generation) && generation >= 0 ? generation : null,
      observation: observation ? { page: positiveInteger(observation.page), quantity: finite(observation.quantity),
        unit: typeof observation.unit === "string" ? observation.unit : null, evidence: cut(observation.evidence) } : null,
    }];
  });
}

const objectOrNull = (value: unknown) => asRecord(value);

/**
 * The journal of an answer's marks for the detail of its item, under the affaire's read rule: who did what, when, before
 * and after, with what reason, in order, by pages. An answer the member may not read is not found.
 */
export async function readCountMarksHistory(projectId: string, query: { answerId: string; after: { revision: number; ordinal: number } | null;
  limit?: number }): Promise<CountMarksHistory> {
  const access = await requireAffaireAccess(projectId, "read");
  const answerId = query.answerId.toLowerCase();
  const limit = Math.min(Math.max(query.limit ?? COUNT_MARKS_HISTORY_LIMIT.default, 1), COUNT_MARKS_HISTORY_LIMIT.max);
  const [rows, facts] = await Promise.all([events(access, { answerId, after: query.after, limit: limit + 1 }),
    answerFacts(access, [answerId])]);
  if (!facts.has(answerId)) throw notFound(NOT_READ, undefined, "TAKEOFF_MARKS_ANSWER_NOT_FOUND");
  const shown = rows.slice(0, limit);
  const last = shown.at(-1);
  const gestures = new Set<string>(TAKEOFF_COUNT_MARK_EVENT_GESTURES);
  const eventsShown = shown.filter((row) => gestures.has(row.gesture)).map((row): CountMarkHistoryEvent => ({
    eventId: row.event_id,
    revision: row.revision,
    ordinal: row.ordinal,
    gesture: row.gesture as CountMarkHistoryEvent["gesture"],
    markId: row.mark_id,
    page: row.page,
    before: objectOrNull(row.before),
    after: objectOrNull(row.after),
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    evidence: evidenceOf(row.evidence),
    actorKind: row.actor_kind === "worker" ? "worker" : "member",
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
  }));
  return {
    answerId,
    events: eventsShown,
    next: rows.length > limit && last ? { revision: last.revision, ordinal: last.ordinal } : null,
    viewerId: access.context.userId,
    names: await memberNames(access, eventsShown.map(({ actorId }) => actorId)),
  };
}

/** Every row a read gives, by ranges of 1,000 (the API's ceiling per request), so that a large reading is never cut. */
async function allRows<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw mapSupabaseError(error as Parameters<typeof mapSupabaseError>[0], READ_FAILURE);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

/** The values of a list by chunks small enough for a filter of the API. */
const chunks = <T>(values: readonly T[], size = 200) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

/**
 * The items a mark of an answer may be given to (lot 5 follow-ups): what the edit command accepts as a destination
 * (public.edit_takeoff_count_marks, `reattribute`) — another answer of the same plan and plan bytes, of an item of the
 * source's sealed list whose expected unit is the source's (compared null-safe, as SQL compares them) — restricted further
 * to the same reading (its job), whose answer no later reading of that item on that plan replaced, by their place in the
 * reading's list, whatever the table of items shows. Each with the pages its answer read: the command checks that the
 * mark's page is one of them, so the screen offers a destination only for a mark of those pages. Read with the member's
 * session (the affaire's read rule); the command checks everything again under its locks.
 */
export async function readCountMarkTargets(projectId: string, input: { answerId: string }): Promise<CountMarkTargets> {
  const access = await requireAffaireAccess(projectId, "read");
  const client = clientOf(access);
  const { context, project } = access;
  const answerId = input.answerId.toLowerCase();
  const { data: source, error } = await client.from("takeoff_item_answers")
    .select("id, item_id, job_id, plan_logical_id, plan_content_sha256, list_revision_id")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", answerId).maybeSingle();
  if (error) throw mapSupabaseError(error, READ_FAILURE);
  if (!source) throw notFound(NOT_READ, undefined, "TAKEOFF_MARKS_ANSWER_NOT_FOUND");
  const answers = await allRows<{ id: string; item_id: string; reading_revision: number; plan_content_sha256: string;
    searched_pages: number[] | null; unreadable_pages: number[] | null }>((from, to) => client.from("takeoff_item_answers")
    .select("id, item_id, reading_revision, plan_content_sha256, searched_pages, unreadable_pages")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("job_id", source.job_id)
    .eq("plan_logical_id", source.plan_logical_id).neq("item_id", source.item_id).order("id").range(from, to));
  const itemIds = [...new Set(answers.map(({ item_id }) => item_id))];
  const later = new Map<string, number>();
  const labels = new Map<string, { label: string; position: number; unit: string | null }>();
  for (const ids of chunks([...itemIds, source.item_id])) {
    const [readings, entries] = await Promise.all([
      allRows<{ item_id: string; reading_revision: number }>((from, to) => client.from("takeoff_item_answers")
        .select("item_id, reading_revision").eq("tenant_id", context.tenantId).eq("project_id", project.id)
        .eq("plan_logical_id", source.plan_logical_id).in("item_id", ids).order("id").range(from, to)),
      allRows<{ item_id: string; label: string; position: number; expected_unit: string | null }>((from, to) => client
        .from("takeoff_list_revision_entries").select("item_id, label, position, expected_unit")
        .eq("tenant_id", context.tenantId).eq("project_id", project.id)
        .eq("revision_id", source.list_revision_id).in("item_id", ids).order("position").range(from, to)),
    ]);
    for (const reading of readings) later.set(reading.item_id, Math.max(later.get(reading.item_id) ?? 0, reading.reading_revision));
    for (const entry of entries) labels.set(entry.item_id, { label: entry.label, position: entry.position, unit: entry.expected_unit ?? null });
  }
  // The source's own entry: a destination keeps its expected unit (null-safe: no unit goes to no unit only).
  const unit = labels.get(source.item_id)?.unit ?? null;
  const targets = answers.flatMap((answer) => {
    const entry = labels.get(answer.item_id);
    return entry && (later.get(answer.item_id) ?? 0) <= answer.reading_revision && entry.unit === unit
      && answer.plan_content_sha256 === source.plan_content_sha256
      ? [{ answerId: answer.id, itemId: answer.item_id, label: entry.label, position: entry.position,
        scopePages: [...new Set([...(answer.searched_pages ?? []), ...(answer.unreadable_pages ?? [])])].sort((a, b) => a - b) }] : [];
  }).sort((left, right) => left.position - right.position || left.answerId.localeCompare(right.answerId));
  return { answerId, targets: targets.map(({ position, ...target }) => { void position; return target; }) };
}
