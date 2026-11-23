import "server-only";

import { z } from "zod";

import { readAllRowsInChunks } from "@/lib/supabase/read-all";
import { mapSupabaseError } from "@/lib/http/api-response";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { readSealedItemListItems } from "@/lib/takeoff/item-list-server";
import type { AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import type {
  ItemSendAnswer,
  ItemSendDisplacedTarget,
  ItemSendEarlierSection,
  ItemSendEarlierTarget,
  ItemSendListItem,
  ItemSendPageInEstimate,
} from "@/lib/takeoff/item-send-plan";

/**
 * Lot 4, PR 5a/5b: the one reader of what the send by item needs that other pull requests store — the stored answers of a
 * plan (lot 4 PR 3a, migration B1), their effective review decisions and the entries (PR 4, migration B2), and what earlier
 * sends by item wrote in a draft (migration C). It reads them through the database's readers, the ones the writer reads
 * again under its locks (public.read_takeoff_item_send_facts, public.read_takeoff_item_send_draft), so that the plan the
 * server computes and the one the writer checks are computed from the same facts. The effective decision is B2's
 * (private.takeoff_item_table_pairs.decision_effective), read there once.
 *
 * Read with the member's session: each reader checks the member's access to the affaire, and the sealed list's entries
 * follow their own policy.
 */

type Member = Pick<AuthenticatedTakeoffContext, "supabase" | "tenantId" | "userId">;

/** What a plan's job answered for the sealed list it read. */
export type ItemSendReading = {
  /** The sealed list revision, in document order. */
  items: ItemSendListItem[];
  /** The items this plan was asked about: those its reading answered, in the sealed order. */
  scope: string[];
  /** One answer per item of the scope, each with its effective decision and the entry of this plan. */
  answers: ItemSendAnswer[];
  /** Quantities entered for an item on the whole affaire. */
  affaireEntries: Array<{ itemId: string; revision: number }>;
};

export type ItemSendFacts = { state: "not_stored" } | { state: "stored"; reading: ItemSendReading };

const uuid = z.string().uuid();
const page = z.number().int().positive();

const factsSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not_stored") }),
  z.object({
    state: z.literal("stored"),
    list_revision_id: uuid,
    unit_pages: z.array(page),
    answers: z.array(z.object({
      item_id: uuid,
      answer_id: uuid,
      revision: z.string(),
      outcome: z.enum(["measured", "uncertain", "not_found"]),
      current: z.boolean(),
      searched_pages: z.array(page),
      quantity_source: z.literal("verified_count").optional(),
      verified_count: z.object({ quantity: z.number().int().positive(), unit: z.string(), pages: z.array(page),
        marks_revision: z.number().int().positive() }).nullable().optional(),
      observations: z.array(z.object({
        observation_id: uuid,
        role: z.enum(["contribution", "candidate", "alternative"]),
        source: z.string(),
        quantity: z.number().nullable(),
        unit: z.string().nullable(),
        page: page.nullable(),
        measurement_basis: z.string().nullable(),
      })),
      decision: z.object({ kind: z.enum(["accepted", "set_aside"]), revision: z.number().int().positive() }).nullable(),
      entry: z.object({ revision: z.number().int().positive(), quantity: z.number(), unit: z.string(), category: z.string(),
        included: z.boolean() }).nullable(),
    })),
    affaire_entries: z.array(z.object({ item_id: uuid, revision: z.number().int().positive() })),
  }),
]);

const identitySchema = z.object({ unit: z.string(), basis: z.string().nullable(), network: z.string().nullable(),
  material: z.string().nullable(), diameter: z.string().nullable() });
const partSchema = z.object({
  job_id: uuid,
  answer_id: uuid.nullable(),
  observation_ids: z.array(uuid),
  quantity: z.number(),
  pages: z.array(page),
  plan_key: uuid.nullable(),
  identity: identitySchema,
});
const breakdownSchema = z.enum(["together", "by_level", "by_building", "dpgf"]);

const draftSchema = z.object({
  earlier_targets: z.array(z.object({ estimate_item_id: uuid, item_id: uuid, compartment_key: z.string(), breakdown: breakdownSchema,
    parts: z.array(partSchema) })),
  displaced_targets: z.array(z.object({ item_id: uuid, compartment_key: z.string(), breakdown: breakdownSchema,
    parts: z.array(partSchema) })),
  sections: z.array(z.object({ key: z.string(), estimate_item_id: uuid })),
  pages_in_estimate: z.array(z.object({
    page: page.nullable(),
    earlier_job_ids: z.array(z.string()),
    estimate_item_ids: z.array(z.string()),
    today: z.boolean(),
    today_estimate_item_ids: z.array(z.string()),
    parts: z.array(z.object({ part_id: uuid, job_id: uuid, item_id: uuid, plan_key: uuid, pages: z.array(page),
      estimate_item_id: uuid, answer_id: uuid, observation_ids: z.array(uuid) })),
  })),
});

function failed(error: { message?: string } | null, message: string, jobId: string): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId });
}

function unreadable(jobId: string, message: string): never {
  throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId, message,
    details: { guard: "item_send_facts_unreadable" } });
}

/** A part as the planner reads it: its stored quantitative identity is the one compared, never re-derived. */
function partOf(part: z.infer<typeof partSchema>): ItemSendEarlierTarget["parts"][number] {
  return { jobId: part.job_id, answerId: part.answer_id, observationIds: part.observation_ids, quantity: part.quantity,
    unit: part.identity.unit, basis: part.identity.basis,
    qualifiers: { network: part.identity.network ?? undefined, material: part.identity.material ?? undefined,
      diameter: part.identity.diameter ?? undefined },
    pages: part.pages, planKey: part.plan_key, identity: part.identity };
}

/** The breakdown of a target (a DPGF line's is « dpgf »): the planner compares a draft's breakdown with the send's. */
const breakdownOf = (value: z.infer<typeof breakdownSchema>) => value as ItemSendEarlierTarget["breakdown"];

export async function readItemSendFacts(member: Member, input: {
  jobId: string;
  projectId: string;
  list: { revisionId: string; revision: number; itemCount: number };
}): Promise<ItemSendFacts> {
  const { data, error } = await member.supabase.rpc("read_takeoff_item_send_facts" as never,
    { p_tenant_id: member.tenantId, p_project_id: input.projectId, p_job_id: input.jobId } as never);
  if (error) failed(error, "Impossible de lire les réponses par poste de ce plan.", input.jobId);
  const parsed = factsSchema.safeParse(data);
  if (!parsed.success) unreadable(input.jobId, "Les réponses par poste de ce plan sont illisibles.");
  if (parsed.data.state === "not_stored") return { state: "not_stored" };
  const facts = parsed.data;
  if (facts.list_revision_id.toLowerCase() !== input.list.revisionId.toLowerCase()) {
    unreadable(input.jobId, "Ce plan a été lu contre une autre liste que celle de sa demande.");
  }
  const items: ItemSendListItem[] = await readSealedItemListItems(member.supabase as never, { tenantId: member.tenantId,
    projectId: input.projectId, revisionId: input.list.revisionId, itemCount: input.list.itemCount });
  const answered = new Set(facts.answers.map((answer) => answer.item_id.toLowerCase()));
  const answers: ItemSendAnswer[] = facts.answers.map((answer) => ({
    itemId: answer.item_id,
    answerId: answer.answer_id,
    revision: answer.revision,
    outcome: answer.outcome,
    current: answer.current,
    searchedPages: answer.searched_pages,
    ...(answer.quantity_source === "verified_count" ? { quantitySource: answer.quantity_source,
      verifiedCount: answer.verified_count ? { quantity: answer.verified_count.quantity, unit: answer.verified_count.unit,
        pages: answer.verified_count.pages, marksRevision: answer.verified_count.marks_revision } : null } : {}),
    observations: answer.observations.map((observation) => ({ observationId: observation.observation_id, role: observation.role,
      source: observation.source === "vector" ? "vector" : "model", quantity: observation.quantity, unit: observation.unit,
      page: observation.page, measurementBasis: observation.measurement_basis })),
    decision: answer.decision,
    entry: answer.entry,
  }));
  return { state: "stored", reading: {
    items,
    scope: items.filter((item) => answered.has(item.id.toLowerCase())).map((item) => item.id),
    answers,
    affaireEntries: facts.affaire_entries.map((entry) => ({ itemId: entry.item_id, revision: entry.revision })),
  } };
}

/**
 * What earlier sends by item wrote in this draft, read for this job's send: the live targets with their live parts, the
 * targets whose line the editor deleted (their parts still live), the sections they created, and the pages of the job's
 * plan the draft already holds from another analysis (the writer's page guard, on the same pages).
 */
export async function readItemSendEarlierState(member: Member, input: { projectId: string; versionId: string; jobId: string; incomingCountItems: readonly string[] }):
  Promise<{ targets: ItemSendEarlierTarget[]; displaced: ItemSendDisplacedTarget[]; sections: ItemSendEarlierSection[];
    pagesInEstimate: ItemSendPageInEstimate[] }> {
  const { data, error } = await member.supabase.rpc("read_takeoff_item_send_draft" as never, { p_tenant_id: member.tenantId,
    p_project_id: input.projectId, p_version_id: input.versionId, p_job_id: input.jobId } as never);
  if (error) failed(error, "Impossible de lire ce que le brouillon tient des envois par poste.", input.jobId);
  const parsed = draftSchema.safeParse(data);
  if (!parsed.success) unreadable(input.jobId, "Ce que le brouillon tient des envois par poste est illisible.");
  const draft = parsed.data;
  const previous = [...draft.earlier_targets, ...draft.displaced_targets];
  const answerIds = [...new Set(previous.flatMap((target) =>
    target.parts.flatMap((part) => part.answer_id && !part.observation_ids.length ? [part.answer_id] : [])))];
  const { data: counts, error: countError } = await readAllRowsInChunks(answerIds, (ids) =>
    member.supabase.from("takeoff_item_send_parts").select("id,item_id,plan_logical_id,job_id,answer_id,marks_revision", { count: "exact" })
      .eq("tenant_id", member.tenantId).eq("project_id", input.projectId).eq("version_id", input.versionId)
      .eq("state", "live").eq("kind", "verified_count").in("answer_id", ids));
  if (countError) failed(countError, "Impossible de lire la preuve des comptages du brouillon.", input.jobId);
  const incoming = new Set(input.incomingCountItems);
  const readingIds = new Set((counts ?? []).map((row) => row.answer_id));
  for (const target of previous) {
    if (incoming.has(target.item_id)) {
      for (const part of target.parts) if (part.answer_id) readingIds.add(part.answer_id);
    }
  }
  const { data: readings, error: readingError } = await readAllRowsInChunks([...readingIds], (ids) =>
    member.supabase.from("takeoff_item_answers").select("id,reading_revision", { count: "exact" })
      .eq("tenant_id", member.tenantId).eq("project_id", input.projectId).in("id", ids));
  if (readingError) failed(readingError, "Impossible de lire les lectures des quantités de ce poste.", input.jobId);
  const revisions = new Map(readings?.map((row) => [row.id, row.reading_revision]));
  const currentMarks = new Map<string, number>();
  const countAnswers = [...new Set((counts ?? []).map(part => part.answer_id))];
  for (let offset = 0; offset < countAnswers.length; offset += 500) {
    const read = await member.supabase.rpc("read_takeoff_count_mark_summaries", {
      p_tenant_id: member.tenantId, p_project_id: input.projectId, p_answer_ids: countAnswers.slice(offset, offset + 500),
    });
    if (read.error) failed(read.error, "Impossible de vérifier la révision des repères précédents.", input.jobId);
    for (const row of read.data ?? []) currentMarks.set(row.answer_id, z.object({ revision: z.number().int() }).parse(row.summary).revision);
  }
  const proofs = new Map((counts ?? []).map((row) => [JSON.stringify([row.item_id, row.plan_logical_id, row.job_id, row.answer_id]),
    { marksRevision: row.marks_revision!, readingRevision: revisions.get(row.answer_id) ?? null,
      ...(row.marks_revision !== null && (currentMarks.get(row.answer_id) ?? 0) > row.marks_revision
        ? { correctedProof: {part_id: row.id, sent_revision: row.marks_revision, current_revision: currentMarks.get(row.answer_id)!} } : {}) }]));
  const partsOf = (target: { item_id: string; parts: z.infer<typeof partSchema>[] }) => target.parts.map((part) => {
    const verifiedCount = !part.observation_ids.length && proofs.get(JSON.stringify([target.item_id, part.plan_key, part.job_id, part.answer_id]));
    if (verifiedCount) return { ...partOf(part), verifiedCount };
    const readingRevision = part.answer_id && revisions.get(part.answer_id);
    return readingRevision ? { ...partOf(part), readingRevision } : partOf(part);
  });
  return {
    targets: draft.earlier_targets.map((target) => ({ itemId: target.item_id, breakdown: breakdownOf(target.breakdown),
      compartmentKey: target.compartment_key, estimateItemId: target.estimate_item_id, parts: partsOf(target) })),
    displaced: draft.displaced_targets.map((target) => ({ itemId: target.item_id, breakdown: breakdownOf(target.breakdown),
      compartmentKey: target.compartment_key, parts: partsOf(target) })),
    sections: draft.sections.map((section) => ({ key: section.key, estimateItemId: section.estimate_item_id })),
    pagesInEstimate: draft.pages_in_estimate.map((entry) => ({ page: entry.page, earlierJobIds: entry.earlier_job_ids,
      estimateItemIds: entry.estimate_item_ids, today: entry.today, todayEstimateItemIds: entry.today_estimate_item_ids,
      parts: entry.parts.map((part) => ({ partId: part.part_id, jobId: part.job_id, itemId: part.item_id, planKey: part.plan_key,
        pages: part.pages, estimateItemId: part.estimate_item_id, answerId: part.answer_id, observationIds: part.observation_ids })) })),
  };
}
