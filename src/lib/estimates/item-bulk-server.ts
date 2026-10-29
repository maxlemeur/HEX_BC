import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import { isUnifiedEngine } from "@/lib/estimates/engine/capabilities";
import { conflict, mapSupabaseError } from "@/lib/estimates/errors";
import { parseBulkUpdateCountDetails, prepareEstimateBulkItems } from "@/lib/estimates/item-bulk-plan";
import { projectDraftMutation } from "@/lib/estimates/item-draft-projection";
import {
  ensureProductIsValid,
  ensureSupplierPriceIsValid,
  fetchEstimateVersionToken,
  resolveEstimateItemAidRegex,
} from "@/lib/estimates/item-write-context";
import type { BulkUpdateEstimateItemsInput, BulkUpdateEstimateVersionPatchInput } from "@/lib/estimates/schemas";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";
import { assertVersionConcurrencyToken } from "@/lib/estimates/version-concurrency";
import type { EstimateTotals } from "@/lib/estimates/version-totals-invariant";
import { assertEstimateTotalsInvariantForPatch } from "@/lib/estimates/version-totals-invariant-server";
import type { Json } from "@/types/database";

const STALE_BULK_UPDATE_ERROR_MESSAGE = "STALE_BULK_UPDATE_ITEMS";

export async function bulkUpdateEstimateItems(
  versionId: string,
  input: BulkUpdateEstimateItemsInput,
  concurrencyToken?: string,
  versionPatch?: BulkUpdateEstimateVersionPatchInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });
  assertVersionConcurrencyToken(version.updated_at, concurrencyToken);

  // Nothing to write: the checks above are the whole call (the takeoff apply uses it
  // as its lock check), so it answers before resolving the engine, v3 included.
  if (input.length === 0 && !versionPatch) {
    return {
      updated_count: 0,
      version: {
        id: version.id,
        updated_at: version.updated_at,
      },
    };
  }

  // A structural mutation can commit before the editor refreshes its rows.
  // Reconcile v2 totals from those persisted rows, never its stale footer.
  const shouldProjectDraft = isUnifiedEngine(resolveCalcEngineVersion(version)) &&
    (version.margin_mode === "tiered" || versionPatch !== undefined);
  if (versionPatch && !shouldProjectDraft) {
    const persistedTotals: EstimateTotals = {
      total_ht_cents: version.total_ht_cents ?? null,
      total_tax_cents: version.total_tax_cents ?? null,
      total_ttc_cents: version.total_ttc_cents ?? null,
    };

    await assertEstimateTotalsInvariantForPatch({
      supabase,
      tenantId,
      versionId,
      userId,
      persistedTotals,
      patch: versionPatch,
    });
  }

  const requestedUpdates = input.map((item) => ({ ...item }));
  const aidRegex = await resolveEstimateItemAidRegex({ tenantId, supabase });
  const { updatesPayload, productIdsToValidate, supplierPriceIdsToValidate } =
    prepareEstimateBulkItems(requestedUpdates, aidRegex);

  await Promise.all(
    [
      ...Array.from(productIdsToValidate).map((productId) =>
        ensureProductIsValid(supabase, productId, context)
      ),
      ...Array.from(supplierPriceIdsToValidate).map((supplierPriceId) =>
        ensureSupplierPriceIsValid(supabase, supplierPriceId, context)
      ),
    ]
  );

  const projection = shouldProjectDraft
    ? await projectDraftMutation({
        context,
        versionId,
        expectedUpdatedAt: version.updated_at,
        projectUserId: project.user_id,
        updates: updatesPayload,
      })
    : null;

  const { data: rpcUpdatedCount, error: bulkUpdateError } = await supabase.rpc(
    "bulk_update_estimate_items",
    {
      target_version_id: versionId,
      item_updates: (projection?.updates ?? updatesPayload) as Json,
      version_patch: projection?.versionPatch ?? versionPatch ?? null,
      expected_version_updated_at: version.updated_at,
    }
  );

  if (bulkUpdateError) {
    if (
      bulkUpdateError.code === "P0001" &&
      bulkUpdateError.message === STALE_BULK_UPDATE_ERROR_MESSAGE
    ) {
      const parsedDetails = parseBulkUpdateCountDetails(bulkUpdateError.details);
      throw conflict(
        "La liste de mise à jour est obsolete.",
        parsedDetails ?? {
          expected_count: projection?.updates.length ?? input.length,
        }
      );
    }

    throw mapSupabaseError(
      bulkUpdateError,
      "Impossible de mettre à jour les lignes."
    );
  }

  if (projection) {
    // Read the token and totals together: another committed mutation must not
    // pair its newer token with the totals calculated before this RPC.
    const { data: savedVersion, error: savedVersionError } = await supabase
      .from("estimate_versions")
      .select("id, updated_at, total_ht_cents, total_tax_cents, total_ttc_cents")
      .eq("tenant_id", tenantId)
      .eq("id", versionId)
      .single();
    if (savedVersionError || !savedVersion) {
      throw mapSupabaseError(savedVersionError, "Impossible de relire les totaux sauvegardés.");
    }
    return {
      updated_count: rpcUpdatedCount ?? 0,
      version: { id: savedVersion.id, updated_at: savedVersion.updated_at },
      totals: {
        total_ht_cents: savedVersion.total_ht_cents,
        total_tax_cents: savedVersion.total_tax_cents,
        total_ttc_cents: savedVersion.total_ttc_cents,
      },
    };
  }

  return {
    updated_count: rpcUpdatedCount ?? 0,
    version: await fetchEstimateVersionToken({ supabase, tenantId, versionId }),
  };
}
