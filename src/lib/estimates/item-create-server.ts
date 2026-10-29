import { prepareEstimateItemCreation } from "@/lib/estimates/item-create-plan";
import { DEFAULT_MAX_SECTION_DEPTH, clampMaxSectionDepth } from "@/lib/estimates/hierarchy";
import { conflict } from "@/lib/estimates/errors";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";
import { assertVersionConcurrencyToken } from "@/lib/estimates/version-concurrency";
import {
  getNextItemPosition,
  resolveEstimateItemAidRegex,
  ensureSupplyTypeIsValid,
  ensureSupplierPriceIsValid,
  ensureProductIsValid,
  resolveLaborRateCents,
} from "@/lib/estimates/item-write-context";
import {
  ensureParentIsValid,
  resolveSectionLevelFromParent,
} from "@/lib/estimates/estimate-placement-helpers";
import { ensureCategoryIsValid } from "@/lib/estimates/estimate-reference-helpers";
import { randomUUID } from "node:crypto";
import { persistAtomicEstimateItem } from "@/lib/estimates/atomic-item-creation";
import { normalizeStoredItemNumerics } from "@/lib/estimates/stored-item-numeric";

import { assertEstimateItemAidFormat } from "@/lib/estimates/item-update-plan";

import { normalizeEstimateItemAid, type CreateEstimateItemInput } from "@/lib/estimates/schemas";

import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";

export async function createEstimateItem(
  versionId: string,
  input: CreateEstimateItemInput,
  concurrencyToken?: string,
  options?: { draftLockSessionId: string }
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );

  assertCanWriteEstimateWorkflows(context.tenantRole);
  assertDraftStatus(version.status);
  if (concurrencyToken !== undefined) {
    assertVersionConcurrencyToken(version.updated_at, concurrencyToken);
  }
  const draftLock = await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
    draftLockSessionId: options?.draftLockSessionId,
  });
  if (!draftLock.session_id) {
    throw conflict("Un verrou actif de cette page est requis.", undefined, "LOCK_REQUIRED");
  }
  const draftLockSessionId = draftLock.session_id;
  input = normalizeStoredItemNumerics(input);
  const persist = (item: Parameters<typeof persistAtomicEstimateItem>[0]["item"]) =>
    persistAtomicEstimateItem({
      supabase, tenantId, projectUserId: project.user_id, versionId,
      expectedUpdatedAt: version.updated_at,
      draftLockSessionId,
      item,
    });

  const parentId = input.parent_id ?? null;
  const parent = await ensureParentIsValid({
    supabase,
    tenantId,
    versionId,
    parentId,
  });
  const maxSectionDepth = clampMaxSectionDepth(
    version.max_section_depth,
    DEFAULT_MAX_SECTION_DEPTH
  );
  const parentSectionLevel = await resolveSectionLevelFromParent({
    supabase,
    tenantId,
    versionId,
    parent,
  });

  const position = input.position ?? (await getNextItemPosition(supabase, versionId, parentId));
  const aidRegex = await resolveEstimateItemAidRegex({ tenantId, supabase });
  const aid = normalizeEstimateItemAid(input.aid);

  assertEstimateItemAidFormat({
    aid,
    aidRegex,
  });
  const item = prepareEstimateItemCreation({
    input, id: randomUUID(), parentId, position, aid,
    parentSectionLevel, maxSectionDepth, versionTaxRateBp: version.tax_rate_bp,
  });
  if (item.item_type === "line") {
    await Promise.all([
      ensureCategoryIsValid(supabase, item.category_id ?? null, context, project.user_id),
      ensureSupplyTypeIsValid(supabase, item.supply_type_id ?? null, context),
      ensureProductIsValid(supabase, item.product_id ?? null, context),
      ensureSupplierPriceIsValid(supabase, item.selected_supplier_price_id ?? null, context),
      resolveLaborRateCents(supabase, item.labor_role_id ?? null, context, project.user_id),
      resolveLaborRateCents(supabase, item.labor_role_atelier_id ?? null, context, project.user_id),
      resolveLaborRateCents(supabase, item.labor_role_chantier_id ?? null, context, project.user_id),
    ]);
  }
  return persist(item);
}
