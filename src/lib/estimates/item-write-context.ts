import { badRequest, mapSupabaseError } from "@/lib/estimates/errors";
import { getFeatureFlagValueForTenant } from "@/lib/feature-flags";
import {
  ESTIMATE_ITEM_AID_REGEX_FEATURE_FLAG_KEY,
  parseEstimateItemAidRegexPattern,
} from "@/lib/estimates/schemas";
import { canAccessOwnerResource, type AuthenticatedContext } from "@/lib/estimates/server-context";
import type { Supabase } from "@/lib/estimates/item-write-types";

export async function resolveEstimateItemAidRegex(input: {
  tenantId: string;
  supabase: Supabase;
}) {
  const configuredPattern = await getFeatureFlagValueForTenant(
    input.tenantId,
    ESTIMATE_ITEM_AID_REGEX_FEATURE_FLAG_KEY,
    { supabase: input.supabase }
  );

  return parseEstimateItemAidRegexPattern(configuredPattern);
}

export async function fetchEstimateVersionToken(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_versions")
    .select("id, updated_at")
    .eq("id", input.versionId)
    .eq("tenant_id", input.tenantId)
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de récupérer le jeton de version."
      );
    }

    throw badRequest("Impossible de récupérer le jeton de version.");
  }

  return data;
}

export async function getNextItemPosition(
  supabase: Supabase,
  versionId: string,
  parentId: string | null
) {
  let query = supabase
    .from("estimate_items")
    .select("position")
    .eq("version_id", versionId)
    .order("position", { ascending: false })
    .limit(1);

  query = parentId === null ? query.is("parent_id", null) : query.eq("parent_id", parentId);

  const { data, error } = await query;

  if (error) {
    throw mapSupabaseError(error, "Impossible de déterminer la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

export async function ensureSupplyTypeIsValid(
  supabase: Supabase,
  supplyTypeId: string | null,
  context: Pick<AuthenticatedContext, "tenantId">
) {
  if (supplyTypeId === null) return;

  const { data, error } = await supabase
    .from("supply_types")
    .select("id, tenant_id")
    .eq("id", supplyTypeId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw badRequest("supply_type_id invalide.");
  }
}

export async function ensureSupplierPriceIsValid(
  supabase: Supabase,
  supplierPriceId: string | null,
  context: Pick<AuthenticatedContext, "tenantId">
) {
  if (supplierPriceId === null) return;

  const { data, error } = await supabase
    .from("supplier_pricebook")
    .select("id, tenant_id")
    .eq("id", supplierPriceId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw badRequest("selected_supplier_price_id invalide.");
  }
}

export async function ensureProductIsValid(
  supabase: Supabase,
  productId: string | null,
  context: Pick<AuthenticatedContext, "tenantId">
) {
  if (productId === null) return;

  const { data, error } = await supabase
    .from("products")
    .select("id, tenant_id")
    .eq("id", productId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw badRequest("product_id invalide.");
  }
}

export async function resolveLaborRateCents(
  supabase: Supabase,
  laborRoleId: string | null,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (laborRoleId === null) return 0;
  if (
    !canAccessOwnerResource({
      context,
      resourceUserId: ownerUserId,
    })
  ) {
    throw badRequest("labor_role_id invalide.");
  }

  const { data, error } = await supabase
    .from("labor_roles")
    .select("id, tenant_id, user_id, hourly_rate_cents")
    .eq("id", laborRoleId)
    .eq("tenant_id", context.tenantId)
    .eq("user_id", ownerUserId)
    .single();

  if (
    error ||
    !data ||
    !canAccessOwnerResource({
      context,
      resourceUserId: data.user_id,
    })
  ) {
    throw badRequest("labor_role_id invalide.");
  }

  return data.hourly_rate_cents;
}
