import { z } from "zod";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Json } from "@/types/database";

import {
  badRequest,
  conflict,
  forbidden,
  internalError,
  mapSupabaseError,
  notFound,
  type SupabaseErrorLike,
} from "./errors";

const uuidSchema = z.uuid();
const revisionSchema = z.union([
  z.number().int().positive(),
  z.string().regex(/^[1-9]\d*$/),
]);

const reviewCycleSchema = z.object({
  id: uuidSchema,
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  tenant_id: uuidSchema,
  version_id: uuidSchema,
  cycle_number: z.number().int().positive(),
  requested_by: uuidSchema,
  requested_at: z.string().min(1),
  submission_message: z.string().nullable(),
  assigned_reviewer_id: uuidSchema,
  decided_by: uuidSchema.nullable(),
  decision: z
    .enum(["approved", "approved_with_reservations", "changes_requested"])
    .nullable(),
  decided_at: z.string().nullable(),
  carried_over_from_cycle_id: uuidSchema.nullable(),
  requested_content_revision: revisionSchema,
  superseded_at: z.string().nullable(),
  superseded_by: uuidSchema.nullable(),
  superseded_by_cycle_id: uuidSchema.nullable(),
});

const reviewApprovalSchema = z.object({
  id: uuidSchema,
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  tenant_id: uuidSchema,
  version_id: uuidSchema,
  rule_id: uuidSchema,
  requested_by: uuidSchema,
  approved_by: uuidSchema.nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  decided_at: z.string().nullable(),
  approved_content_revision: revisionSchema.nullable(),
  review_cycle_id: uuidSchema,
  superseded_at: z.string().nullable(),
});

const reviewSubmissionSchema = z.object({
  created: z.boolean(),
  cycle: reviewCycleSchema,
  approvals: z.array(reviewApprovalSchema).min(1),
});

export type OpenEstimateReviewCycleResult = z.infer<
  typeof reviewSubmissionSchema
>;

export type OpenEstimateReviewCycleInput = {
  versionId: string;
  tenantId: string;
  actorUserId: string;
  assignedReviewerId: string;
  ruleIds: string[];
  submissionMessage?: string | null;
  eventMetadata?: Json;
};

function normalizeUuid(value: string, label: string) {
  const parsed = uuidSchema.safeParse(value.trim());
  if (!parsed.success) {
    throw badRequest(`${label} est invalide.`);
  }
  return parsed.data;
}

function normalizeRuleIds(ruleIds: string[]) {
  const normalized = [...new Set(ruleIds.map((ruleId) => normalizeUuid(ruleId, "rule_id")))];
  if (normalized.length === 0) {
    throw badRequest("Au moins une regle de validation est obligatoire.");
  }
  return normalized;
}

function normalizeEventMetadata(metadata: Json | undefined): Json {
  if (metadata === undefined) return {};
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") {
    throw badRequest("Les metadonnees de soumission sont invalides.");
  }
  return metadata;
}

function normalizeSubmissionMessage(message: string | null | undefined) {
  if (message === null || message === undefined) return null;
  const normalized = message.trim();
  if (!normalized) {
    throw badRequest("Le message de soumission ne peut pas etre vide.");
  }
  return normalized;
}

function mapReviewSubmissionError(error: SupabaseErrorLike) {
  const message = error.message.trim();

  if (message.includes("ESTIMATE_V2_SNAPSHOT_STALE")) {
    return conflict(
      "Le calcul du devis a change. Figez-le de nouveau avant de le soumettre.",
      { code: error.code },
      "VERSION_CONFLICT"
    );
  }

  if (message.includes("ESTIMATE_REVIEW_OPEN_FORBIDDEN")) {
    return forbidden("Vous ne pouvez pas ouvrir cette revue.");
  }

  if (message.includes("ESTIMATE_REVIEW_DRAFT_NOT_FOUND")) {
    return notFound("Le brouillon de devis a soumettre est introuvable.");
  }

  if (message.includes("ESTIMATE_REVIEW_ASSIGNED_REVIEWER_INVALID")) {
    return badRequest("Le validateur assigne n'est pas disponible pour ce tenant.");
  }

  if (message.includes("ESTIMATE_REVIEW_RULE_IDS_REQUIRED")) {
    return badRequest("Au moins une regle de validation est obligatoire.");
  }

  if (message.includes("ESTIMATE_REVIEW_RULES_INVALID")) {
    return badRequest("Une ou plusieurs regles de validation sont invalides.");
  }

  if (message.includes("ESTIMATE_REVIEW_SUBMISSION_MESSAGE_REQUIRED")) {
    return badRequest("Le message de soumission est obligatoire.");
  }

  if (message.includes("ESTIMATE_REVIEW_EVENT_METADATA_INVALID")) {
    return badRequest("Les metadonnees de soumission sont invalides.");
  }

  return mapSupabaseError(error, "Impossible d'ouvrir le cycle de revue.");
}

function assertResponseScope(input: {
  result: OpenEstimateReviewCycleResult;
  versionId: string;
  tenantId: string;
  actorUserId: string;
  assignedReviewerId: string;
  ruleIds: string[];
}) {
  const { cycle, approvals } = input.result;
  const returnedRuleIds = new Set(approvals.map((approval) => approval.rule_id));
  const expectedRuleIds = new Set(input.ruleIds);
  const scopeIsValid =
    cycle.version_id === input.versionId &&
    cycle.tenant_id === input.tenantId &&
    cycle.requested_by === input.actorUserId &&
    cycle.assigned_reviewer_id === input.assignedReviewerId &&
    cycle.decision === null &&
    cycle.superseded_at === null &&
    approvals.length === expectedRuleIds.size &&
    returnedRuleIds.size === expectedRuleIds.size &&
    [...expectedRuleIds].every((ruleId) => returnedRuleIds.has(ruleId)) &&
    approvals.every(
      (approval) =>
        approval.version_id === input.versionId &&
        approval.tenant_id === input.tenantId &&
        approval.requested_by === input.actorUserId &&
        approval.review_cycle_id === cycle.id &&
        approval.status === "pending" &&
        approval.superseded_at === null
    );

  if (!scopeIsValid) {
    throw internalError(
      "La base a retourne un cycle de revue incoherent.",
      undefined,
      "ESTIMATE_REVIEW_RPC_INVALID_RESPONSE"
    );
  }
}

/**
 * Ouvre ou remplace atomiquement le cycle actif et ses approbations. Le RPC
 * porte toute l'idempotence : aucun appelant ne doit reconstruire ce workflow
 * par des insertions de tables separees.
 */
export async function openEstimateReviewCycle(
  input: OpenEstimateReviewCycleInput
): Promise<OpenEstimateReviewCycleResult> {
  const versionId = normalizeUuid(input.versionId, "version_id");
  const tenantId = normalizeUuid(input.tenantId, "tenant_id");
  const actorUserId = normalizeUuid(input.actorUserId, "actor_user_id");
  const assignedReviewerId = normalizeUuid(
    input.assignedReviewerId,
    "assigned_reviewer_id"
  );
  const ruleIds = normalizeRuleIds(input.ruleIds);
  const submissionMessage = normalizeSubmissionMessage(input.submissionMessage);
  const eventMetadata = normalizeEventMetadata(input.eventMetadata);
  const client = createServiceRoleClient();
  const { data, error } = await client.rpc("open_estimate_review_cycle", {
    p_version_id: versionId,
    p_tenant_id: tenantId,
    p_actor_user_id: actorUserId,
    p_assigned_reviewer_id: assignedReviewerId,
    p_rule_ids: ruleIds,
    p_submission_message: submissionMessage,
    p_event_metadata: eventMetadata,
  });

  if (error) {
    throw mapReviewSubmissionError(error);
  }

  const parsed = reviewSubmissionSchema.safeParse(data);
  if (!parsed.success) {
    throw internalError(
      "La base a retourne une soumission de revue invalide.",
      undefined,
      "ESTIMATE_REVIEW_RPC_INVALID_RESPONSE"
    );
  }

  assertResponseScope({
    result: parsed.data,
    versionId,
    tenantId,
    actorUserId,
    assignedReviewerId,
    ruleIds,
  });
  return parsed.data;
}
