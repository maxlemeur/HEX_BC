import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";

import type { AffaireAccessProject } from "@/lib/affaires/access-server";
import { mapSupabaseError } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Json } from "@/types/database";
import {
  type Supabase,
  type AffaireRegisterEntryRow,
  type AffaireRegisterEntryWithProfilesRow,
  normalizeAffaireRegisterEntryRow,
  insertAffaireRegisterEvent,
  updateAffaireRegisterEntryWithEvent,
} from "@/lib/affaires/register-store-server";

import {
  buildAffaireRegisterDerivedMetadata,
  extractAffaireRegisterClientClarificationRequest,
  extractAffaireRegisterSeverityDecision,
  extractAffaireRegisterContinuationDecision,
  extractAffaireRegisterRevalidationRequest,
  normalizeAffaireRegisterText,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntryOriginKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterScopeType,
  type AffaireRegisterSeverityDecision,
} from "./register";

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

  const { data, error } = await readAllRowsInChunks(input.syncKeys, (pageIds) => input.supabase
    .from("affaire_register_entries")
    .select(
      "id, tenant_id, project_id, version_id, source_document_id, kind, code, text, severity, status, origin_kind, scope_type, scope_id, scope_ref, scope_label, source_file_name, sync_key, is_active, metadata, created_by, updated_by, created_at, updated_at" as never,
      { count: "exact" }
    )
    .eq("project_id", input.projectId)
    .in("sync_key", pageIds));

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
  activeSyncKeys: Set<string>;
  actorUserId?: string | null;
  reason: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("affaire_register_entries")
    .select(
      "id, tenant_id, project_id, version_id, source_document_id, kind, code, text, severity, status, origin_kind, scope_type, scope_id, scope_ref, scope_label, source_file_name, sync_key, is_active, metadata, created_by, updated_by, created_at, updated_at" as never,
      { count: "exact" }
    )
    .eq("project_id", input.projectId)
    .eq("origin_kind", input.originKind)
    .eq("kind", "missing_piece")
    .eq("is_active", true));

  if (error) {
    throw mapSupabaseError(error, "Impossible de désactiver le registre sync.");
  }

  const rows = ((data ?? []) as unknown[])
    .map((row) => normalizeAffaireRegisterEntryRow(row))
    .filter((row): row is AffaireRegisterEntryWithProfilesRow => row !== null)
    .filter((row) => row.sync_key?.startsWith("missing_piece:") && row.sync_key !== "missing_piece:missing_plans" && !input.activeSyncKeys.has(row.sync_key));

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
      fallbackMessage: "Impossible de désactiver une entrée du registre.",
    });
  }
}

async function upsertSyncedEntries(input: {
  supabase: Supabase;
  project: AffaireAccessProject;
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
        .from("affaire_register_entries")
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
        buildExistingComparableProjection(existing) === nextProjection &&
        JSON.stringify(extractAffaireRegisterSeverityDecision(existing.metadata)) ===
          JSON.stringify(extractAffaireRegisterSeverityDecision(row.metadata))
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
      activeSyncKeys,
      actorUserId: input.actorUserId ?? null,
      reason: input.reason,
    });
  }
}

export async function syncAffaireRegisterFromBrief(input: {
  supabase: Supabase;
  project: AffaireAccessProject;
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
  project: AffaireAccessProject;
  missingPieces: Array<{
    code: string;
    label: string;
    severity: AffaireRegisterEntrySeverity;
  }>;
  actorUserId?: string | null;
}) {
  const rows = input.missingPieces.filter((piece) => piece.code !== "missing_plans").map((piece) => ({
    kind: "missing_piece" as const,
    code: piece.code,
    text: piece.label,
    // A previous import may still carry the old required-document defaults.
    // Explicit user decisions are applied from existing metadata by upsertSyncedEntries.
    severity: (["missing_dpgf", "missing_plans", "missing_cctp", "missing_bpu_dqe"].includes(piece.code)
      ? "warning" : piece.severity) as AffaireRegisterEntrySeverity,
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
  return syncAffairePlanGap({ projectId: input.project.id, actorUserId: input.actorUserId });
}

/** Plan state is reread and written in one database transaction, never from a stale UI snapshot. */
export async function syncAffairePlanGap(input: { projectId: string; actorUserId?: string | null }) {
  const { data, error } = await createServiceRoleClient().rpc("reconcile_affaire_plan_gap" as never, {
    p_project_id: input.projectId, p_actor_user_id: input.actorUserId ?? null,
  } as never);
  if (error) throw mapSupabaseError(error, "Impossible de synchroniser les plans du dossier.");
  return data === true;
}
