import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readActiveTenantMembership,
  readAuthenticatedUser,
} from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

import {
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "./errors";
import type {
  CreateMembershipInput,
  MembershipsListQueryInput,
  TenantRole,
  UpdateMembershipInput,
} from "./schemas";

type Supabase = SupabaseClient<Database>;

type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];
type TenantMembershipRow = Database["public"]["Tables"]["tenant_memberships"]["Row"];
type TenantMembershipInsert =
  Database["public"]["Tables"]["tenant_memberships"]["Insert"];
type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "work_email" | "role"
>;

type MembershipRecord = {
  id: string;
  user_id: string;
  role: TenantRole;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  user_full_name: string;
  user_work_email: string | null;
  user_legacy_role: ProfileRow["role"];
};

type CandidateRecord = {
  id: string;
  full_name: string;
  work_email: string | null;
  role: ProfileRow["role"];
};

const ADMIN_ROLE: TenantRole = "admin";

function sanitizeSearchTerm(value: string) {
  return value.replace(/[,%_()]/g, " ").trim();
}

async function getAuthenticatedContext() {
  const { supabase, user, error } = await readAuthenticatedUser();

  if (error || !user) {
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

  if (!membership) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return {
    supabase,
    userId: user.id,
    membership,
  };
}

function assertTenantAdmin(role: TenantRole) {
  if (role === ADMIN_ROLE) return;
  throw forbidden("Acces reserve aux administrateurs du tenant.");
}

async function getTenantOrThrow(supabase: Supabase, tenantId: string) {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, slug, is_active")
    .eq("id", tenantId)
    .single();

  if (error || !data) {
    throw notFound("Tenant introuvable.");
  }

  const tenant = data as Pick<TenantRow, "id" | "name" | "slug" | "is_active">;

  if (!tenant.is_active) {
    throw forbidden("Ce tenant est inactif.");
  }

  return tenant;
}

async function listMembershipRowsForTenant(supabase: Supabase, tenantId: string) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("id, tenant_id, user_id, role, is_default, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les memberships.");
  }

  return (data ?? []) as TenantMembershipRow[];
}

async function getProfilesByUserIds(supabase: Supabase, userIds: string[]) {
  if (userIds.length === 0) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, work_email, role")
    .in("id", userIds);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les profils utilisateur.");
  }

  return (data ?? []) as ProfileRow[];
}

function toMembershipRecords(input: {
  memberships: TenantMembershipRow[];
  profiles: ProfileRow[];
}) {
  const profileById = new Map<string, ProfileRow>();
  input.profiles.forEach((profile) => {
    profileById.set(profile.id, profile);
  });

  return input.memberships.map((membership) => {
    const profile = profileById.get(membership.user_id);

    return {
      id: membership.id,
      user_id: membership.user_id,
      role: membership.role,
      is_default: membership.is_default,
      created_at: membership.created_at,
      updated_at: membership.updated_at,
      user_full_name: profile?.full_name ?? "Utilisateur",
      user_work_email: profile?.work_email ?? null,
      user_legacy_role: profile?.role ?? "buyer",
    } as MembershipRecord;
  });
}

async function listCandidates(input: {
  tenantMemberships: TenantMembershipRow[];
  search: string | null | undefined;
}) {
  const normalizedSearch = sanitizeSearchTerm(input.search ?? "");
  if (normalizedSearch.length < 2) {
    return [] as CandidateRecord[];
  }

  const pattern = `%${normalizedSearch}%`;
  const directoryClient = createServiceRoleClient();
  const { data, error } = await directoryClient
    .from("profiles")
    .select("id, full_name, work_email, role")
    .or(`full_name.ilike.${pattern},work_email.ilike.${pattern}`)
    .order("full_name", { ascending: true })
    .limit(20);

  if (error) {
    throw mapSupabaseError(error, "Impossible de rechercher des utilisateurs.");
  }

  const existingIds = new Set(input.tenantMemberships.map((membership) => membership.user_id));

  return ((data ?? []) as ProfileRow[])
    .filter((profile) => !existingIds.has(profile.id))
    .map((profile) => ({
      id: profile.id,
      full_name: profile.full_name,
      work_email: profile.work_email,
      role: profile.role,
    }));
}

async function getMembershipByIdOrThrow(supabase: Supabase, membershipId: string) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("id, tenant_id, user_id, role, is_default, created_at, updated_at")
    .eq("id", membershipId)
    .single();

  if (error || !data) {
    throw notFound("Membership introuvable.");
  }

  return data as TenantMembershipRow;
}

async function countTenantAdmins(supabase: Supabase, tenantId: string) {
  const { count, error } = await supabase
    .from("tenant_memberships")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("role", ADMIN_ROLE);

  if (error) {
    throw mapSupabaseError(error, "Impossible de verifier les administrateurs du tenant.");
  }

  return count ?? 0;
}

async function mapMembershipWithProfile(supabase: Supabase, membership: TenantMembershipRow) {
  const profiles = await getProfilesByUserIds(supabase, [membership.user_id]);
  return toMembershipRecords({ memberships: [membership], profiles })[0] ?? null;
}

export async function listTenantMemberships(query: MembershipsListQueryInput) {
  const { supabase, userId, membership: actorMembership } =
    await getAuthenticatedContext();
  assertTenantAdmin(actorMembership.role);

  const tenant = await getTenantOrThrow(supabase, actorMembership.tenant_id);
  const memberships = await listMembershipRowsForTenant(supabase, actorMembership.tenant_id);

  const profiles = await getProfilesByUserIds(
    supabase,
    memberships.map((membership) => membership.user_id)
  );

  const candidates = await listCandidates({
    tenantMemberships: memberships,
    search: query.search,
  });

  return {
    tenant,
    current_user_id: userId,
    current_membership_role: actorMembership.role,
    memberships: toMembershipRecords({ memberships, profiles }),
    candidates,
  };
}

export async function createMembership(input: CreateMembershipInput) {
  const { supabase, membership: actorMembership } =
    await getAuthenticatedContext();
  assertTenantAdmin(actorMembership.role);

  const { data: existingMembership, error: existingMembershipError } = await supabase
    .from("tenant_memberships")
    .select("id")
    .eq("tenant_id", actorMembership.tenant_id)
    .eq("user_id", input.user_id)
    .maybeSingle();

  if (existingMembershipError) {
    throw mapSupabaseError(existingMembershipError, "Impossible de verifier le membership.");
  }

  if (existingMembership) {
    throw conflict("Cet utilisateur est deja membre de ce tenant.");
  }

  const directoryClient = createServiceRoleClient();
  const { data: profile, error: profileError } = await directoryClient
    .from("profiles")
    .select("id")
    .eq("id", input.user_id)
    .single();

  if (profileError || !profile) {
    throw notFound("Utilisateur introuvable.");
  }

  const { count: existingAnyMembershipCount, error: countError } = await supabase
    .from("tenant_memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.user_id);

  if (countError) {
    throw mapSupabaseError(countError, "Impossible de verifier les memberships existants.");
  }

  const payload: TenantMembershipInsert = {
    tenant_id: actorMembership.tenant_id,
    user_id: input.user_id,
    role: input.role,
    is_default: (existingAnyMembershipCount ?? 0) === 0,
  };

  const { data: created, error: createError } = await supabase
    .from("tenant_memberships")
    .insert(payload)
    .select("id, tenant_id, user_id, role, is_default, created_at, updated_at")
    .single();

  if (createError || !created) {
    if (createError) {
      throw mapSupabaseError(createError, "Impossible de creer le membership.");
    }
    throw conflict("Impossible de creer le membership.");
  }

  const membership = await mapMembershipWithProfile(supabase, created as TenantMembershipRow);

  return {
    membership,
  };
}

export async function updateMembership(membershipId: string, input: UpdateMembershipInput) {
  const { supabase, membership: actorMembership } =
    await getAuthenticatedContext();
  assertTenantAdmin(actorMembership.role);

  const targetMembership = await getMembershipByIdOrThrow(supabase, membershipId);

  if (targetMembership.tenant_id !== actorMembership.tenant_id) {
    throw forbidden("Vous ne pouvez pas modifier ce membership.");
  }

  const demotingAdmin =
    targetMembership.role === ADMIN_ROLE && input.role !== ADMIN_ROLE;

  if (demotingAdmin) {
    const adminCount = await countTenantAdmins(supabase, actorMembership.tenant_id);
    if (adminCount <= 1) {
      throw conflict("Impossible de retirer le dernier administrateur du tenant.");
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from("tenant_memberships")
    .update({ role: input.role })
    .eq("id", targetMembership.id)
    .select("id, tenant_id, user_id, role, is_default, created_at, updated_at")
    .single();

  if (updateError || !updated) {
    if (updateError) {
      throw mapSupabaseError(updateError, "Impossible de mettre a jour le membership.");
    }
    throw conflict("Impossible de mettre a jour le membership.");
  }

  const membership = await mapMembershipWithProfile(supabase, updated as TenantMembershipRow);

  return {
    membership,
  };
}

export async function deleteMembership(membershipId: string) {
  const { supabase, userId, membership: actorMembership } =
    await getAuthenticatedContext();
  assertTenantAdmin(actorMembership.role);

  const targetMembership = await getMembershipByIdOrThrow(supabase, membershipId);

  if (targetMembership.tenant_id !== actorMembership.tenant_id) {
    throw forbidden("Vous ne pouvez pas supprimer ce membership.");
  }

  if (targetMembership.user_id === userId) {
    throw conflict("Vous ne pouvez pas supprimer votre propre membership.");
  }

  if (targetMembership.role === ADMIN_ROLE) {
    const adminCount = await countTenantAdmins(supabase, actorMembership.tenant_id);
    if (adminCount <= 1) {
      throw conflict("Impossible de supprimer le dernier administrateur du tenant.");
    }
  }

  const { error } = await supabase
    .from("tenant_memberships")
    .delete()
    .eq("id", targetMembership.id);

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer le membership.");
  }

  return {
    deleted_id: targetMembership.id,
  };
}
