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
import type { Database, Json } from "@/types/database";

import {
  AFFAIRE_REGISTER_KIND_LABELS,
  buildAffaireRegisterContinuationHypothesisText,
  affaireRegisterEventTypeSchema,
  extractAffaireRegisterClientClarificationRequest,
  affaireRegisterEntryKindSchema,
  affaireRegisterEntryOriginKindSchema,
  affaireRegisterRevalidationCauseSchema,
  affaireRegisterRevalidationImpactedStageSchema,
  affaireRegisterEntrySeveritySchema,
  affaireRegisterEntryStatusSchema,
  affaireRegisterScopeTypeSchema,
  extractAffaireRegisterContinuationDecision,
  extractAffaireRegisterRevalidationRequest,
  encodeAffaireRegisterCursor,
  normalizeAffaireRegisterText,
  type AffaireRegisterEntry,
  type AffaireRegisterClientClarificationRequest,
  type AffaireRegisterContinuationDecision,
  type AffaireRegisterEventType,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntryOriginKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterPageResult,
  type AffaireRegisterRevalidationRequest,
  type AffaireRegisterScopeOption,
  type AffaireRegisterScopeOptions,
  type AffaireRegisterScopeType,
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
  severity: AffaireRegisterEntrySeverity;
  status: AffaireRegisterEntryStatus;
  text: string;
  scopeLabel: string;
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
const GATE_ENTRY_SELECT =
  "id, kind, text, severity, status, scope_label, version_id, is_active, metadata";
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
    clientClarificationRequest: extractAffaireRegisterClientClarificationRequest(
      row.metadata
    ),
    continuationDecision: extractAffaireRegisterContinuationDecision(row.metadata),
    revalidationRequest: extractAffaireRegisterRevalidationRequest(row.metadata),
    history: [],
  };
}

function hasAcceptedContinuationDecision(
  metadata: Record<string, unknown>
): metadata is Record<string, unknown> & {
  continuationDecision: AffaireRegisterContinuationDecision;
} {
  return extractAffaireRegisterContinuationDecision(metadata) !== null;
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

function applyVersionScopeFilter(query: {
  or: (filters: string) => unknown;
}, versionId: string | null | undefined) {
  if (!versionId) {
    return query;
  }

  query.or(`version_id.is.null,version_id.eq.${versionId}`);
  return query;
}

function applyCursorFilter(query: {
  or: (filters: string) => unknown;
}, cursor: { updatedAt: string; id: string } | null | undefined) {
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
    const { error: updateError } = await input.supabase
      .from("affaire_register_entries" as never)
      .update({
        status: nextStatus,
        is_active: false,
        updated_by: input.actorUserId ?? null,
      } as never)
      .eq("id", row.id);

    if (updateError) {
      throw mapSupabaseError(updateError, "Impossible de desactiver une entree du registre.");
    }

    await insertAffaireRegisterEvent({
      supabase: input.supabase,
      entryId: row.id,
      actorUserId: input.actorUserId ?? null,
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

      return {
        project_id: input.project.id,
        version_id: row.versionId ?? null,
        source_document_id: row.sourceDocumentId ?? null,
        kind: row.kind,
        code: row.code ?? null,
        text: row.text,
        severity: row.severity,
        status: nextStatus,
        origin_kind: row.originKind,
        scope_type: row.scopeType,
        scope_id: row.scopeId ?? null,
        scope_ref: row.scopeRef ?? null,
        scope_label: row.scopeLabel,
        source_file_name: row.sourceFileName ?? null,
        sync_key: row.syncKey,
        is_active: true,
        metadata: {},
        created_by: existing?.created_by ?? input.actorUserId ?? null,
        updated_by: input.actorUserId ?? null,
      };
    });

    const { data, error } = await input.supabase
      .from("affaire_register_entries" as never)
      .upsert(payload as never, {
        onConflict: "project_id,sync_key",
      })
      .select(
        "id, tenant_id, project_id, version_id, source_document_id, kind, code, text, severity, status, origin_kind, scope_type, scope_id, scope_ref, scope_label, source_file_name, sync_key, is_active, metadata, created_by, updated_by, created_at, updated_at" as never
      );

    if (error) {
      throw mapSupabaseError(error, "Impossible de synchroniser le registre affaire.");
    }

    const rows = ((data ?? []) as unknown[])
      .map((row) => normalizeAffaireRegisterEntryRow(row))
      .filter((row): row is AffaireRegisterEntryWithProfilesRow => row !== null);

    for (const row of rows) {
      const existing = row.sync_key ? existingBySyncKey.get(row.sync_key) ?? null : null;
      const nextProjection = buildExistingComparableProjection(row);
      const previousProjection = existing
        ? buildExistingComparableProjection(existing)
        : null;

      if (!existing) {
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
        continue;
      }

      if (!existing.is_active) {
        await insertAffaireRegisterEvent({
          supabase: input.supabase,
          entryId: row.id,
          actorUserId: input.actorUserId ?? null,
          eventType: "reactivated",
          reason: input.reason,
          beforePayload: {
            status: existing.status,
            is_active: false,
          } satisfies Json,
          afterPayload: {
            status: row.status,
            is_active: true,
          } satisfies Json,
        });
        continue;
      }

      if (previousProjection !== nextProjection) {
        await insertAffaireRegisterEvent({
          supabase: input.supabase,
          entryId: row.id,
          actorUserId: input.actorUserId ?? null,
          eventType: "synced",
          reason: input.reason,
          beforePayload: {
            status: existing.status,
            severity: existing.severity,
            text: existing.text,
          } satisfies Json,
          afterPayload: {
            status: row.status,
            severity: row.severity,
            text: row.text,
          } satisfies Json,
        });
      }
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
      text: typeof row.text === "string" ? row.text.trim() : "",
      severity: affaireRegisterEntrySeveritySchema.parse(row.severity),
      status: affaireRegisterEntryStatusSchema.parse(row.status),
      scopeLabel:
        typeof row.scope_label === "string" && row.scope_label.trim().length > 0
          ? row.scope_label.trim()
          : "Affaire",
      clientClarificationRequest: isRecord(row.metadata)
        ? extractAffaireRegisterClientClarificationRequest(row.metadata)
        : null,
      continuationDecision: isRecord(row.metadata)
        ? extractAffaireRegisterContinuationDecision(row.metadata)
        : null,
      revalidationRequest: isRecord(row.metadata)
        ? extractAffaireRegisterRevalidationRequest(row.metadata)
        : null,
    }))
    .filter((row) => row.id.length > 0 && row.text.length > 0);

  const criticalOpenEntries = normalized.filter(
    (entry) => entry.status === "open" && entry.severity === "critical"
  );
  const nonCriticalOpenEntries = normalized.filter(
    (entry) => entry.status === "open" && entry.severity !== "critical"
  );
  const clarifyWithClientEntries = normalized.filter(
    (entry) => entry.status === "clarify_with_client"
  );
  const criticalClarifyWithClientEntries = clarifyWithClientEntries.filter(
    (entry) => entry.severity === "critical"
  );
  const openAssumptionEntries = normalized.filter(
    (entry) => entry.status === "open" && entry.kind === "assumption"
  );
  const openMissingPieceEntries = normalized.filter(
    (entry) => entry.status === "open" && entry.kind === "missing_piece"
  );
  const continuedWithHypothesisEntries = openMissingPieceEntries.filter(
    (entry) => entry.continuationDecision?.status === "accepted_with_hypothesis"
  );
  const continuedCriticalMissingPieceEntries = continuedWithHypothesisEntries.filter(
    (entry) => entry.severity === "critical"
  );
  const revalidationRequiredEntries = normalized.filter(
    (entry) =>
      entry.revalidationRequest?.status === "required" &&
      (entry.status === "open" || entry.status === "clarify_with_client")
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

  return {
    openQuestionsCount: gateSummary.openQuestionsCount,
    criticalOpenCount: gateSummary.criticalOpenEntries.length,
    nonCriticalOpenCount: gateSummary.nonCriticalOpenEntries.length,
    clarifyWithClientCount: gateSummary.clarifyWithClientEntries.length,
    criticalClarifyWithClientCount:
      gateSummary.criticalClarifyWithClientEntries?.length ?? 0,
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
  let focusedQuery: any = input.focusEntryId
    ? context.supabase
        .from("affaire_register_entries" as never)
        .select(ENTRY_SELECT as never)
        .eq("project_id", project.id as never)
        .eq("is_active", true as never)
        .eq("id", input.focusEntryId as never)
    : null;

  query = applyVersionScopeFilter(query as never, input.versionId ?? null) as never;
  query = applyCursorFilter(query as never, input.cursor ?? null) as never;
  if (focusedQuery) {
    focusedQuery = applyVersionScopeFilter(
      focusedQuery as never,
      input.versionId ?? null
    ) as never;
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
      focusedResult.error as any,
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
    metadata: {},
    created_by: context.userId,
    updated_by: context.userId,
  } as const;

  const { data, error } = await context.supabase
    .from("affaire_register_entries" as never)
    .insert(payload as never)
    .select(ENTRY_SELECT as never)
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible de creer l'entree du registre.");
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

  const { data: updatedData, error: updateError } = await context.supabase
    .from("affaire_register_entries" as never)
    .update({
      status: parsed.status,
      metadata: nextMetadata,
      updated_by: context.userId,
    } as never)
    .eq("id", entry.id as never)
    .select(ENTRY_SELECT as never)
    .single();

  if (updateError) {
    throw mapSupabaseError(updateError, "Impossible de mettre a jour le registre.");
  }

  const updatedEntry = normalizeAffaireRegisterEntryRow(updatedData);
  if (!updatedEntry) {
    throw badRequest("Reponse invalide lors de la mise a jour du registre.");
  }

  await insertAffaireRegisterEvent({
    supabase: context.supabase,
    entryId: entry.id,
    actorUserId: context.userId,
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
      status: updatedEntry.status,
      clientClarificationRequest: clarificationRequest,
      revalidationRequest:
        parsed.status === "open"
          ? extractAffaireRegisterRevalidationRequest(updatedEntry.metadata)
          : null,
      comment,
    } satisfies Json,
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

  const { data: updatedData, error: updateError } = await context.supabase
    .from("affaire_register_entries" as never)
    .update({
      status: "open",
      metadata: nextMetadata,
      updated_by: context.userId,
    } as never)
    .eq("id", entry.id as never)
    .select(ENTRY_SELECT as never)
    .single();

  if (updateError) {
    throw mapSupabaseError(
      updateError,
      "Impossible de demander la revalidation du registre."
    );
  }

  const updatedEntry = normalizeAffaireRegisterEntryRow(updatedData);
  if (!updatedEntry) {
    throw badRequest("Reponse invalide lors de la revalidation du registre.");
  }

  await insertAffaireRegisterEvent({
    supabase: context.supabase,
    entryId: entry.id,
    actorUserId: context.userId,
    eventType: "revalidation_requested",
    reason: comment,
    beforePayload: {
      status: entry.status,
      clientClarificationRequest:
        extractAffaireRegisterClientClarificationRequest(entry.metadata),
      revalidationRequest: extractAffaireRegisterRevalidationRequest(entry.metadata),
    } satisfies Json,
    afterPayload: {
      status: updatedEntry.status,
      revalidationRequest,
      comment,
    } satisfies Json,
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
  const continuationMetadata = {
    continuationSource: {
      kind: sourceEntry.kind,
      entryId: sourceEntry.id,
      code: sourceEntry.code,
      text: sourceEntry.text,
    },
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
        metadata: continuationMetadata,
        created_by: context.userId,
        updated_by: context.userId,
      } as never)
      .select(ENTRY_SELECT as never)
      .single();

    if (hypothesisInsertError) {
      throw mapSupabaseError(
        hypothesisInsertError,
        "Impossible de creer l'hypothese de continuation."
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
    acceptedAt: new Date().toISOString(),
    acceptedByUserId: context.userId,
    comment,
  } satisfies AffaireRegisterContinuationDecision;

  const { data: updatedData, error: updateError } = await context.supabase
    .from("affaire_register_entries" as never)
    .update({
      metadata: {
        ...sourceEntry.metadata,
        continuationDecision: decision,
      },
      updated_by: context.userId,
    } as never)
    .eq("id", sourceEntry.id as never)
    .select(ENTRY_SELECT as never)
    .single();

  if (updateError) {
    throw mapSupabaseError(
      updateError,
      "Impossible de tracer la continuation sous hypothese."
    );
  }

  const updatedEntry = normalizeAffaireRegisterEntryRow(updatedData);
  if (!updatedEntry) {
    throw badRequest("Reponse invalide lors de la mise a jour du registre.");
  }

  await insertAffaireRegisterEvent({
    supabase: context.supabase,
    entryId: sourceEntry.id,
    actorUserId: context.userId,
    eventType: "continued_with_hypothesis",
    reason: comment,
    beforePayload: {
      status: sourceEntry.status,
      continuationDecision: null,
    } satisfies Json,
    afterPayload: {
      status: updatedEntry.status,
      continuationDecision: decision,
      comment,
    } satisfies Json,
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
