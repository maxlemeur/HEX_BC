import type { SupabaseClient } from "@supabase/supabase-js";

import {
  badRequest,
  forbidden,
  mapSupabaseError,
} from "@/lib/estimates/errors";
import {
  canAccessOwnerResource,
  type AuthenticatedContext,
} from "@/lib/estimates/server-context";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;

export async function ensureCategoryIsValid(
  supabase: Supabase,
  categoryId: string | null,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (categoryId === null) return;
  if (
    !canAccessOwnerResource({
      context,
      resourceUserId: ownerUserId,
    })
  ) {
    throw badRequest("category_id invalide.");
  }

  const { data, error } = await supabase
    .from("estimate_categories")
    .select("id, tenant_id, user_id")
    .eq("id", categoryId)
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
    throw badRequest("category_id invalide.");
  }
}

export async function ensureLaborRoleIsValid(
  supabase: Supabase,
  laborRoleId: string | null,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (laborRoleId === null) return;
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
    .select("id, tenant_id, user_id")
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
}

export async function getNextCategoryPosition(
  supabase: Supabase,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (
    !canAccessOwnerResource({
      context,
      resourceUserId: ownerUserId,
    })
  ) {
    throw forbidden("Acces interdit aux ressources de cet utilisateur.");
  }

  const { data, error } = await supabase
    .from("estimate_categories")
    .select("position")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", ownerUserId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

export async function getNextLaborRolePosition(
  supabase: Supabase,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (
    !canAccessOwnerResource({
      context,
      resourceUserId: ownerUserId,
    })
  ) {
    throw forbidden("Acces interdit aux ressources de cet utilisateur.");
  }

  const { data, error } = await supabase
    .from("labor_roles")
    .select("position")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", ownerUserId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

export async function getNextSuggestionRulePosition(
  supabase: Supabase,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (
    !canAccessOwnerResource({
      context,
      resourceUserId: ownerUserId,
    })
  ) {
    throw forbidden("Acces interdit aux ressources de cet utilisateur.");
  }

  const { data, error } = await supabase
    .from("estimate_suggestion_rules")
    .select("position")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", ownerUserId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}
