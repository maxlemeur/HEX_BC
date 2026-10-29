import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import { conflict, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import type { EstimateSealVersionFields } from "@/lib/estimates/estimate-seal";
import type { DocumentProof1 } from "@/lib/estimates/offer-contract";
import {
  assertEstimateVersionUnchanged,
  readAllEstimateItems,
} from "@/lib/estimates/read-all-items-server";
import type { EstimateStatus } from "@/lib/estimates/status";
import type { EstimateVersionEventType } from "@/lib/estimates/version-lifecycle-plan";
import { getServiceRoleSupabaseClient } from "@/lib/estimates/version-workflow-client-server";

type Supabase = SupabaseClient<Database>;
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];

export async function loadEstimateSealSource(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}): Promise<{ version: EstimateSealVersionFields & Pick<EstimateVersionRow, "seal_payload_version" | "content_revision">; items: EstimateItemRow[] }> {
  const { data: versionData, error: versionError } = await input.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, project_id, status, updated_at, version_number, title, exclusions, date_devis, validite_jours, currency, total_ht_cents, total_tax_cents, total_ttc_cents, rounding_adjustment_cents, margin_multiplier, margin_mode, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, max_section_depth, tax_rate_bp, rounding_mode, rounding_step_cents, calc_engine_version, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents, calc_snapshot_content_revision, calc_snapshot_context, contractor_role, seal_hash, seal_payload_version, content_revision"
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .single();

  if (versionError || !versionData) {
    if (versionError) {
      throw mapSupabaseError(versionError, "Impossible de charger la version.");
    }

    throw notFound("Version de chiffrage introuvable.");
  }

  const items = await readAllEstimateItems(input);
  await assertEstimateVersionUnchanged({ supabase: input.supabase, version: versionData });

  return {
    version: versionData as EstimateSealVersionFields & Pick<EstimateVersionRow, "seal_payload_version" | "content_revision">,
    items,
  };
}

export async function logEstimateVersionEvent(input: {
  versionId: string;
  eventType: EstimateVersionEventType;
  actorUserId: string | null;
  metadata?: Json;
  occurredAt?: string;
}) {
  const rpcClient = getServiceRoleSupabaseClient();

  const { error } = await rpcClient.rpc("log_estimate_version_event", {
    p_estimate_version_id: input.versionId,
    p_event_type: input.eventType,
    p_created_by: input.actorUserId,
    p_metadata: input.metadata ?? {},
    p_occurred_at: input.occurredAt ?? new Date().toISOString(),
  });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible d'enregistrer l'événement de statut."
    );
  }
}

export async function transitionEstimateVersionStatusAtomically(input: {
  versionId: string;
  tenantId: string;
  expectedUpdatedAt: string;
  nextStatus: EstimateStatus;
  sealHash: string | null;
  actorUserId: string;
  eventMetadata?: Json;
  occurredAt: string;
  sealPayloadVersion: number;
  expectedDocumentContract: DocumentProof1;
  draftLockSessionId?: string | null;
}) {
  const rpcClient = getServiceRoleSupabaseClient();
  const parameters = {
    p_version_id: input.versionId,
    p_tenant_id: input.tenantId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_next_status: input.nextStatus,
    p_seal_hash: input.sealHash,
    p_actor_user_id: input.actorUserId,
    p_event_metadata: input.eventMetadata ?? {},
    p_occurred_at: input.occurredAt,
    p_seal_payload_version: input.sealPayloadVersion,
    p_expected_document_contract: input.expectedDocumentContract as unknown as Json,
  };
  const { data, error } = input.draftLockSessionId
    ? await rpcClient.rpc("transition_estimate_draft_to_sent", {
        ...parameters,
        p_draft_lock_session_id: input.draftLockSessionId,
      })
    : await rpcClient.rpc("transition_estimate_version_status", parameters);

  if (error) {
    if (error.message.includes("ESTIMATE_DRAFT_LOCK_REQUIRED")) {
      throw conflict(
        "Le verrou de cette page n’est plus actif. Réessayez depuis cette page.",
        undefined,
        "LOCK_REQUIRED"
      );
    }
    if (
      error.code === "40001" ||
      error.code === "40P01" ||
      error.message.includes("ESTIMATE_VERSION_CONFLICT")
    ) {
      throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, {
        updated_at: input.expectedUpdatedAt,
      }, "VERSION_CONFLICT");
    }

    throw mapSupabaseError(error, "Impossible de changer le statut.");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, {
      updated_at: input.expectedUpdatedAt,
    }, "VERSION_CONFLICT");
  }

  return row as unknown as EstimateVersionRow;
}

export async function loadEstimateVersionForStatus(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_versions")
    .select("*")
    .eq("id", input.versionId)
    .eq("tenant_id", input.tenantId)
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de charger la version.");
    }
    throw notFound("Version de chiffrage introuvable.");
  }

  return data;
}
