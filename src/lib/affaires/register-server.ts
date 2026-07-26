import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { computeEstimateItemNumbering } from "@/lib/estimates/numbering";
import {
  badRequest,
  forbidden,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "@/lib/estimates/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, Json } from "@/types/database";

import {
  AFFAIRE_REGISTER_KIND_LABELS,
  buildAffaireRegisterReviewExport,
  buildAffaireRegisterDerivedMetadata,
  buildAffaireRegisterBusinessLocation,
  buildAffaireRegisterContinuationHypothesisText,
  deriveAffaireRegisterBusinessImpact,
  affaireRegisterEventTypeSchema,
  extractAffaireRegisterClientClarificationRequest,
  extractAffaireRegisterBusinessImpact,
  extractAffaireRegisterFollowUp,
  affaireRegisterEntryKindSchema,
  affaireRegisterEntryOriginKindSchema,
  affaireRegisterRevalidationCauseSchema,
  affaireRegisterRevalidationImpactedStageSchema,
  extractAffaireRegisterSeverityDecision,
  affaireRegisterEntrySeveritySchema,
  affaireRegisterEntryStatusSchema,
  affaireRegisterScopeTypeSchema,
  extractAffaireRegisterContinuationDecision,
  extractAffaireRegisterRevalidationRequest,
  encodeAffaireRegisterCursor,
  isAffaireRegisterEntryRevalidationRequired,
  isAffaireRegisterEntryResolved,
  normalizeAffaireRegisterText,
  resolveAffaireRegisterBusinessLocation,
  type AffaireRegisterEntry,
  type AffaireRegisterClientClarificationRequest,
  type AffaireRegisterContinuationDecision,
  type AffaireRegisterEventType,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntryOriginKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterFollowUp,
  type AffaireRegisterOwnerOption,
  type AffaireRegisterPageResult,
  type AffaireRegisterReviewExport,
  type AffaireRegisterRevalidationRequest,
  type AffaireRegisterScopeOption,
  type AffaireRegisterScopeOptions,
  type AffaireRegisterScopeType,
  type AffaireRegisterSeverityDecision,
  type AffaireRegisterSummary,
  type AffaireRegisterTimelineEvent,
} from "./register";

type TenantRole = Database["public"]["Enums"]["tenant_role"];
type Supabase = SupabaseClient<Database>;

type AuthenticatedRegisterContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
};

type AffaireProjectAccessRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  reference: string | null;
  client_name: string | null;
  is_archived: boolean;
};

type AffaireRegisterEntryRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  version_id: string | null;
  source_document_id: string | null;
  kind: AffaireRegisterEntryKind;
  code: string | null;
  text: string;
  severity: AffaireRegisterEntrySeverity;
  status: AffaireRegisterEntryStatus;
  origin_kind: AffaireRegisterEntryOriginKind;
  scope_type: AffaireRegisterScopeType;
  scope_id: string | null;
  scope_ref: string | null;
  scope_label: string;
  source_file_name: string | null;
  sync_key: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type AffaireRegisterEntryWithProfilesRow = AffaireRegisterEntryRow & {
  created_by_profile: { full_name: string | null } | null;
  updated_by_profile: { full_name: string | null } | null;
};

type AffaireRegisterEventRow = {
  id: string;
  entry_id: string;
  actor_user_id: string | null;
  event_type: AffaireRegisterEventType;
  reason: string | null;
  before_payload: Json | null;
  after_payload: Json | null;
  created_at: string;
  actor_profile: { full_name: string | null } | null;
  entry: {
    kind: AffaireRegisterEntryKind;
    text: string;
    scope_label: string;
    project_id: string;
    version_id: string | null;
  } | null;
};

type EstimateItemScopeRow = {
  id: string;
  title: string | null;
  item_type: "section" | "line" | string;
  parent_id: string | null;
  position: number;
};

type AffaireRegisterGateEntry = {
  id: string;
  kind: AffaireRegisterEntryKind;
  code?: string | null;
  severity: AffaireRegisterEntrySeverity;
  status: AffaireRegisterEntryStatus;
  text: string;
  scopeType?: AffaireRegisterScopeType;
  scopeId?: string | null;
  scopeRef?: string | null;
  scopeLabel: string;
  versionId?: string | null;
  sourceDocumentId?: string | null;
  sourceFileName?: string | null;
  businessImpact?: ReturnType<typeof deriveAffaireRegisterBusinessImpact>;
  location?: ReturnType<typeof buildAffaireRegisterBusinessLocation>;
  severityDecision?: AffaireRegisterSeverityDecision | null;
  followUp?: AffaireRegisterFollowUp | null;
  clientClarificationRequest?: AffaireRegisterClientClarificationRequest | null;
  continuationDecision?: AffaireRegisterContinuationDecision | null;
  revalidationRequest?: AffaireRegisterRevalidationRequest | null;
};

export type AffaireRegisterGateSummary = {
  openQuestionsCount: number;
  criticalOpenEntries: AffaireRegisterGateEntry[];
  nonCriticalOpenEntries: AffaireRegisterGateEntry[];
  clarifyWithClientEntries: AffaireRegisterGateEntry[];
  criticalClarifyWithClientEntries?: AffaireRegisterGateEntry[];
  openAssumptionEntries: AffaireRegisterGateEntry[];
  openMissingPieceEntries: AffaireRegisterGateEntry[];
  continuedWithHypothesisEntries?: AffaireRegisterGateEntry[];
  continuedCriticalMissingPieceEntries?: AffaireRegisterGateEntry[];
  revalidationRequiredEntries?: AffaireRegisterGateEntry[];
  criticalRevalidationRequiredEntries?: AffaireRegisterGateEntry[];
  revalidationImpactedStages?: Array<
    z.infer<typeof affaireRegisterRevalidationImpactedStageSchema>
  >;
};

type ListAffaireRegisterPageInput = {
  projectId: string;
  versionId?: string | null;
  status?: AffaireRegisterEntryStatus | null;
  severity?: AffaireRegisterEntrySeverity | null;
  kind?: AffaireRegisterEntryKind | null;
  revalidationRequired?: boolean;
  cursor?: {
    id: string;
    updatedAt: string;
  } | null;
  focusEntryId?: string | null;
  size?: number;
};

const PROJECT_SELECT =
  "id, tenant_id, user_id, name, reference, client_name, is_archived";
const ENTRY_SELECT = [
  "id",
  "tenant_id",
  "project_id",
  "version_id",
  "source_document_id",
  "kind",
  "code",
  "text",
  "severity",
  "status",
  "origin_kind",
  "scope_type",
  "scope_id",
  "scope_ref",
  "scope_label",
  "source_file_name",
  "sync_key",
  "is_active",
  "metadata",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at",
  "created_by_profile:created_by(full_name)",
  "updated_by_profile:updated_by(full_name)",
].join(", ");
const EVENT_SELECT = [
  "id",
  "entry_id",
  "actor_user_id",
  "event_type",
  "reason",
  "before_payload",
  "after_payload",
  "created_at",
  "actor_profile:actor_user_id(full_name)",
  "entry:affaire_register_entries!inner(project_id, version_id, kind, text, scope_label)",
].join(", ");
const GATE_ENTRY_SELECT = [
  "id",
  "kind",
  "code",
  "text",
  "severity",
  "status",
  "scope_type",
  "scope_id",
  "scope_ref",
  "scope_label",
  "version_id",
  "source_document_id",
  "source_file_name",
  "is_active",
  "metadata",
].join(", ");
const PAGE_SIZE_DEFAULT = 8;
const PAGE_SIZE_MAX = 25;

const createAffaireRegisterEntryInputSchema = z
  .object({
    projectId: z.string().uuid("projectId invalide."),
    versionId: z.string().uuid("versionId invalide.").nullable().optional(),
    kind: affaireRegisterEntryKindSchema,
    text: z.string().trim().min(1, "Le texte est requis.").max(320),
    severity: affaireRegisterEntrySeveritySchema,
    scopeType: affaireRegisterScopeTypeSchema,
    scopeId: z.string().uuid("scopeId invalide.").nullable().optional(),
    scopeRef: z.string().trim().max(120).nullable().optional(),
    scopeLabel: z.string().trim().max(180).nullable().optional(),
    sourceDocumentId: z.string().uuid("sourceDocumentId invalide.").nullable().optional(),
    sourceFileName: z.string().trim().max(255).nullable().optional(),
    code: z.string().trim().max(120).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.scopeType === "lot" || value.scopeType === "line") && !value.scopeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopeId"],
        message: "Le scope selectionne est requis.",
      });
    }

    if (value.scopeType === "exception") {
      if (!value.versionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["versionId"],
          message: "Une version courante est requise pour une exception.",
        });
      }
      if (!value.scopeRef || value.scopeRef.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scopeRef"],
          message: "La reference d'exception est requise.",
        });
      }
      if (!value.scopeLabel || value.scopeLabel.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scopeLabel"],
          message: "Le libelle d'exception est requis.",
        });
      }
    }
  });

const updateAffaireRegisterEntryStatusInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  entryId: z.string().uuid("entryId invalide."),
  status: affaireRegisterEntryStatusSchema,
  comment: z.string().trim().max(320).nullable().optional(),
});

const updateAffaireRegisterEntryFollowUpInputSchema = z
  .object({
    projectId: z.string().uuid("projectId invalide."),
    entryId: z.string().uuid("entryId invalide."),
    severity: affaireRegisterEntrySeveritySchema.nullable().optional(),
    ownerUserId: z.string().uuid("ownerUserId invalide.").nullable().optional(),
    dueDate: z.string().date("dueDate invalide.").nullable().optional(),
    comment: z.string().trim().max(320).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.severity === undefined &&
      value.ownerUserId === undefined &&
      value.dueDate === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Au moins une mise à jour de sévérité, responsable ou échéance est requise.",
      });
    }
  });

const requestAffaireRegisterRevalidationInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  entryId: z.string().uuid("entryId invalide."),
  cause: affaireRegisterRevalidationCauseSchema,
  impactedStages: z
    .array(affaireRegisterRevalidationImpactedStageSchema)
    .min(1, "Au moins une etape impactee est requise.")
    .max(5),
  triggerDocumentId: z.string().uuid("triggerDocumentId invalide.").nullable().optional(),
  triggerFileName: z.string().trim().max(255).nullable().optional(),
  comment: z.string().trim().max(320).nullable().optional(),
});

const continueAffaireRegisterWithHypothesisInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  entryId: z.string().uuid("entryId invalide."),
  comment: z.string().trim().max(320).nullable().optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeTenantRole(value: unknown): TenantRole | null {
  return value === "admin" || value === "director" || value === "engineer" || value === "viewer"
    ? value
    : null;
}

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function normalizeAffaireProject(row: unknown): AffaireProjectAccessRow | null {
  if (!isRecord(row)) {
    return null;
  }

  if (
    typeof row.id !== "string" ||
    typeof row.tenant_id !== "string" ||
    typeof row.user_id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.is_archived !== "boolean"
  ) {
    return null;
  }

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    name: row.name,
    reference: toStringOrNull(row.reference),
    client_name: toStringOrNull(row.client_name),
    is_archived: row.is_archived,
  };
}

function normalizeAffaireRegisterEntryRow(
  row: unknown
): AffaireRegisterEntryWithProfilesRow | null {
  if (!isRecord(row)) {
    return null;
  }

  const kind = affaireRegisterEntryKindSchema.safeParse(row.kind);
  const severity = affaireRegisterEntrySeveritySchema.safeParse(row.severity);
  const status = affaireRegisterEntryStatusSchema.safeParse(row.status);
  const originKind = affaireRegisterEntryOriginKindSchema.safeParse(row.origin_kind);
  const scopeType = affaireRegisterScopeTypeSchema.safeParse(row.scope_type);

  if (
    !kind.success ||
    !severity.success ||
    !status.success ||
    !originKind.success ||
    !scopeType.success ||
    typeof row.id !== "string" ||
    typeof row.project_id !== "string" ||
    typeof row.scope_label !== "string" ||
    typeof row.text !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : "",
    project_id: row.project_id,
    version_id: toStringOrNull(row.version_id),
    source_document_id: toStringOrNull(row.source_document_id),
    kind: kind.data,
    code: toStringOrNull(row.code),
    text: row.text.trim(),
    severity: severity.data,
    status: status.data,
    origin_kind: originKind.data,
    scope_type: scopeType.data,
    scope_id: toStringOrNull(row.scope_id),
    scope_ref: toStringOrNull(row.scope_ref),
    scope_label: row.scope_label.trim(),
    source_file_name: toStringOrNull(row.source_file_name),
    sync_key: toStringOrNull(row.sync_key),
    is_active: row.is_active !== false,
    metadata: isRecord(row.metadata) ? row.metadata : {},
    created_by: toStringOrNull(row.created_by),
    updated_by: toStringOrNull(row.updated_by),
    created_at: toStringOrNull(row.created_at) ?? new Date(0).toISOString(),
    updated_at: toStringOrNull(row.updated_at) ?? new Date(0).toISOString(),
    created_by_profile: resolveEmbeddedOne(
      row.created_by_profile as
        | { full_name: string | null }
        | Array<{ full_name: string | null }>
        | null
    ),
    updated_by_profile: resolveEmbeddedOne(
      row.updated_by_profile as
        | { full_name: string | null }
        | Array<{ full_name: string | null }>
        | null
    ),
  };
}

function toAffaireRegisterEntry(
  row: AffaireRegisterEntryWithProfilesRow
): AffaireRegisterEntry {
  const clientClarificationRequest = extractAffaireRegisterClientClarificationRequest(
    row.metadata
  );
  const continuationDecision = extractAffaireRegisterContinuationDecision(
    row.metadata
  );
  const revalidationRequest = extractAffaireRegisterRevalidationRequest(row.metadata);
  const derivedBusinessImpact = deriveAffaireRegisterBusinessImpact({
    kind: row.kind,
    code: row.code,
    severity: row.severity,
    status: row.status,
    clientClarificationRequest,
    continuationDecision,
    revalidationRequest,
  });
  const location = resolveAffaireRegisterBusinessLocation({
    metadata: row.metadata,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeRef: row.scope_ref,
    scopeLabel: row.scope_label,
    versionId: row.version_id,
    sourceDocumentId: row.source_document_id,
    sourceFileName: row.source_file_name,
  });
  const severityDecision = extractAffaireRegisterSeverityDecision(row.metadata);
  const followUp = extractAffaireRegisterFollowUp(row.metadata);

  return {
    id: row.id,
    kind: row.kind,
    code: row.code,
    text: row.text,
    severity: row.severity,
    status: row.status,
    originKind: row.origin_kind,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeRef: row.scope_ref,
    scopeLabel: row.scope_label,
    versionId: row.version_id,
    sourceDocumentId: row.source_document_id,
    sourceFileName: row.source_file_name,
    createdBy: row.created_by,
    createdByName: row.created_by_profile?.full_name?.trim() || null,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_profile?.full_name?.trim() || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    businessImpact:
      extractAffaireRegisterBusinessImpact(row.metadata) ?? derivedBusinessImpact,
    location,
    severityDecision,
    followUp,
    clientClarificationRequest,
    continuationDecision,
    revalidationRequest,
    history: [],
  };
}

function buildCanonicalSeverityDecision(input: {
  severity: AffaireRegisterEntrySeverity;
  existing?: AffaireRegisterSeverityDecision | null;
  updatedAt?: string;
  updatedByUserId?: string | null;
  comment?: string | null;
}) {
  if (input.existing?.mode === "manual" && input.existing.overriddenSeverity) {
    return {
      ...input.existing,
      canonicalSeverity: input.severity,
    } satisfies AffaireRegisterSeverityDecision;
  }

  return {
    mode: "canonical",
    canonicalSeverity: input.severity,
    overriddenSeverity: null,
    updatedAt:
      input.existing?.updatedAt ??
      input.updatedAt ??
      new Date().toISOString(),
    updatedByUserId: input.existing?.updatedByUserId ?? input.updatedByUserId ?? null,
    comment: input.existing?.comment ?? input.comment ?? null,
  } satisfies AffaireRegisterSeverityDecision;
}

function resolveEffectiveSeverityFromDecision(input: {
  severity: AffaireRegisterEntrySeverity;
  metadata: Record<string, unknown>;
  updatedAt?: string;
  updatedByUserId?: string | null;
  comment?: string | null;
}) {
  const decision = buildCanonicalSeverityDecision({
    severity: input.severity,
    existing: extractAffaireRegisterSeverityDecision(input.metadata),
    updatedAt: input.updatedAt,
    updatedByUserId: input.updatedByUserId,
    comment: input.comment,
  });

  return {
    severity:
      decision.mode === "manual" && decision.overriddenSeverity
        ? decision.overriddenSeverity
        : input.severity,
    decision,
  };
}

function clearAffaireRegisterWorkflowMetadata(metadata: Record<string, unknown>) {
  const nextMetadata = { ...metadata };

  delete nextMetadata.clientClarificationRequest;
  delete nextMetadata.continuationDecision;
  delete nextMetadata.continuationSource;
  delete nextMetadata.revalidationRequest;

  return nextMetadata;
}

function readContinuationSourceEntryId(metadata: Record<string, unknown>) {
  const source = metadata.continuationSource;
  if (
    typeof source !== "object" ||
    source === null ||
    Array.isArray(source) ||
    typeof (source as Record<string, unknown>).entryId !== "string"
  ) {
    return null;
  }

  return (source as Record<string, unknown>).entryId;
}

function dedupeRevalidationImpactedStages(
  stages: Array<z.infer<typeof affaireRegisterRevalidationImpactedStageSchema>>
) {
  return Array.from(new Set(stages));
}

function extractRegisterEventStatus(
  payload: Json | null | undefined
): AffaireRegisterEntryStatus | null {
  if (!isRecord(payload)) {
    return null;
  }

  const parsed = affaireRegisterEntryStatusSchema.safeParse(payload.status);
  return parsed.success ? parsed.data : null;
}

function extractRegisterEventComment(payload: Json | null | undefined) {
  if (!isRecord(payload)) {
    return null;
  }

  return toStringOrNull(payload.comment);
}

function normalizeRegisterEventReason(reason: string | null) {
  if (!reason) {
    return null;
  }

  const normalized = reason.trim();

  if (!normalized) {
    return null;
  }

  if (/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeAffaireRegisterEventRow(row: unknown): AffaireRegisterEventRow | null {
  if (!isRecord(row)) {
    return null;
  }

  const eventType = affaireRegisterEventTypeSchema.safeParse(row.event_type);
  const entry = resolveEmbeddedOne(
    row.entry as
      | {
          kind: AffaireRegisterEntryKind;
          text: string;
          scope_label: string;
          project_id: string;
          version_id: string | null;
        }
      | Array<{
          kind: AffaireRegisterEntryKind;
          text: string;
          scope_label: string;
          project_id: string;
          version_id: string | null;
        }>
      | null
  );
  const actorProfile = resolveEmbeddedOne(
    row.actor_profile as
      | { full_name: string | null }
      | Array<{ full_name: string | null }>
      | null
  );

  const kind = affaireRegisterEntryKindSchema.safeParse(entry?.kind);

  if (
    !eventType.success ||
    !entry ||
    !kind.success ||
    typeof row.id !== "string" ||
    typeof row.entry_id !== "string" ||
    typeof entry.text !== "string" ||
    typeof entry.scope_label !== "string" ||
    typeof entry.project_id !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    entry_id: row.entry_id,
    actor_user_id: toStringOrNull(row.actor_user_id),
    event_type: eventType.data,
    reason: toStringOrNull(row.reason),
    before_payload: row.before_payload as Json | null,
    after_payload: row.after_payload as Json | null,
    created_at: toStringOrNull(row.created_at) ?? new Date(0).toISOString(),
    actor_profile: actorProfile,
    entry: {
      kind: kind.data,
      text: entry.text.trim(),
      scope_label: entry.scope_label.trim(),
      project_id: entry.project_id,
      version_id: toStringOrNull(entry.version_id),
    },
  };
}

function toAffaireRegisterTimelineEvent(
  row: AffaireRegisterEventRow
): AffaireRegisterTimelineEvent {
  return {
    id: row.id,
    entryId: row.entry_id,
    eventType: row.event_type,
    entryKind: row.entry?.kind ?? "assumption",
    entryText: row.entry?.text ?? "",
    scopeLabel: row.entry?.scope_label ?? "Affaire",
    actorUserId: row.actor_user_id,
    actorUserName: row.actor_profile?.full_name?.trim() || null,
    comment:
      extractRegisterEventComment(row.after_payload) ??
      extractRegisterEventComment(row.before_payload) ??
      normalizeRegisterEventReason(row.reason),
    beforeStatus: extractRegisterEventStatus(row.before_payload),
    afterStatus: extractRegisterEventStatus(row.after_payload),
    createdAt: row.created_at,
  };
}

function normalizeEstimateItemScopeRow(row: unknown): EstimateItemScopeRow | null {
  if (!isRecord(row)) {
    return null;
  }

  if (typeof row.id !== "string" || typeof row.position !== "number") {
    return null;
  }

  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : null,
    item_type: typeof row.item_type === "string" ? row.item_type : "line",
    parent_id: toStringOrNull(row.parent_id),
    position: row.position,
  };
}

async function getAuthenticatedRegisterContext(): Promise<AuthenticatedRegisterContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw mapSupabaseError(membershipError, "Impossible de charger le tenant courant.");
  }

  const membership = Array.isArray(memberships) ? memberships[0] : null;
  const tenantRole = normalizeTenantRole((membership as { role?: unknown } | null)?.role);

  if (!membership || typeof membership.tenant_id !== "string" || !tenantRole) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    tenantRole,
  };
}

async function requireAffaireRegisterProjectAccess(
  projectId: string,
  mode: "reader" | "editor"
) {
  const context = await getAuthenticatedRegisterContext();
  const { data, error } = await context.supabase
    .from("estimate_projects")
    .select(PROJECT_SELECT)
    .eq("id", projectId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'affaire.");
  }

  const project = normalizeAffaireProject(data);
  if (!project || project.is_archived) {
    throw notFound("Affaire introuvable.");
  }

  const isOwner = project.user_id === context.userId;
  const isAdmin = context.tenantRole === "admin";
  const isDirector = context.tenantRole === "director";
  const hasAccess =
    mode === "reader" ? isOwner || isAdmin || isDirector : isOwner || isAdmin;

  if (!hasAccess) {
    throw forbidden("Acces refuse a ce registre affaire.");
  }

  return {
    context,
    project,
  };
}

async function listAssignableRegisterOwners(input: {
  supabase: Supabase;
  tenantId: string;
}) {
  const { data: memberships, error: membershipsError } = await input.supabase
    .from("tenant_memberships")
    .select("user_id, role")
    .eq("tenant_id", input.tenantId)
    .in("role", ["admin", "director", "engineer"]);

  if (membershipsError) {
    throw mapSupabaseError(
      membershipsError,
      "Impossible de charger les responsables du registre."
    );
  }

  const membershipRows = (memberships ?? []) as Array<{
    user_id: string;
    role: TenantRole;
  }>;
  const userIds = Array.from(new Set(membershipRows.map((row) => row.user_id)));

  if (userIds.length === 0) {
    return [] as AffaireRegisterOwnerOption[];
  }

  const { data: profiles, error: profilesError } = await input.supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", userIds);

  if (profilesError) {
    throw mapSupabaseError(
      profilesError,
      "Impossible de charger les profils responsables du registre."
    );
  }

  const profileById = new Map(
    ((profiles ?? []) as Array<{ id: string; full_name: string | null }>).map(
      (profile) => [profile.id, profile.full_name?.trim() || null]
    )
  );

  return membershipRows
    .map((membership) => ({
      userId: membership.user_id,
      label: profileById.get(membership.user_id) ?? "Responsable inconnu",
      role: membership.role as "admin" | "director" | "engineer",
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "fr-FR"));
}

async function resolveAffaireRegisterOwnerOption(input: {
  supabase: Supabase;
  tenantId: string;
  ownerUserId: string;
}) {
  const options = await listAssignableRegisterOwners(input);
  return options.find((option) => option.userId === input.ownerUserId) ?? null;
}

function applyVersionScopeFilter<T extends {
  or: (filters: string) => unknown;
}>(query: T, versionId: string | null | undefined): T {
  if (!versionId) {
    return query;
  }

  query.or(`version_id.is.null,version_id.eq.${versionId}`);
  return query;
}

function applyCursorFilter<T extends {
  or: (filters: string) => unknown;
}>(query: T, cursor: { updatedAt: string; id: string } | null | undefined): T {
  if (!cursor) {
    return query;
  }

  query.or(
    `updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`
  );
  return query;
}

async function insertAffaireRegisterEvent(input: {
  supabase: Supabase;
  entryId: string;
  actorUserId?: string | null;
  eventType:
    | "created"
    | "synced"
    | "status_changed"
    | "follow_up_updated"
    | "clarify_with_client_requested"
    | "continued_with_hypothesis"
    | "revalidation_requested"
    | "deactivated"
    | "reactivated";
  reason?: string | null;
  beforePayload?: Json | null;
  afterPayload?: Json | null;
}) {
  const { error } = await input.supabase.from("affaire_register_events" as never).insert({
    entry_id: input.entryId,
    actor_user_id: input.actorUserId ?? null,
    event_type: input.eventType,
    reason: input.reason ?? null,
    before_payload: input.beforePayload ?? null,
    after_payload: input.afterPayload ?? null,
  } as never);

  if (error) {
    throw mapSupabaseError(error, "Impossible d'historiser l'action du registre.");
  }
}

async function updateAffaireRegisterEntryWithEvent(input: {
  supabase: Supabase;
  entryId: string;
  actorUserId: string | null;
  patch: Record<string, Json>;
  eventType: Exclude<AffaireRegisterEventType, "created">;
  reason?: string | null;
  beforePayload?: Json | null;
  afterPayload?: Json | null;
  fallbackMessage: string;
}) {
  const { data, error } = await createServiceRoleClient().rpc(
    "update_affaire_register_entry_with_event" as never,
    {
      p_entry_id: input.entryId,
      p_patch: input.patch,
      p_event_type: input.eventType,
      p_reason: input.reason ?? null,
      p_before_payload: input.beforePayload ?? null,
      p_after_payload: input.afterPayload ?? null,
      p_actor_user_id: input.actorUserId,
    } as never
  );

  if (error) {
    throw mapSupabaseError(error, input.fallbackMessage);
  }

  const updatedEntry = normalizeAffaireRegisterEntryRow(data);
  if (!updatedEntry) {
    throw badRequest("Reponse invalide lors de la mise a jour du registre.");
  }

  return updatedEntry;
}

function toSyncKey(prefix: "assumption" | "missing_piece", value: string) {
  return `${prefix}:${normalizeAffaireRegisterText(value, 240).toLowerCase()}`;
}

function buildExistingComparableProjection(row: AffaireRegisterEntryRow) {
  return JSON.stringify({
    version_id: row.version_id,
    source_document_id: row.source_document_id,
    kind: row.kind,
    code: row.code,
    text: row.text,
    severity: row.severity,
    status: row.status,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    scope_ref: row.scope_ref,
    scope_label: row.scope_label,
    source_file_name: row.source_file_name,
    sync_key: row.sync_key,
    is_active: row.is_active,
  });
}

async function listExistingRegisterEntriesBySyncKey(input: {
  supabase: Supabase;
  projectId: string;
  syncKeys: string[];
}) {
  if (input.syncKeys.length === 0) {
    return new Map<string, AffaireRegisterEntryRow>();
  }

  const { data, error } = await input.supabase
    .from("affaire_register_entries" as never)
    .select(
      "id, tenant_id, project_id, version_id, source_document_id, kind, code, text, severity, status, origin_kind, scope_type, scope_id, scope_ref, scope_label, source_file_name, sync_key, is_active, metadata, created_by, updated_by, created_at, updated_at" as never
    )
    .eq("project_id", input.projectId)
    .in("sync_key", input.syncKeys);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le registre affaire.");
  }

  return new Map(
    ((data ?? []) as unknown[])
      .map((row) => normalizeAffaireRegisterEntryRow(row))
      .filter((row): row is AffaireRegisterEntryWithProfilesRow => row !== null)
      .map((row) => [row.sync_key!, row])
  );
}

async function deactivateMissingSyncEntries(input: {
  supabase: Supabase;
  projectId: string;
  originKind: AffaireRegisterEntryOriginKind;
  existingSyncKeys: string[];
  activeSyncKeys: Set<string>;
  actorUserId?: string | null;
  reason: string;
}) {
  if (input.existingSyncKeys.length === 0) {
    return;
  }

  const staleSyncKeys = input.existingSyncKeys.filter(
    (syncKey) => !input.activeSyncKeys.has(syncKey)
  );
  if (staleSyncKeys.length === 0) {
    return;
  }

  const { data, error } = await input.supabase
    .from("affaire_register_entries" as never)
    .select(
      "id, tenant_id, project_id, version_id, source_document_id, kind, code, text, severity, status, origin_kind, scope_type, scope_id, scope_ref, scope_label, source_file_name, sync_key, is_active, metadata, created_by, updated_by, created_at, updated_at" as never
    )
    .eq("project_id", input.projectId)
    .eq("origin_kind", input.originKind)
    .eq("is_active", true)
    .in("sync_key", staleSyncKeys);

  if (error) {
    throw mapSupabaseError(error, "Impossible de desactiver le registre sync.");
  }

  const rows = ((data ?? []) as unknown[])
    .map((row) => normalizeAffaireRegisterEntryRow(row))
    .filter((row): row is AffaireRegisterEntryWithProfilesRow => row !== null);

  for (const row of rows) {
    const nextStatus =
      input.originKind === "system" && row.status !== "validated"
        ? "validated"
        : row.status;
    await updateAffaireRegisterEntryWithEvent({
      supabase: input.supabase,
      entryId: row.id,
      actorUserId: input.actorUserId ?? null,
      patch: {
        status: nextStatus,
        is_active: false,
      },
      eventType: "deactivated",
      reason: input.reason,
      beforePayload: {
        status: row.status,
        is_active: true,
      } satisfies Json,
      afterPayload: {
        status: nextStatus,
        is_active: false,
      } satisfies Json,
      fallbackMessage: "Impossible de desactiver une entree du registre.",
    });
  }
}

async function upsertSyncedEntries(input: {
  supabase: Supabase;
  project: AffaireProjectAccessRow;
  rows: Array<{
    versionId?: string | null;
    sourceDocumentId?: string | null;
    kind: AffaireRegisterEntryKind;
    code?: string | null;
    text: string;
    severity: AffaireRegisterEntrySeverity;
    scopeType: AffaireRegisterScopeType;
    scopeId?: string | null;
    scopeRef?: string | null;
    scopeLabel: string;
    sourceFileName?: string | null;
    syncKey: string;
    originKind: AffaireRegisterEntryOriginKind;
  }>;
  actorUserId?: string | null;
  reason: string;
  deactivateMissing?: boolean;
}) {
  const syncKeys = input.rows.map((row) => row.syncKey);
  const existingBySyncKey = await listExistingRegisterEntriesBySyncKey({
    supabase: input.supabase,
    projectId: input.project.id,
    syncKeys,
  });
  const activeSyncKeys = new Set(syncKeys);

  if (input.rows.length > 0) {
    const payload = input.rows.map((row) => {
      const existing = existingBySyncKey.get(row.syncKey);
      const nextStatus: AffaireRegisterEntryStatus =
        existing && existing.is_active ? existing.status : "open";
      const baseMetadata =
        existing && !existing.is_active
          ? clearAffaireRegisterWorkflowMetadata(existing.metadata)
          : existing?.metadata ?? {};
      const severityResolution = resolveEffectiveSeverityFromDecision({
        severity: row.severity,
        metadata: baseMetadata,
        updatedAt: existing?.updated_at ?? new Date().toISOString(),
        updatedByUserId: existing?.updated_by ?? input.actorUserId ?? null,
      });

      return {
        project_id: input.project.id,
        version_id: row.versionId ?? null,
        source_document_id: row.sourceDocumentId ?? null,
        kind: row.kind,
        code: row.code ?? null,
        text: row.text,
        severity: severityResolution.severity,
        status: nextStatus,
        origin_kind: row.originKind,
        scope_type: row.scopeType,
        scope_id: row.scopeId ?? null,
        scope_ref: row.scopeRef ?? null,
        scope_label: row.scopeLabel,
        source_file_name: row.sourceFileName ?? null,
        sync_key: row.syncKey,
        is_active: true,
        metadata: buildAffaireRegisterDerivedMetadata({
          metadata: {
            ...baseMetadata,
            severityDecision: severityResolution.decision,
          },
          kind: row.kind,
          code: row.code ?? null,
          severity: severityResolution.severity,
          status: nextStatus,
          scopeType: row.scopeType,
          scopeId: row.scopeId ?? null,
          scopeRef: row.scopeRef ?? null,
          scopeLabel: row.scopeLabel,
          versionId: row.versionId ?? null,
          sourceDocumentId: row.sourceDocumentId ?? null,
          sourceFileName: row.sourceFileName ?? null,
          clientClarificationRequest:
            existing && existing.is_active
              ? extractAffaireRegisterClientClarificationRequest(existing.metadata)
              : null,
          continuationDecision:
            existing && existing.is_active
              ? extractAffaireRegisterContinuationDecision(existing.metadata)
              : null,
          revalidationRequest:
            existing && existing.is_active
              ? extractAffaireRegisterRevalidationRequest(existing.metadata)
              : null,
        }),
        created_by: existing?.created_by ?? input.actorUserId ?? null,
        updated_by: input.actorUserId ?? null,
      };
    });

    const newPayload = payload.filter(
      (row) => !existingBySyncKey.has(row.sync_key)
    );
    if (newPayload.length > 0) {
      const { data, error } = await input.supabase
        .from("affaire_register_entries" as never)
        .insert(newPayload as never)
        .select(
          "id, tenant_id, project_id, version_id, source_document_id, kind, code, text, severity, status, origin_kind, scope_type, scope_id, scope_ref, scope_label, source_file_name, sync_key, is_active, metadata, created_by, updated_by, created_at, updated_at" as never
        );

      if (error) {
        throw mapSupabaseError(error, "Impossible de synchroniser le registre affaire.");
      }

      const insertedRows = ((data ?? []) as unknown[])
        .map((row) => normalizeAffaireRegisterEntryRow(row))
        .filter((row): row is AffaireRegisterEntryWithProfilesRow => row !== null);

      for (const row of insertedRows) {
        await insertAffaireRegisterEvent({
          supabase: input.supabase,
          entryId: row.id,
          actorUserId: input.actorUserId ?? null,
          eventType: "created",
          reason: input.reason,
          afterPayload: {
            kind: row.kind,
            severity: row.severity,
            status: row.status,
          } satisfies Json,
        });
      }
    }

    for (const row of payload) {
      const existing = existingBySyncKey.get(row.sync_key);
      if (!existing) {
        continue;
      }

      const nextProjection = JSON.stringify({
        version_id: row.version_id,
        source_document_id: row.source_document_id,
        kind: row.kind,
        code: row.code,
        text: row.text,
        severity: row.severity,
        status: row.status,
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        scope_ref: row.scope_ref,
        scope_label: row.scope_label,
        source_file_name: row.source_file_name,
        sync_key: row.sync_key,
        is_active: row.is_active,
      });
      if (
        existing.is_active &&
        buildExistingComparableProjection(existing) === nextProjection
      ) {
        continue;
      }

      await updateAffaireRegisterEntryWithEvent({
        supabase: input.supabase,
        entryId: existing.id,
        actorUserId: input.actorUserId ?? null,
        patch: {
          version_id: row.version_id,
          source_document_id: row.source_document_id,
          kind: row.kind,
          code: row.code,
          text: row.text,
          severity: row.severity,
          status: row.status,
          origin_kind: row.origin_kind,
          scope_type: row.scope_type,
          scope_id: row.scope_id,
          scope_ref: row.scope_ref,
          scope_label: row.scope_label,
          source_file_name: row.source_file_name,
          sync_key: row.sync_key,
          is_active: row.is_active,
          metadata: row.metadata as Json,
        },
        eventType: existing.is_active ? "synced" : "reactivated",
        reason: input.reason,
        beforePayload: existing.is_active
          ? ({
              status: existing.status,
              severity: existing.severity,
              text: existing.text,
            } satisfies Json)
          : ({
              status: existing.status,
              is_active: false,
            } satisfies Json),
        afterPayload: existing.is_active
          ? ({
              status: row.status,
              severity: row.severity,
              text: row.text,
            } satisfies Json)
          : ({
              status: row.status,
              is_active: true,
            } satisfies Json),
        fallbackMessage: "Impossible de synchroniser le registre affaire.",
      });
    }
  }

  if (input.deactivateMissing !== false) {
    await deactivateMissingSyncEntries({
      supabase: input.supabase,
      projectId: input.project.id,
      originKind: input.rows[0]?.originKind ?? "system",
      existingSyncKeys: Array.from(existingBySyncKey.keys()),
      activeSyncKeys,
      actorUserId: input.actorUserId ?? null,
      reason: input.reason,
    });
  }
}

export async function syncAffaireRegisterFromBrief(input: {
  supabase: Supabase;
  project: AffaireProjectAccessRow;
  assumptions: string[];
  sources: Array<{
    blockKey: string;
    entryIndex: number;
    sourceDocumentId: string;
    sourceFileName: string;
  }>;
  actorUserId?: string | null;
}) {
  const rows = input.assumptions.map((text, index) => {
    const relatedSources = input.sources.filter(
      (source) => source.blockKey === "assumptions" && source.entryIndex === index
    );
    const firstSource = relatedSources[0] ?? null;

    return {
      kind: "assumption" as const,
      text,
      severity: "warning" as const,
      scopeType: "project" as const,
      scopeLabel: input.project.name,
      sourceDocumentId: firstSource?.sourceDocumentId ?? null,
      sourceFileName: firstSource?.sourceFileName ?? null,
      syncKey: toSyncKey("assumption", text),
      originKind: "ai" as const,
    };
  });

  await upsertSyncedEntries({
    supabase: input.supabase,
    project: input.project,
    rows,
    actorUserId: input.actorUserId ?? null,
    reason: "brief.assumptions_sync",
    deactivateMissing: false,
  });
}

export async function syncAffaireRegisterMissingPieces(input: {
  supabase: Supabase;
  project: AffaireProjectAccessRow;
  missingPieces: Array<{
    code: string;
    label: string;
    severity: AffaireRegisterEntrySeverity;
  }>;
  actorUserId?: string | null;
}) {
  const rows = input.missingPieces.map((piece) => ({
    kind: "missing_piece" as const,
    code: piece.code,
    text: piece.label,
    severity: piece.severity,
    scopeType: "project" as const,
    scopeLabel: input.project.name,
    syncKey: toSyncKey("missing_piece", piece.code),
    originKind: "system" as const,
  }));

  await upsertSyncedEntries({
    supabase: input.supabase,
    project: input.project,
    rows,
    actorUserId: input.actorUserId ?? null,
    reason: "intake.missing_pieces_sync",
  });
}

export async function fetchAffaireRegisterGateSummary(input: {
  supabase: Supabase;
  projectId: string;
  versionId?: string | null;
}): Promise<AffaireRegisterGateSummary> {
  let query = input.supabase
    .from("affaire_register_entries" as never)
    .select(GATE_ENTRY_SELECT as never)
    .eq("project_id", input.projectId as never)
    .eq("is_active", true as never);

  query = applyVersionScopeFilter(query as never, input.versionId ?? null) as never;

  const { data, error } = await query.order("updated_at", { ascending: false });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la synthese du registre affaire.");
  }

  const normalized = ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      kind: affaireRegisterEntryKindSchema.parse(row.kind),
      code: typeof row.code === "string" ? row.code.trim() || null : null,
      text: typeof row.text === "string" ? row.text.trim() : "",
      severity: affaireRegisterEntrySeveritySchema.parse(row.severity),
      status: affaireRegisterEntryStatusSchema.parse(row.status),
      scopeType: affaireRegisterScopeTypeSchema.parse(row.scope_type),
      scopeId: typeof row.scope_id === "string" ? row.scope_id : null,
      scopeRef: typeof row.scope_ref === "string" ? row.scope_ref.trim() || null : null,
      scopeLabel:
        typeof row.scope_label === "string" && row.scope_label.trim().length > 0
          ? row.scope_label.trim()
          : "Affaire",
      versionId: typeof row.version_id === "string" ? row.version_id : null,
      sourceDocumentId:
        typeof row.source_document_id === "string" ? row.source_document_id : null,
      sourceFileName:
        typeof row.source_file_name === "string"
          ? row.source_file_name.trim() || null
          : null,
      clientClarificationRequest: isRecord(row.metadata)
        ? extractAffaireRegisterClientClarificationRequest(row.metadata)
        : null,
      continuationDecision: isRecord(row.metadata)
        ? extractAffaireRegisterContinuationDecision(row.metadata)
        : null,
      revalidationRequest: isRecord(row.metadata)
        ? extractAffaireRegisterRevalidationRequest(row.metadata)
        : null,
      get businessImpact() {
        return isRecord(row.metadata)
          ? extractAffaireRegisterBusinessImpact(row.metadata) ??
              deriveAffaireRegisterBusinessImpact({
                kind: this.kind,
                code: this.code ?? null,
                severity: this.severity,
                status: this.status,
                clientClarificationRequest: this.clientClarificationRequest,
                continuationDecision: this.continuationDecision,
                revalidationRequest: this.revalidationRequest,
              })
          : deriveAffaireRegisterBusinessImpact({
              kind: this.kind,
              code: this.code ?? null,
              severity: this.severity,
              status: this.status,
              clientClarificationRequest: this.clientClarificationRequest,
              continuationDecision: this.continuationDecision,
              revalidationRequest: this.revalidationRequest,
            });
      },
      get severityDecision() {
        return isRecord(row.metadata)
          ? extractAffaireRegisterSeverityDecision(row.metadata)
          : null;
      },
      get followUp() {
        return isRecord(row.metadata)
          ? extractAffaireRegisterFollowUp(row.metadata)
          : null;
      },
      get location() {
        return resolveAffaireRegisterBusinessLocation({
          metadata: row.metadata,
          scopeType: this.scopeType ?? "project",
          scopeId: this.scopeId ?? null,
          scopeRef: this.scopeRef ?? null,
          scopeLabel: this.scopeLabel,
          versionId: this.versionId ?? null,
          sourceDocumentId: this.sourceDocumentId ?? null,
          sourceFileName: this.sourceFileName ?? null,
        });
      },
    }))
    .filter((row) => row.id.length > 0 && row.text.length > 0);
  const standardWorkflowEntries = normalized.filter(
    (entry) => !isAffaireRegisterEntryRevalidationRequired(entry)
  );

  const criticalOpenEntries = standardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.severity === "critical"
  );
  const nonCriticalOpenEntries = standardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.severity !== "critical"
  );
  const clarifyWithClientEntries = standardWorkflowEntries.filter(
    (entry) => entry.status === "clarify_with_client"
  );
  const criticalClarifyWithClientEntries = clarifyWithClientEntries.filter(
    (entry) => entry.severity === "critical"
  );
  const openAssumptionEntries = standardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.kind === "assumption"
  );
  const openMissingPieceEntries = standardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.kind === "missing_piece"
  );
  const continuedWithHypothesisEntries = openMissingPieceEntries.filter(
    (entry) => entry.continuationDecision?.status === "accepted_with_hypothesis"
  );
  const continuedCriticalMissingPieceEntries = continuedWithHypothesisEntries.filter(
    (entry) => entry.severity === "critical"
  );
  const revalidationRequiredEntries = normalized.filter((entry) =>
    isAffaireRegisterEntryRevalidationRequired(entry)
  );
  const criticalRevalidationRequiredEntries = revalidationRequiredEntries.filter(
    (entry) => entry.severity === "critical"
  );
  const revalidationImpactedStages = Array.from(
    new Set(
      revalidationRequiredEntries.flatMap(
        (entry) => entry.revalidationRequest?.impactedStages ?? []
      )
    )
  );

  return {
    openQuestionsCount:
      criticalOpenEntries.length +
      nonCriticalOpenEntries.length +
      clarifyWithClientEntries.length,
    criticalOpenEntries,
    nonCriticalOpenEntries,
    clarifyWithClientEntries,
    criticalClarifyWithClientEntries,
    openAssumptionEntries,
    openMissingPieceEntries,
    continuedWithHypothesisEntries,
    continuedCriticalMissingPieceEntries,
    revalidationRequiredEntries,
    criticalRevalidationRequiredEntries,
    revalidationImpactedStages,
  } satisfies AffaireRegisterGateSummary;
}

export async function fetchAffaireRegisterSummary(input: {
  projectId: string;
  versionId?: string | null;
}): Promise<AffaireRegisterSummary> {
  const { context, project } = await requireAffaireRegisterProjectAccess(
    input.projectId,
    "reader"
  );
  const gateSummary = await fetchAffaireRegisterGateSummary({
    supabase: context.supabase,
    projectId: project.id,
    versionId: input.versionId ?? null,
  });
  const focusClarificationEntry =
    gateSummary.criticalClarifyWithClientEntries?.[0] ??
    gateSummary.clarifyWithClientEntries[0] ??
    null;
  const focusOpenQuestionEntry =
    gateSummary.criticalOpenEntries[0] ??
    gateSummary.nonCriticalOpenEntries[0] ??
    null;
  const focusRevalidationEntry =
    gateSummary.criticalRevalidationRequiredEntries?.[0] ??
    gateSummary.revalidationRequiredEntries?.[0] ??
    null;

  return {
    openQuestionsCount: gateSummary.openQuestionsCount,
    criticalOpenCount: gateSummary.criticalOpenEntries.length,
    nonCriticalOpenCount: gateSummary.nonCriticalOpenEntries.length,
    openQuestionsFocusEntryId: focusOpenQuestionEntry?.id ?? null,
    clarifyWithClientCount: gateSummary.clarifyWithClientEntries.length,
    criticalClarifyWithClientCount:
      gateSummary.criticalClarifyWithClientEntries?.length ?? 0,
    clarifyWithClientFocusEntryId: focusClarificationEntry?.id ?? null,
    openAssumptionCount: gateSummary.openAssumptionEntries.length,
    openMissingPieceCount: gateSummary.openMissingPieceEntries.length,
    continuedWithHypothesisCount:
      gateSummary.continuedWithHypothesisEntries?.length ?? 0,
    continuedCriticalMissingPieceCount:
      gateSummary.continuedCriticalMissingPieceEntries?.length ?? 0,
    revalidationRequired:
      (gateSummary.revalidationRequiredEntries?.length ?? 0) > 0,
    revalidationRequiredCount:
      gateSummary.revalidationRequiredEntries?.length ?? 0,
    criticalRevalidationRequiredCount:
      gateSummary.criticalRevalidationRequiredEntries?.length ?? 0,
    revalidationFocusEntryId: focusRevalidationEntry?.id ?? null,
    revalidationBlocksSubmission:
      (gateSummary.revalidationRequiredEntries?.length ?? 0) > 0,
    revalidationBlocksEstimation: false,
    revalidationImpactedStages: gateSummary.revalidationImpactedStages ?? [],
  };
}

export async function fetchAffaireRegisterTimeline(input: {
  projectId: string;
  versionId?: string | null;
  size?: number;
}): Promise<AffaireRegisterTimelineEvent[]> {
  const { context, project } = await requireAffaireRegisterProjectAccess(
    input.projectId,
    "reader"
  );

  let query = context.supabase
    .from("affaire_register_events" as never)
    .select(EVENT_SELECT as never)
    .eq("project_id", project.id as never);

  if (input.versionId) {
    query = query.or(`version_id.is.null,version_id.eq.${input.versionId}`);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(input.size ?? 12, 25)));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'historique du registre.");
  }

  return ((data ?? []) as unknown[])
    .map((row) => normalizeAffaireRegisterEventRow(row))
    .filter((row): row is AffaireRegisterEventRow => row !== null)
    .map(toAffaireRegisterTimelineEvent);
}

export async function fetchAffaireRegisterPage(
  input: ListAffaireRegisterPageInput
): Promise<AffaireRegisterPageResult> {
  const { context, project } = await requireAffaireRegisterProjectAccess(
    input.projectId,
    "reader"
  );

  const pageSize = Math.max(1, Math.min(input.size ?? PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX));
  let query = context.supabase
    .from("affaire_register_entries" as never)
    .select(ENTRY_SELECT as never)
    .eq("project_id", project.id as never)
    .eq("is_active", true as never);
  let focusedQuery: typeof query | null = input.focusEntryId
    ? context.supabase
        .from("affaire_register_entries" as never)
        .select(ENTRY_SELECT as never)
        .eq("project_id", project.id as never)
        .eq("is_active", true as never)
        .eq("id", input.focusEntryId as never)
    : null;

  query = applyVersionScopeFilter(query, input.versionId ?? null);
  query = applyCursorFilter(query, input.cursor ?? null);
  if (focusedQuery) {
    focusedQuery = applyVersionScopeFilter(focusedQuery, input.versionId ?? null);
  }

  if (input.status) {
    query = query.eq("status", input.status as never);
    if (focusedQuery) {
      focusedQuery = focusedQuery.eq("status", input.status as never);
    }
  }
  if (input.severity) {
    query = query.eq("severity", input.severity as never);
    if (focusedQuery) {
      focusedQuery = focusedQuery.eq("severity", input.severity as never);
    }
  }
  if (input.kind) {
    query = query.eq("kind", input.kind as never);
    if (focusedQuery) {
      focusedQuery = focusedQuery.eq("kind", input.kind as never);
    }
  }
  if (input.revalidationRequired) {
    query = query.eq("metadata->revalidationRequest->>status", "required");
    if (focusedQuery) {
      focusedQuery = focusedQuery.eq(
        "metadata->revalidationRequest->>status",
        "required"
      );
    }
  }

  const [
    { data, error },
    focusedResult,
  ] = await Promise.all([
    query
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize + 1),
    focusedQuery
      ? focusedQuery
          .order("updated_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le registre affaire.");
  }
  if (focusedResult.error) {
    throw mapSupabaseError(
      focusedResult.error,
      "Impossible de charger le point cible du registre affaire."
    );
  }

  const rows = ((data ?? []) as unknown[])
    .map((row) => normalizeAffaireRegisterEntryRow(row))
    .filter((row): row is AffaireRegisterEntryWithProfilesRow => row !== null);
  const focusedRow =
    ((focusedResult.data ?? []) as unknown[])
      .map((row) => normalizeAffaireRegisterEntryRow(row))
      .find((row): row is AffaireRegisterEntryWithProfilesRow => row !== null) ?? null;
  const shouldInjectFocusedRow =
    focusedRow !== null && !rows.some((row) => row.id === focusedRow.id);
  const pagedRows = rows.slice(0, shouldInjectFocusedRow ? pageSize - 1 : pageSize);
  const pageRows = shouldInjectFocusedRow ? [focusedRow, ...pagedRows] : pagedRows;
  const lastRow = pagedRows[pagedRows.length - 1] ?? null;
  const [summary, timeline] = await Promise.all([
    fetchAffaireRegisterSummary({
      projectId: project.id,
      versionId: input.versionId ?? null,
    }),
    fetchAffaireRegisterTimeline({
      projectId: project.id,
      versionId: input.versionId ?? null,
      size: 12,
    }),
  ]);
  const timelineByEntryId = new Map<string, AffaireRegisterTimelineEvent[]>();

  timeline.forEach((event) => {
    const current = timelineByEntryId.get(event.entryId) ?? [];
    current.push(event);
    timelineByEntryId.set(event.entryId, current);
  });

  return {
    items: pageRows.map((row) => ({
      ...toAffaireRegisterEntry(row),
      history: timelineByEntryId.get(row.id) ?? [],
    })),
    nextCursor:
      rows.length > pagedRows.length && lastRow
        ? encodeAffaireRegisterCursor({
            id: lastRow.id,
            updatedAt: lastRow.updated_at,
          })
        : null,
    summary,
    timeline,
    filters: {
      status: input.status ?? null,
      severity: input.severity ?? null,
      kind: input.kind ?? null,
      revalidationRequired: input.revalidationRequired ?? false,
      cursor: input.cursor ? encodeAffaireRegisterCursor(input.cursor) : null,
      focusEntryId: input.focusEntryId ?? null,
    },
  };
}

export async function fetchAffaireRegisterScopeOptions(input: {
  projectId: string;
  versionId?: string | null;
}): Promise<AffaireRegisterScopeOptions> {
  const { context } = await requireAffaireRegisterProjectAccess(
    input.projectId,
    "reader"
  );

  if (!input.versionId) {
    return {
      lots: [],
      lines: [],
    };
  }

  const { data, error } = await context.supabase
    .from("estimate_items")
    .select("id, title, item_type, parent_id, position")
    .eq("tenant_id", context.tenantId)
    .eq("version_id", input.versionId)
    .in("item_type", ["section", "line"])
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les scopes du registre.");
  }

  const rows = ((data ?? []) as unknown[])
    .map((row) => normalizeEstimateItemScopeRow(row))
    .filter((row): row is EstimateItemScopeRow => row !== null);
  const numberingById = computeEstimateItemNumbering(
    rows
      .filter((row): row is EstimateItemScopeRow & { item_type: "section" | "line" } =>
        row.item_type === "section" || row.item_type === "line"
      )
      .map((row) => ({
        id: row.id,
        parent_id: row.parent_id,
        position: row.position,
        item_type: row.item_type,
      }))
  );
  const toOption = (row: EstimateItemScopeRow): AffaireRegisterScopeOption => {
    const title = row.title?.trim() || `${row.item_type === "section" ? "Lot" : "Ligne"} ${row.id.slice(0, 8)}`;
    const prefix = numberingById[row.id];
    return {
      id: row.id,
      label: prefix ? `${prefix} - ${title}` : title,
    };
  };

  return {
    lots: rows.filter((row) => row.item_type === "section").map(toOption),
    lines: rows.filter((row) => row.item_type === "line").map(toOption),
  };
}

export async function fetchAffaireRegisterOwnerOptions(input: {
  projectId: string;
}): Promise<AffaireRegisterOwnerOption[]> {
  const { context } = await requireAffaireRegisterProjectAccess(
    input.projectId,
    "reader"
  );

  return listAssignableRegisterOwners({
    supabase: context.supabase,
    tenantId: context.tenantId,
  });
}

export async function fetchAffaireRegisterReviewExport(input: {
  projectId: string;
  versionId?: string | null;
}): Promise<AffaireRegisterReviewExport> {
  const { context, project } = await requireAffaireRegisterProjectAccess(
    input.projectId,
    "reader"
  );

  let query = context.supabase
    .from("affaire_register_entries" as never)
    .select(ENTRY_SELECT as never)
    .eq("project_id", project.id as never)
    .eq("is_active", true as never);

  query = applyVersionScopeFilter(query as never, input.versionId ?? null) as never;

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger l'export de revue du registre."
    );
  }

  const entries = ((data ?? []) as unknown[])
    .map((row) => normalizeAffaireRegisterEntryRow(row))
    .filter((row): row is AffaireRegisterEntryWithProfilesRow => row !== null)
    .map(toAffaireRegisterEntry);

  return buildAffaireRegisterReviewExport({
    generatedAt: new Date().toISOString(),
    projectId: project.id,
    projectLabel: project.name,
    projectReference: project.reference ?? null,
    clientName: project.client_name ?? null,
    versionId: input.versionId ?? null,
    entries,
  });
}

async function resolveScopeForEntry(input: {
  context: AuthenticatedRegisterContext;
  project: AffaireProjectAccessRow;
  versionId: string | null;
  scopeType: AffaireRegisterScopeType;
  scopeId: string | null;
  scopeRef: string | null;
  scopeLabel: string | null;
}) {
  if (input.scopeType === "project") {
    return {
      versionId: null,
      scopeId: null,
      scopeRef: null,
      scopeLabel: input.project.name,
    };
  }

  if (input.scopeType === "exception") {
    if (!input.versionId) {
      throw badRequest("Une version est requise pour lier une exception.");
    }

    return {
      versionId: input.versionId,
      scopeId: null,
      scopeRef: normalizeAffaireRegisterText(input.scopeRef ?? "", 120),
      scopeLabel: normalizeAffaireRegisterText(input.scopeLabel ?? "", 180),
    };
  }

  if (!input.versionId || !input.scopeId) {
    throw badRequest("Le scope selectionne est incomplet.");
  }

  const { data, error } = await input.context.supabase
    .from("estimate_items")
    .select("id, title, item_type, parent_id, position")
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .eq("id", input.scopeId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le scope du registre.");
  }

  const item = normalizeEstimateItemScopeRow(data);
  if (!item) {
    throw notFound("Scope du registre introuvable.");
  }

  const expectedItemType = input.scopeType === "lot" ? "section" : "line";
  if (item.item_type !== expectedItemType) {
    throw badRequest("Le scope selectionne ne correspond pas au type attendu.");
  }

  const { lots, lines } = await fetchAffaireRegisterScopeOptions({
    projectId: input.project.id,
    versionId: input.versionId,
  });
  const scopeLabel =
    (input.scopeType === "lot" ? lots : lines).find((option) => option.id === item.id)?.label ??
    item.title?.trim() ??
    item.id;

  return {
    versionId: input.versionId,
    scopeId: item.id,
    scopeRef: null,
    scopeLabel,
  };
}

export async function createAffaireRegisterEntry(input: z.infer<typeof createAffaireRegisterEntryInputSchema>) {
  const parsed = createAffaireRegisterEntryInputSchema.parse(input);
  const { context, project } = await requireAffaireRegisterProjectAccess(
    parsed.projectId,
    "editor"
  );
  const createdAt = new Date().toISOString();
  const scope = await resolveScopeForEntry({
    context,
    project,
    versionId: parsed.versionId ?? null,
    scopeType: parsed.scopeType,
    scopeId: parsed.scopeId ?? null,
    scopeRef: parsed.scopeRef ?? null,
    scopeLabel: parsed.scopeLabel ?? null,
  });

  const payload = {
    project_id: project.id,
    version_id: scope.versionId,
    source_document_id: parsed.sourceDocumentId ?? null,
    kind: parsed.kind,
    code: normalizeAffaireRegisterText(parsed.code ?? "", 120) || null,
    text: normalizeAffaireRegisterText(parsed.text),
    severity: parsed.severity,
    status: "open",
    origin_kind: "manual",
    scope_type: parsed.scopeType,
    scope_id: scope.scopeId,
    scope_ref: scope.scopeRef,
    scope_label: scope.scopeLabel,
    source_file_name:
      normalizeAffaireRegisterText(parsed.sourceFileName ?? "", 255) || null,
    sync_key: null,
    is_active: true,
    metadata: buildAffaireRegisterDerivedMetadata({
      metadata: {
        severityDecision: {
          mode: "canonical",
          canonicalSeverity: parsed.severity,
          overriddenSeverity: null,
          updatedAt: createdAt,
          updatedByUserId: context.userId,
          comment: null,
        } satisfies AffaireRegisterSeverityDecision,
      },
      kind: parsed.kind,
      code: normalizeAffaireRegisterText(parsed.code ?? "", 120) || null,
      severity: parsed.severity,
      status: "open",
      scopeType: parsed.scopeType,
      scopeId: scope.scopeId,
      scopeRef: scope.scopeRef,
      scopeLabel: scope.scopeLabel,
      versionId: scope.versionId,
      sourceDocumentId: parsed.sourceDocumentId ?? null,
      sourceFileName:
        normalizeAffaireRegisterText(parsed.sourceFileName ?? "", 255) || null,
    }),
    created_by: context.userId,
    updated_by: context.userId,
  } as const;

  const { data, error } = await context.supabase
    .from("affaire_register_entries" as never)
    .insert(payload as never)
    .select(ENTRY_SELECT as never)
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible de créer l'entrée du registre.");
  }

  const entry = normalizeAffaireRegisterEntryRow(data);
  if (!entry) {
    throw badRequest("Reponse invalide lors de la creation du registre.");
  }

  await insertAffaireRegisterEvent({
    supabase: context.supabase,
    entryId: entry.id,
    actorUserId: context.userId,
    eventType: "created",
    reason: "manual.create",
    afterPayload: {
      kind: entry.kind,
      severity: entry.severity,
      status: entry.status,
    } satisfies Json,
  });

  return {
    ok: true,
    entry: toAffaireRegisterEntry(entry),
  } as const;
}

export async function updateAffaireRegisterEntryStatus(
  input: z.infer<typeof updateAffaireRegisterEntryStatusInputSchema>
) {
  const parsed = updateAffaireRegisterEntryStatusInputSchema.parse(input);
  const { context, project } = await requireAffaireRegisterProjectAccess(
    parsed.projectId,
    "editor"
  );

  const { data, error } = await context.supabase
    .from("affaire_register_entries" as never)
    .select(ENTRY_SELECT as never)
    .eq("project_id", project.id as never)
    .eq("id", parsed.entryId as never)
    .eq("is_active", true as never)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'entree du registre.");
  }

  const entry = normalizeAffaireRegisterEntryRow(data);
  if (!entry) {
    throw notFound("Entree du registre introuvable.");
  }

  if (entry.status === parsed.status) {
    return {
      ok: true,
      entry: toAffaireRegisterEntry(entry),
    } as const;
  }

  if (parsed.status === "clarify_with_client" && entry.status !== "open") {
    throw badRequest(
      "Seules les entrees ouvertes peuvent etre basculees en clarification client."
    );
  }

  const comment = normalizeAffaireRegisterText(parsed.comment ?? "", 320) || null;
  const clarificationRequest =
    parsed.status === "clarify_with_client"
      ? ({
          status: "clarify_with_client",
          requestedAt: new Date().toISOString(),
          requestedByUserId: context.userId,
          previousStatus: entry.status,
          comment,
        } satisfies AffaireRegisterClientClarificationRequest)
      : null;
  const nextMetadata = { ...entry.metadata };

  if (clarificationRequest) {
    nextMetadata.clientClarificationRequest = clarificationRequest;
  } else if ("clientClarificationRequest" in nextMetadata) {
    delete nextMetadata.clientClarificationRequest;
  }
  if (parsed.status !== "open" && "revalidationRequest" in nextMetadata) {
    delete nextMetadata.revalidationRequest;
  }
  const derivedMetadata = buildAffaireRegisterDerivedMetadata({
    metadata: nextMetadata,
    kind: entry.kind,
    code: entry.code,
    severity: entry.severity,
    status: parsed.status,
    scopeType: entry.scope_type,
    scopeId: entry.scope_id,
    scopeRef: entry.scope_ref,
    scopeLabel: entry.scope_label,
    versionId: entry.version_id,
    sourceDocumentId: entry.source_document_id,
    sourceFileName: entry.source_file_name,
    clientClarificationRequest: clarificationRequest,
    continuationDecision: extractAffaireRegisterContinuationDecision(nextMetadata),
    revalidationRequest: extractAffaireRegisterRevalidationRequest(nextMetadata),
  });

  const updatedEntry = await updateAffaireRegisterEntryWithEvent({
    supabase: context.supabase,
    entryId: entry.id,
    actorUserId: context.userId,
    patch: {
      status: parsed.status,
      metadata: derivedMetadata as Json,
    },
    eventType:
      parsed.status === "clarify_with_client"
        ? "clarify_with_client_requested"
        : "status_changed",
    reason: comment,
    beforePayload: {
      status: entry.status,
      clientClarificationRequest:
        extractAffaireRegisterClientClarificationRequest(entry.metadata),
      revalidationRequest: extractAffaireRegisterRevalidationRequest(entry.metadata),
    } satisfies Json,
    afterPayload: {
      status: parsed.status,
      clientClarificationRequest: clarificationRequest,
      revalidationRequest:
        parsed.status === "open"
          ? extractAffaireRegisterRevalidationRequest(derivedMetadata)
          : null,
      comment,
    } satisfies Json,
    fallbackMessage: "Impossible de mettre a jour le registre.",
  });

  return {
    ok: true,
    entry: toAffaireRegisterEntry(updatedEntry),
  } as const;
}

export async function updateAffaireRegisterEntryFollowUp(
  input: z.infer<typeof updateAffaireRegisterEntryFollowUpInputSchema>
) {
  const parsed = updateAffaireRegisterEntryFollowUpInputSchema.parse(input);
  const { context, project } = await requireAffaireRegisterProjectAccess(
    parsed.projectId,
    "editor"
  );

  const { data, error } = await context.supabase
    .from("affaire_register_entries" as never)
    .select(ENTRY_SELECT as never)
    .eq("project_id", project.id as never)
    .eq("id", parsed.entryId as never)
    .eq("is_active", true as never)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'entree du registre.");
  }

  const entry = normalizeAffaireRegisterEntryRow(data);
  if (!entry) {
    throw notFound("Entree du registre introuvable.");
  }

  const now = new Date().toISOString();
  const comment = normalizeAffaireRegisterText(parsed.comment ?? "", 320) || null;
  const currentFollowUp = extractAffaireRegisterFollowUp(entry.metadata);
  const existingSeverityDecision = extractAffaireRegisterSeverityDecision(
    entry.metadata
  );
  const currentSeverityDecision = buildCanonicalSeverityDecision({
    severity:
      existingSeverityDecision?.mode === "manual"
        ? existingSeverityDecision.canonicalSeverity
        : entry.severity,
    existing: existingSeverityDecision,
    updatedAt: entry.updated_at,
    updatedByUserId: entry.updated_by,
  });

  let ownerOption: AffaireRegisterOwnerOption | null = null;
  if (parsed.ownerUserId) {
    ownerOption = await resolveAffaireRegisterOwnerOption({
      supabase: context.supabase,
      tenantId: context.tenantId,
      ownerUserId: parsed.ownerUserId,
    });
    if (!ownerOption) {
      throw badRequest("Le responsable selectionne n'est pas disponible pour cette affaire.");
    }
  }

  const nextSeverityDecision =
    parsed.severity === undefined
      ? currentSeverityDecision
      : parsed.severity === null
        ? ({
            mode: "canonical",
            canonicalSeverity: currentSeverityDecision.canonicalSeverity,
            overriddenSeverity: null,
            updatedAt: now,
            updatedByUserId: context.userId,
            comment,
          } satisfies AffaireRegisterSeverityDecision)
        : ({
            mode: parsed.severity === currentSeverityDecision.canonicalSeverity
              ? "canonical"
              : "manual",
            canonicalSeverity: currentSeverityDecision.canonicalSeverity,
            overriddenSeverity:
              parsed.severity === currentSeverityDecision.canonicalSeverity
                ? null
                : parsed.severity,
            updatedAt: now,
            updatedByUserId: context.userId,
            comment,
          } satisfies AffaireRegisterSeverityDecision);
  const nextSeverity =
    nextSeverityDecision.mode === "manual" &&
    nextSeverityDecision.overriddenSeverity
      ? nextSeverityDecision.overriddenSeverity
      : nextSeverityDecision.canonicalSeverity;

  const nextOwnerUserId =
    parsed.ownerUserId === undefined
      ? currentFollowUp?.ownerUserId ?? null
      : parsed.ownerUserId ?? null;
  const nextOwnerName =
    parsed.ownerUserId === undefined
      ? currentFollowUp?.ownerName ?? null
      : ownerOption?.label ?? null;
  const nextDueDate =
    parsed.dueDate === undefined
      ? currentFollowUp?.dueDate ?? null
      : parsed.dueDate ?? null;
  const nextFollowUp =
    nextOwnerUserId || nextDueDate
      ? ({
          ownerUserId: nextOwnerUserId,
          ownerName: nextOwnerName,
          dueDate: nextDueDate,
          updatedAt: now,
          updatedByUserId: context.userId,
          comment,
        } satisfies AffaireRegisterFollowUp)
      : null;

  const followUpUnchanged =
    (currentFollowUp?.ownerUserId ?? null) === (nextFollowUp?.ownerUserId ?? null) &&
    (currentFollowUp?.ownerName ?? null) === (nextFollowUp?.ownerName ?? null) &&
    (currentFollowUp?.dueDate ?? null) === (nextFollowUp?.dueDate ?? null);
  const severityUnchanged =
    entry.severity === nextSeverity &&
    currentSeverityDecision.mode === nextSeverityDecision.mode &&
    currentSeverityDecision.canonicalSeverity ===
      nextSeverityDecision.canonicalSeverity &&
    (currentSeverityDecision.overriddenSeverity ?? null) ===
      (nextSeverityDecision.overriddenSeverity ?? null);

  if (followUpUnchanged && severityUnchanged) {
    return {
      ok: true,
      entry: toAffaireRegisterEntry(entry),
    } as const;
  }

  const nextMetadata: Record<string, unknown> = {
    ...entry.metadata,
    severityDecision: nextSeverityDecision,
  };

  if (nextFollowUp) {
    nextMetadata.followUp = nextFollowUp;
  } else {
    delete nextMetadata.followUp;
  }

  const derivedMetadata = buildAffaireRegisterDerivedMetadata({
    metadata: nextMetadata,
    kind: entry.kind,
    code: entry.code,
    severity: nextSeverity,
    status: entry.status,
    scopeType: entry.scope_type,
    scopeId: entry.scope_id,
    scopeRef: entry.scope_ref,
    scopeLabel: entry.scope_label,
    versionId: entry.version_id,
    sourceDocumentId: entry.source_document_id,
    sourceFileName: entry.source_file_name,
    clientClarificationRequest:
      extractAffaireRegisterClientClarificationRequest(entry.metadata),
    continuationDecision: extractAffaireRegisterContinuationDecision(entry.metadata),
    revalidationRequest: extractAffaireRegisterRevalidationRequest(entry.metadata),
  });

  const updatedEntry = await updateAffaireRegisterEntryWithEvent({
    supabase: context.supabase,
    entryId: entry.id,
    actorUserId: context.userId,
    patch: {
      severity: nextSeverity,
      metadata: derivedMetadata as Json,
    },
    eventType: "follow_up_updated",
    reason: comment,
    beforePayload: {
      severity: entry.severity,
      severityDecision: currentSeverityDecision,
      followUp: currentFollowUp,
    } satisfies Json,
    afterPayload: {
      severity: nextSeverity,
      severityDecision: nextSeverityDecision,
      followUp: nextFollowUp,
      comment,
    } satisfies Json,
    fallbackMessage: "Impossible de mettre a jour le pilotage du registre.",
  });

  return {
    ok: true,
    entry: toAffaireRegisterEntry(updatedEntry),
  } as const;
}

export async function requestAffaireRegisterRevalidation(
  input: z.infer<typeof requestAffaireRegisterRevalidationInputSchema>
) {
  const parsed = requestAffaireRegisterRevalidationInputSchema.parse(input);
  const { context, project } = await requireAffaireRegisterProjectAccess(
    parsed.projectId,
    "editor"
  );
  const comment = normalizeAffaireRegisterText(parsed.comment ?? "", 320) || null;

  const { data, error } = await context.supabase
    .from("affaire_register_entries" as never)
    .select(ENTRY_SELECT as never)
    .eq("project_id", project.id as never)
    .eq("id", parsed.entryId as never)
    .eq("is_active", true as never)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'entree du registre.");
  }

  const entry = normalizeAffaireRegisterEntryRow(data);
  if (!entry) {
    throw notFound("Entree du registre introuvable.");
  }
  if (!isAffaireRegisterEntryResolved(entry.status)) {
    throw badRequest(
      "Seules les entrées déjà résolues peuvent être relancées en revalidation."
    );
  }

  const impactedStages = dedupeRevalidationImpactedStages(parsed.impactedStages);
  const revalidationRequest = {
    status: "required",
    requestedAt: new Date().toISOString(),
    requestedByUserId: context.userId,
    previousStatus: entry.status,
    cause: parsed.cause,
    triggerDocumentId: parsed.triggerDocumentId ?? null,
    triggerFileName:
      normalizeAffaireRegisterText(parsed.triggerFileName ?? "", 255) || null,
    impactedStages,
    comment,
  } satisfies AffaireRegisterRevalidationRequest;
  const nextMetadata = {
    ...entry.metadata,
    revalidationRequest,
  };

  if ("clientClarificationRequest" in nextMetadata) {
    delete nextMetadata.clientClarificationRequest;
  }
  const derivedMetadata = buildAffaireRegisterDerivedMetadata({
    metadata: nextMetadata,
    kind: entry.kind,
    code: entry.code,
    severity: entry.severity,
    status: "open",
    scopeType: entry.scope_type,
    scopeId: entry.scope_id,
    scopeRef: entry.scope_ref,
    scopeLabel: entry.scope_label,
    versionId: entry.version_id,
    sourceDocumentId: entry.source_document_id,
    sourceFileName: entry.source_file_name,
    clientClarificationRequest: null,
    continuationDecision: extractAffaireRegisterContinuationDecision(nextMetadata),
    revalidationRequest,
  });

  const updatedEntry = await updateAffaireRegisterEntryWithEvent({
    supabase: context.supabase,
    entryId: entry.id,
    actorUserId: context.userId,
    patch: {
      status: "open",
      metadata: derivedMetadata as Json,
    },
    eventType: "revalidation_requested",
    reason: comment,
    beforePayload: {
      status: entry.status,
      clientClarificationRequest:
        extractAffaireRegisterClientClarificationRequest(entry.metadata),
      revalidationRequest: extractAffaireRegisterRevalidationRequest(entry.metadata),
    } satisfies Json,
    afterPayload: {
      status: "open",
      revalidationRequest,
      comment,
    } satisfies Json,
    fallbackMessage: "Impossible de demander la revalidation du registre.",
  });

  return {
    ok: true,
    entry: toAffaireRegisterEntry(updatedEntry),
  } as const;
}

export async function continueAffaireRegisterWithHypothesis(
  input: z.infer<typeof continueAffaireRegisterWithHypothesisInputSchema>
) {
  const parsed = continueAffaireRegisterWithHypothesisInputSchema.parse(input);
  const { context, project } = await requireAffaireRegisterProjectAccess(
    parsed.projectId,
    "editor"
  );
  const comment = normalizeAffaireRegisterText(parsed.comment ?? "", 320) || null;

  const { data, error } = await context.supabase
    .from("affaire_register_entries" as never)
    .select(ENTRY_SELECT as never)
    .eq("project_id", project.id as never)
    .eq("id", parsed.entryId as never)
    .eq("is_active", true as never)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'entree du registre.");
  }

  const sourceEntry = normalizeAffaireRegisterEntryRow(data);
  if (!sourceEntry) {
    throw notFound("Entree du registre introuvable.");
  }

  if (sourceEntry.kind !== "missing_piece" || sourceEntry.status !== "open") {
    throw badRequest(
      "Seules les pieces manquantes ouvertes peuvent etre poursuivies sous hypothese."
    );
  }

  let assumptionsQuery = context.supabase
    .from("affaire_register_entries" as never)
    .select(ENTRY_SELECT as never)
    .eq("project_id", project.id as never)
    .eq("kind", "assumption" as never)
    .eq("is_active", true as never);
  assumptionsQuery = applyVersionScopeFilter(
    assumptionsQuery as never,
    sourceEntry.version_id
  ) as never;

  const { data: assumptionData, error: assumptionError } = await assumptionsQuery.order(
    "created_at",
    { ascending: false }
  );

  if (assumptionError) {
    throw mapSupabaseError(
      assumptionError,
      "Impossible de charger les hypotheses de continuation."
    );
  }

  const existingHypothesis = ((assumptionData ?? []) as unknown[])
    .map((row) => normalizeAffaireRegisterEntryRow(row))
    .filter((row): row is AffaireRegisterEntryWithProfilesRow => row !== null)
    .find((row) => readContinuationSourceEntryId(row.metadata) === sourceEntry.id);

  if (
    extractAffaireRegisterContinuationDecision(sourceEntry.metadata)?.status ===
    "accepted_with_hypothesis"
  ) {
    return {
      ok: true,
      entry: toAffaireRegisterEntry(sourceEntry),
      hypothesisEntry: existingHypothesis ? toAffaireRegisterEntry(existingHypothesis) : null,
    } as const;
  }

  const hypothesisText = buildAffaireRegisterContinuationHypothesisText({
    entryText: sourceEntry.text,
  });
  const acceptedAt = new Date().toISOString();
  const continuationMetadata = {
    continuationSource: {
      kind: sourceEntry.kind,
      entryId: sourceEntry.id,
      code: sourceEntry.code,
      text: sourceEntry.text,
    },
    severityDecision: {
      mode: "canonical",
      canonicalSeverity: sourceEntry.severity,
      overriddenSeverity: null,
      updatedAt: acceptedAt,
      updatedByUserId: context.userId,
      comment,
    } satisfies AffaireRegisterSeverityDecision,
  } satisfies Record<string, unknown>;

  let hypothesisEntry: AffaireRegisterEntryWithProfilesRow | undefined =
    existingHypothesis ?? undefined;

  if (!hypothesisEntry) {
    const { data: hypothesisData, error: hypothesisInsertError } = await context.supabase
      .from("affaire_register_entries" as never)
      .insert({
        project_id: project.id,
        version_id: sourceEntry.version_id,
        source_document_id: sourceEntry.source_document_id,
        kind: "assumption",
        code: sourceEntry.code,
        text: hypothesisText,
        severity: sourceEntry.severity,
        status: "open",
        origin_kind: "manual",
        scope_type: sourceEntry.scope_type,
        scope_id: sourceEntry.scope_id,
        scope_ref: sourceEntry.scope_ref,
        scope_label: sourceEntry.scope_label,
        source_file_name: sourceEntry.source_file_name,
        sync_key: null,
        is_active: true,
        metadata: buildAffaireRegisterDerivedMetadata({
          metadata: continuationMetadata,
          kind: "assumption",
          code: sourceEntry.code,
          severity: sourceEntry.severity,
          status: "open",
          scopeType: sourceEntry.scope_type,
          scopeId: sourceEntry.scope_id,
          scopeRef: sourceEntry.scope_ref,
          scopeLabel: sourceEntry.scope_label,
          versionId: sourceEntry.version_id,
          sourceDocumentId: sourceEntry.source_document_id,
          sourceFileName: sourceEntry.source_file_name,
        }),
        created_by: context.userId,
        updated_by: context.userId,
      } as never)
      .select(ENTRY_SELECT as never)
      .single();

    if (hypothesisInsertError) {
      throw mapSupabaseError(
        hypothesisInsertError,
        "Impossible de créer l'hypothèse de continuation."
      );
    }

    const normalizedHypothesisEntry = normalizeAffaireRegisterEntryRow(hypothesisData);
    if (!normalizedHypothesisEntry) {
      throw badRequest("Reponse invalide lors de la creation de l'hypothese.");
    }
    hypothesisEntry = normalizedHypothesisEntry;

    await insertAffaireRegisterEvent({
      supabase: context.supabase,
      entryId: hypothesisEntry.id,
      actorUserId: context.userId,
      eventType: "created",
      reason: "manual.continue_with_hypothesis",
      afterPayload: {
        kind: hypothesisEntry.kind,
        severity: hypothesisEntry.severity,
        status: hypothesisEntry.status,
        sourceEntryId: sourceEntry.id,
      } satisfies Json,
    });
  }

  const decision = {
    status: "accepted_with_hypothesis",
    hypothesisEntryId: hypothesisEntry.id,
    hypothesisText: hypothesisEntry.text,
    acceptedAt,
    acceptedByUserId: context.userId,
    comment,
  } satisfies AffaireRegisterContinuationDecision;

  const updatedMetadata = buildAffaireRegisterDerivedMetadata({
        metadata: {
          ...sourceEntry.metadata,
          continuationDecision: decision,
        },
        kind: sourceEntry.kind,
        code: sourceEntry.code,
        severity: sourceEntry.severity,
        status: sourceEntry.status,
        scopeType: sourceEntry.scope_type,
        scopeId: sourceEntry.scope_id,
        scopeRef: sourceEntry.scope_ref,
        scopeLabel: sourceEntry.scope_label,
        versionId: sourceEntry.version_id,
        sourceDocumentId: sourceEntry.source_document_id,
        sourceFileName: sourceEntry.source_file_name,
        clientClarificationRequest:
          extractAffaireRegisterClientClarificationRequest(sourceEntry.metadata),
        continuationDecision: decision,
        revalidationRequest:
          extractAffaireRegisterRevalidationRequest(sourceEntry.metadata),
      });
  const updatedEntry = await updateAffaireRegisterEntryWithEvent({
    supabase: context.supabase,
    entryId: sourceEntry.id,
    actorUserId: context.userId,
    patch: {
      metadata: updatedMetadata as Json,
    },
    eventType: "continued_with_hypothesis",
    reason: comment,
    beforePayload: {
      status: sourceEntry.status,
      continuationDecision: null,
    } satisfies Json,
    afterPayload: {
      status: sourceEntry.status,
      continuationDecision: decision,
      comment,
    } satisfies Json,
    fallbackMessage: "Impossible de tracer la continuation sous hypothese.",
  });

  return {
    ok: true,
    entry: toAffaireRegisterEntry(updatedEntry),
    hypothesisEntry: toAffaireRegisterEntry(hypothesisEntry),
  } as const;
}

export function buildAffaireRegisterSubmissionSignalMessage(input: {
  entries: AffaireRegisterGateEntry[];
  label: string;
  intro: string;
}) {
  const preview = input.entries
    .slice(0, 3)
    .map((entry) => `${AFFAIRE_REGISTER_KIND_LABELS[entry.kind]} : ${entry.text}`)
    .join(" · ");
  const labelPrefix = input.label.trim();

  return `${labelPrefix}: ${input.intro}${preview ? ` ${preview}` : ""}`.trim();
}
