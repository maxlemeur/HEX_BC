import { z } from "zod";

import { generatedOuvrageReadUnavailable, generatedOuvrageReviewTokenSchema } from "@/lib/estimates/generated-ouvrage-atomic";

const uuid = z.string().uuid();
const date = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const row = z.object({ id: uuid, tenant_id: uuid, created_at: date }).passthrough();
const scoped = row.extend({ project_id: uuid, draft_id: uuid }).passthrough();
const object = z.record(z.string(), z.unknown());
const componentMetadata = object.refine((value) =>
  value.rejected_from_status === undefined || value.rejected_from_status === null ||
  value.rejected_from_status === "suggested" || value.rejected_from_status === "manual"
);
const nullableText = z.string().nullable();
const n = z.number().finite();
const componentScope = { subdetail_id: uuid, parent_work_id: uuid };
const snapshotSchema = z.object({
  draft: row.extend({ updated_at: date, project_id: uuid, target_version_id: uuid, created_by: uuid,
    source_kind: z.enum(["free_text", "cctp_excerpt", "internal_note"]), preferred_lot_id: uuid.nullable(),
    status: z.enum(["pending", "partially_applied", "applied", "discarded"]), summary: object,
    generation_metadata: object, applied_at: date.nullable() }),
  candidate: scoped.extend({ updated_at: date, target_version_id: uuid, candidate_order: n.int(),
    suggested_lot_id: uuid.nullable(), lot_label: nullableText, designation: z.string(), normalized_designation: z.string(),
    unit: nullableText, quantity: n.nullable(), confidence: n,
    ai_status: z.enum(["certain", "plausible", "question"]),
    resolution_status: z.enum(["pending", "inserted", "rejected"]), reasoning: nullableText, metadata: object }),
  subdetailDraft: scoped.extend({ updated_at: date, target_version_id: uuid, parent_work_id: uuid, created_by: uuid,
    status: z.enum(["pending_review", "reviewed", "applied", "discarded"]), summary: object,
    generation_metadata: object, applied_at: date.nullable() }).nullable(),
  items: z.array(scoped.extend({ ...componentScope, updated_at: date, source_fragment_id: uuid.nullable(),
    component_order: n.int(), status: z.enum(["suggested", "manual", "rejected"]),
    cost_type: z.enum(["material", "labor", "equipment", "subcontract"]), designation: z.string(),
    unit: nullableText, quantity: n.nonnegative(), unit_cost_ht_cents: n.int().nonnegative(),
    loss_coeff_bp: n.int().nonnegative(), yield_value: n.nullable(), yield_unit: nullableText,
    confidence: n, source_label: nullableText, facts: z.array(z.string()), hypotheses: z.array(z.string()),
    inferences: z.array(z.string()), metadata: componentMetadata })).max(24),
  itemSources: z.array(row.extend({ ...componentScope, draft_id: uuid, component_id: uuid,
    source_fragment_id: uuid, source_rank: n.int(), evidence_kind: z.enum(["fact", "hypothesis", "inference"]),
    note: nullableText, metadata: object })).max(144),
  candidateSources: z.array(row.extend({ draft_id: uuid, candidate_id: uuid, source_fragment_id: uuid,
    source_rank: n.int(), rationale: nullableText, metadata: object })),
  fragments: z.array(scoped.extend({ updated_at: date, fragment_order: n.int(), source_kind: z.string(),
    status: z.enum(["active", "discarded"]), label: z.string(), excerpt: z.string(), normalized_excerpt: z.string(),
    source_document_id: uuid.nullable(), source_file_name: nullableText, source_page_from: n.int().nullable(),
    source_page_to: n.int().nullable(), selection_label: nullableText, cctp_section_ref: nullableText, metadata: object })),
  reviewToken: generatedOuvrageReviewTokenSchema.nullable(),
}).strict();

export function parseGeneratedOuvrageReview(value: unknown, scope: {
  tenantId: string; versionId: string; draftId: string; candidateId: string; actorId: string;
}) {
  if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > 2 * 1024 * 1024) throw generatedOuvrageReadUnavailable();
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) throw generatedOuvrageReadUnavailable();
  const result = parsed.data;
  const draft = result.draft;
  const candidate = result.candidate;
  const subdetail = result.subdetailDraft;
  const fragments = new Set(result.fragments.map((entry) => entry.id));
  const items = new Set(result.items.map((entry) => entry.id));
  const all = [draft, candidate, ...(subdetail ? [subdetail] : []), ...result.items,
    ...result.itemSources, ...result.candidateSources, ...result.fragments];
  if (draft.id !== scope.draftId || draft.target_version_id !== scope.versionId || draft.created_by !== scope.actorId ||
    candidate.id !== scope.candidateId || candidate.draft_id !== draft.id || candidate.project_id !== draft.project_id ||
    candidate.target_version_id !== scope.versionId || all.some((entry) => entry.tenant_id !== scope.tenantId) ||
    (subdetail === null) !== (result.reviewToken === null) ||
    (!subdetail && (result.items.length > 0 || result.itemSources.length > 0)) ||
    (subdetail && (subdetail.draft_id !== draft.id || subdetail.project_id !== draft.project_id ||
      subdetail.parent_work_id !== candidate.id || subdetail.target_version_id !== scope.versionId || subdetail.created_by !== scope.actorId)) ||
    result.fragments.some((entry) => entry.project_id !== draft.project_id || entry.draft_id !== draft.id) ||
    fragments.size !== result.fragments.length || items.size !== result.items.length ||
    result.items.some((entry) => entry.draft_id !== draft.id || entry.project_id !== draft.project_id ||
      entry.subdetail_id !== subdetail?.id || entry.parent_work_id !== candidate.id ||
      (entry.source_fragment_id !== null && !fragments.has(entry.source_fragment_id))) ||
    result.itemSources.some((entry) => entry.draft_id !== draft.id || entry.subdetail_id !== subdetail?.id ||
      entry.parent_work_id !== candidate.id || !items.has(entry.component_id) || !fragments.has(entry.source_fragment_id)) ||
    result.candidateSources.some((entry) => entry.draft_id !== draft.id || entry.candidate_id !== candidate.id ||
      !fragments.has(entry.source_fragment_id))) throw generatedOuvrageReadUnavailable();
  return result;
}
