import type {
  AuthError,
  PostgrestError,
  SupabaseClient,
  User,
} from "@supabase/supabase-js";
import { cache } from "react";

import {
  badRequest,
  forbidden,
  mapSupabaseError,
  unauthorized,
} from "@/lib/http/api-response";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type ServerSupabaseClient = SupabaseClient<Database>;
export type TenantRole = Database["public"]["Enums"]["tenant_role"];
export type ActiveTenantMembership = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "id" | "tenant_id" | "user_id" | "role" | "is_default" | "created_at" | "updated_at"
>;

type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "user_id" | "role"
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
  /** Name of the active tenant, read with the membership for the dashboard shell. */
  tenantName: string | null;
  error: PostgrestError | null;
};

/**
 * Low-level authentication lookup for modules that still own their HTTP error
 * contract. Authentication policy lives here; error presentation stays local.
 */
// React clears this memoization for every server request. Repeated RSC readers
// share the authenticated lookup; there is no process-wide user/tenant cache.
export const readAuthenticatedUser = cache(async (cookieMode?: "route"): Promise<AuthenticatedUserLookup> => {
  const supabase = cookieMode
    ? await createSupabaseServerClient(cookieMode)
    : await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return { supabase, user, error };
});

/**
 * Resolves the same active membership as public.current_tenant_id(): default
 * membership first, then oldest membership, while excluding inactive tenants.
 */
export const readActiveTenantMembership = cache(async (
  supabase: ServerSupabaseClient,
  userId: string
): Promise<ActiveTenantMembershipLookup> => {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select(
      "id, tenant_id, user_id, role, is_default, created_at, updated_at, tenants!inner(is_active, name)"
    )
    .eq("user_id", userId)
    .eq("tenants.is_active", true)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);
  const row = data?.[0] as unknown as
    | (ActiveTenantMembership & { tenants?: { name?: string | null } | null })
    | undefined;

  return {
    membership: row ?? null,
    tenantName: row?.tenants?.name?.trim() || null,
    error,
  };
});

/**
 * Canonical strict boundary for authenticated tenant-scoped server workflows.
 */
export const getAuthenticatedTenantContext = cache(async (): Promise<AuthenticatedTenantContext> => {
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
});

export { getAuthenticatedTenantContext as getAuthenticatedContext };

/**
 * Authenticated user and active tenant for the tenant settings routes (feature
 * flags, currency rates). Unlike getAuthenticatedTenantContext, a failed
 * membership read is a 400 and a user without tenant a 401.
 */
export async function getTenantSettingsActorContext() {
  const { supabase, user, error } = await readAuthenticatedUser();

  if (error || !user) {
    throw unauthorized();
  }

  const { membership, error: membershipError } =
    await readActiveTenantMembership(supabase, user.id);

  if (membershipError) {
    throw badRequest("Impossible de charger le tenant courant.");
  }

  const defaultTenantId = membership?.tenant_id ?? null;

  if (!defaultTenantId) {
    throw unauthorized();
  }

  return {
    supabase,
    userId: user.id,
    defaultTenantId,
  };
}

/** The user's membership of a given tenant (any role); 403 when there is none. */
export async function getTenantMembershipOrThrow(
  supabase: ServerSupabaseClient,
  tenantId: string,
  userId: string
): Promise<TenantMembershipRow> {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, user_id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de vérifier le tenant courant.");
  }

  if (!data) {
    throw forbidden("Aucun accès à ce tenant.");
  }

  return data as TenantMembershipRow;
}
