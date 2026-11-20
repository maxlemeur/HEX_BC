import type { SupabaseClient } from "@supabase/supabase-js";

import { badRequest, mapSupabaseError } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, Json } from "@/types/database";

import {
  deriveAffaireRegisterBusinessImpact,
  extractAffaireRegisterClientClarificationRequest,
  extractAffaireRegisterBusinessImpact,
  extractAffaireRegisterFollowUp,
  affaireRegisterEntryKindSchema,
  affaireRegisterEntryOriginKindSchema,
  extractAffaireRegisterSeverityDecision,
  affaireRegisterEntrySeveritySchema,
  affaireRegisterEntryStatusSchema,
  affaireRegisterScopeTypeSchema,
  extractAffaireRegisterContinuationDecision,
  extractAffaireRegisterRevalidationRequest,
  resolveAffaireRegisterBusinessLocation,
  type AffaireRegisterEntry,
  type AffaireRegisterEventType,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntryOriginKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterScopeType,
} from "./register";
import { isRecord, toStringOrNull } from "@/lib/value-guards";
import { resolveEmbeddedOne } from "@/lib/supabase/embedded";

type TenantRole = Database["public"]["Enums"]["tenant_role"];
export type Supabase = SupabaseClient<Database>;

export type AuthenticatedRegisterContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
};

export type AffaireRegisterEntryRow = {
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

export type AffaireRegisterEntryWithProfilesRow = AffaireRegisterEntryRow & {
  created_by_profile: { full_name: string | null } | null;
  updated_by_profile: { full_name: string | null } | null;
};

export const REGISTER_ACCESS = { forbiddenMessage: "Accès refusé à ce registre affaire." };
export const ENTRY_SELECT = [
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

export function normalizeAffaireRegisterEntryRow(
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

export function toAffaireRegisterEntry(
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

export function applyVersionScopeFilter<T extends {
  or: (filters: string) => unknown;
}>(query: T, versionId: string | null | undefined): T {
  if (!versionId) {
    return query;
  }

  query.or(`version_id.is.null,version_id.eq.${versionId}`);
  return query;
}

export async function insertAffaireRegisterEvent(input: {
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
  const { error } = await input.supabase.from("affaire_register_events").insert({
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

export async function updateAffaireRegisterEntryWithEvent(input: {
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
    throw badRequest("Réponse invalide lors de la mise à jour du registre.");
  }

  return updatedEntry;
}
