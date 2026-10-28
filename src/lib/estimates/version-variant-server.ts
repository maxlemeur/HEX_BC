import "server-only";

import type { Database } from "@/types/database";
import { badRequest, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import {
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  toRpcUuid,
} from "@/lib/estimates/server-context";
import { toNullableText } from "@/lib/estimates/version-write-normalization";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";

type EstimateVersionUpdate = Database["public"]["Tables"]["estimate_versions"]["Update"];

export async function duplicateEstimateVersion(
  versionId: string,
  options?: { as_variant?: boolean }
) {
  const context = await getAuthenticatedContext();
  const { supabase } = context;
  // Creer une version (ou une variante) est une ecriture de workflow, au meme
  // titre qu'une transition de statut : reservee aux roles ecrivains.
  assertCanWriteEstimateWorkflows(context.tenantRole);
  const access = await getVersionAccessOrThrow(supabase, versionId, context);
  if (access.project.is_archived) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const { data, error } = await supabase.rpc("duplicate_estimate_version", {
    source_version_id: versionId,
    as_variant: options?.as_variant === true,
  });

  if (error) {
    throw mapSupabaseError(error, "Impossible de dupliquer le chiffrage.");
  }

  const duplicatedVersionId = toRpcUuid(data);
  if (!duplicatedVersionId) {
    throw badRequest("Impossible de dupliquer le chiffrage.");
  }

  return {
    version_id: duplicatedVersionId,
  };
}

export async function createEstimateVariant(versionId: string) {
  return duplicateEstimateVersion(versionId, { as_variant: true });
}

export async function promoteEstimateVariant(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);
  const variantLabel = toNullableText(version.variant_label);
  const parentVersionId = version.parent_version_id ?? null;

  if (!variantLabel || !parentVersionId) {
    throw badRequest(
      "Cette version n'est pas une variante.",
      undefined,
      "ESTIMATE_VARIANT_REQUIRED"
    );
  }

  assertDraftStatus(version.status);

  const promotionPayload = {
    parent_version_id: null,
    variant_label: null,
  } as EstimateVersionUpdate;

  const { data, error } = await supabase
    .from("estimate_versions")
    .update(promotionPayload)
    .eq("id", versionId)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de promouvoir la variante.");
    }
    throw badRequest("Impossible de promouvoir la variante.");
  }

  return {
    version: data,
  };
}
