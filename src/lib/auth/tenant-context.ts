import type {
  AuthError,
  PostgrestError,
  SupabaseClient,
  User,
} from "@supabase/supabase-js";

import {
  forbidden,
  mapSupabaseError,
  unauthorized,
} from "@/lib/estimates/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type ServerSupabaseClient = SupabaseClient<Database>;
export type TenantRole = Database["public"]["Enums"]["tenant_role"];
export type ActiveTenantMembership = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "id" | "tenant_id" | "user_id" | "role" | "is_default" | "created_at" | "updated_at"
>;

export type AuthenticatedTenantContext = {
  supabase: ServerSupabaseClient;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
  isTenantAdmin: boolean;
  membership: ActiveTenantMembership;
};

type AuthenticatedUserLookup = {
  supabase: ServerSupabaseClient;
  user: User | null;
  error: AuthError | null;
};

type ActiveTenantMembershipLookup = {
  membership: ActiveTenantMembership | null;
  error: PostgrestError | null;
};

/**
 * Low-level authentication lookup for modules that still own their HTTP error
 * contract. Authentication policy lives here; error presentation stays local.
 */
export async function readAuthenticatedUser(): Promise<AuthenticatedUserLookup> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { supabase, user, error };
}

/**
 * Resolves the same active membership as public.current_tenant_id(): default
 * membership first, then oldest membership, while excluding inactive tenants.
 */
export async function readActiveTenantMembership(
  supabase: ServerSupabaseClient,
  userId: string
): Promise<ActiveTenantMembershipLookup> {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select(
      "id, tenant_id, user_id, role, is_default, created_at, updated_at, tenants!inner(is_active)"
    )
    .eq("user_id", userId)
    .eq("tenants.is_active", true)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  return {
    membership: (data?.[0] as unknown as ActiveTenantMembership | undefined) ?? null,
    error,
  };
}

/**
 * Canonical strict boundary for authenticated tenant-scoped server workflows.
 */
export async function getAuthenticatedTenantContext(): Promise<AuthenticatedTenantContext> {
  const { supabase, user, error: userError } = await readAuthenticatedUser();

  if (userError || !user) {
    throw unauthorized();
  }

  const { membership, error: membershipError } =
    await readActiveTenantMembership(supabase, user.id);

  if (membershipError) {
    throw mapSupabaseError(
      membershipError,
      "Impossible de charger le tenant courant."
    );
  }

  if (!membership?.tenant_id || !membership.role) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    tenantRole: membership.role,
    isTenantAdmin: membership.role === "admin",
    membership,
  };
}

export { getAuthenticatedTenantContext as getAuthenticatedContext };
