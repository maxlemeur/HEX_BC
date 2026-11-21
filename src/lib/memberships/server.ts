import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readActiveTenantMembership,
  readAuthenticatedUser,
} from "@/lib/auth/tenant-context";
import { removeMemberDriveConnection } from "@/lib/affaires/google-drive/connections";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";
import { membershipCandidateEmailSchema } from "./schemas";

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
  "id" | "full_name" | "work_email" | "role" | "job_title"
>;

type CandidateRecord = {
  id: string;
  email: string;
};

const ADMIN_ROLE: TenantRole = "admin";
const MEMBERSHIP_COLUMNS = "id, tenant_id, user_id, role, is_default, created_at, updated_at";
const LAST_ADMIN = "Impossible de retirer le dernier administrateur de l’organisation.";
const ACTIVE_MEMBER_NOT_FOUND = "Membre introuvable dans l’organisation active.";

type MembershipSurface = "directory" | "tenant-settings";

async function getAdminContext() {
  const { supabase, user, error } = await readAuthenticatedUser();

  if (error || !user) {
    throw unauthorized();
  }

  const { membership, error: membershipError } =
    await readActiveTenantMembership(supabase, user.id);

  if (membershipError) {
    throw mapSupabaseError(
      membershipError,
      "Impossible de charger l’organisation active."
    );
  }

  if (!membership) {
    throw forbidden("Aucune organisation active pour cet utilisateur.");
  }

  if (membership.role !== ADMIN_ROLE) {
    throw forbidden("Accès réservé aux administrateurs de l’organisation.");
  }

  return {
    supabase,
    userId: user.id,
    membership,
  };
}

async function getTenantOrThrow(supabase: Supabase, tenantId: string, surface: MembershipSurface) {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, slug, is_active")
    .eq("id", tenantId)
    .maybeSingle();
  if (error && surface === "tenant-settings") {
    throw mapSupabaseError(error, "Impossible de charger l’organisation.");
  }

  if (error || !data) {
    throw notFound("Organisation introuvable.");
  }

  const tenant = data as Pick<TenantRow, "id" | "name" | "slug" | "is_active">;

  if (!tenant.is_active) {
    throw forbidden("Cette organisation est inactive.");
  }

  return tenant;
}

async function listMembershipRowsForTenant(supabase: Supabase, tenantId: string) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select(MEMBERSHIP_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les membres de l’organisation.");
  }

  return (data ?? []) as TenantMembershipRow[];
}

async function getProfilesByUserIds(supabase: Supabase, userIds: string[]) {
  if (userIds.length === 0) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, work_email, role, job_title")
    .in("id", userIds);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les profils utilisateur.");
  }

  return (data ?? []) as ProfileRow[];
}

function membershipFields(membership: TenantMembershipRow, profile: ProfileRow | undefined) {
  return {
    id: membership.id,
    user_id: membership.user_id,
    role: membership.role,
    is_default: membership.is_default,
    created_at: membership.created_at,
    updated_at: membership.updated_at,
    user_full_name: profile?.full_name ?? "Utilisateur",
    user_work_email: profile?.work_email ?? null,
  };
}

function directoryRecord(membership: TenantMembershipRow, profile: ProfileRow | undefined) {
  return { ...membershipFields(membership, profile), user_legacy_role: profile?.role ?? "buyer" };
}

function tenantSettingsRecord(membership: TenantMembershipRow, profile: ProfileRow | undefined) {
  return { ...membershipFields(membership, profile), user_job_title: profile?.job_title ?? null };
}

async function listCandidates(input: {
  actorUserId: string;
  search: string | null | undefined;
}) {
  const email = membershipCandidateEmailSchema.safeParse(input.search?.trim().toLowerCase());
  if (!email.success) {
    return [] as CandidateRecord[];
  }

  const directoryClient = createServiceRoleClient();
  const { data, error } = await directoryClient
    .rpc("find_membership_candidate_by_email", {
      p_actor_user_id: input.actorUserId,
      p_email: email.data,
    });

  if (error) {
    throw mapSupabaseError(error, "Impossible de rechercher des utilisateurs.");
  }

  return (data ?? []) as CandidateRecord[];
}

async function getMembershipByIdOrThrow(supabase: Supabase, membershipId: string) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select(MEMBERSHIP_COLUMNS)
    .eq("id", membershipId)
    .single();

  if (error || !data) {
    throw notFound("Membre introuvable.");
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
    throw mapSupabaseError(error, "Impossible de vérifier les administrateurs de l’organisation.");
  }

  return count ?? 0;
}

async function readMemberProfile(supabase: Supabase, userId: string) {
  const profiles = await getProfilesByUserIds(supabase, [userId]);
  return profiles.find((profile) => profile.id === userId);
}

async function readMembershipDirectory(surface: MembershipSurface) {
  const { supabase, userId, membership: actor } = await getAdminContext();
  const tenant = await getTenantOrThrow(supabase, actor.tenant_id, surface);
  const memberships = await listMembershipRowsForTenant(supabase, actor.tenant_id);
  const profiles = await getProfilesByUserIds(
    supabase,
    memberships.map((membership) => membership.user_id)
  );
  return { tenant, userId, actor, memberships, profiles: new Map(profiles.map((profile) => [profile.id, profile])) };
}

export async function listTenantMemberships(query: MembershipsListQueryInput) {
  const { tenant, userId, actor, memberships, profiles } = await readMembershipDirectory("directory");
  const candidates = await listCandidates({ actorUserId: userId, search: query.search });
  return {
    tenant,
    current_user_id: userId,
    current_membership_role: actor.role,
    memberships: memberships.map((membership) => directoryRecord(membership, profiles.get(membership.user_id))),
    candidates,
  };
}

export async function listTenantSettingsMemberships() {
  const { tenant, userId, actor, memberships, profiles } = await readMembershipDirectory("tenant-settings");
  return {
    tenant,
    current_user_id: userId,
    current_membership_id: actor.id,
    memberships: memberships.map((membership) => tenantSettingsRecord(membership, profiles.get(membership.user_id))),
  };
}

export async function createMembership(input: CreateMembershipInput) {
  const { supabase, membership: actorMembership } =
    await getAdminContext();

  const { data: existingMembership, error: existingMembershipError } = await supabase
    .from("tenant_memberships")
    .select("id")
    .eq("tenant_id", actorMembership.tenant_id)
    .eq("user_id", input.user_id)
    .maybeSingle();

  if (existingMembershipError) {
    throw mapSupabaseError(existingMembershipError, "Impossible de vérifier si l’utilisateur est déjà membre.");
  }

  if (existingMembership) {
    throw conflict("Cet utilisateur est déjà membre de cette organisation.");
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

  // The actor's RLS view intentionally hides memberships in other tenants.
  // Count through the already authorized server client to preserve their default.
  const { count: existingAnyMembershipCount, error: countError } = await directoryClient
    .from("tenant_memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.user_id);

  if (countError) {
    throw mapSupabaseError(countError, "Impossible de vérifier les membres existants.");
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
    .select(MEMBERSHIP_COLUMNS)
    .single();

  if (createError || !created) {
    if (createError) {
      throw mapSupabaseError(createError, "Impossible d’ajouter le membre.");
    }
    throw conflict("Impossible d’ajouter le membre.");
  }

  return { membership: directoryRecord(created, await readMemberProfile(supabase, created.user_id)) };
}

async function assertCanRemoveAdmin(supabase: Supabase, membership: TenantMembershipRow, surface: MembershipSurface) {
  if (membership.role === ADMIN_ROLE && await countTenantAdmins(supabase, membership.tenant_id) <= 1) {
    throw surface === "tenant-settings" ? forbidden(LAST_ADMIN) : conflict(LAST_ADMIN);
  }
}

async function writeMembershipRole(
  supabase: Supabase,
  target: TenantMembershipRow,
  role: TenantRole,
  surface: MembershipSurface
) {
  if (role !== ADMIN_ROLE) await assertCanRemoveAdmin(supabase, target, surface);
  const update = supabase
    .from("tenant_memberships")
    .update({ role })
    .eq("id", target.id)
    .eq("tenant_id", target.tenant_id)
    .select(MEMBERSHIP_COLUMNS);
  const { data, error } = surface === "tenant-settings" ? await update.maybeSingle() : await update.single();

  if (error) throw mapSupabaseError(error, surface === "tenant-settings"
    ? "Impossible de mettre à jour le rôle du membre."
    : "Impossible de mettre à jour le membre.");
  if (!data) {
    if (surface === "tenant-settings") throw notFound(ACTIVE_MEMBER_NOT_FOUND);
    throw conflict("Impossible de mettre à jour le membre.");
  }
  return data;
}

export async function updateMembership(membershipId: string, input: UpdateMembershipInput) {
  const { supabase, membership: actor } = await getAdminContext();
  const target = await getMembershipByIdOrThrow(supabase, membershipId);
  if (target.tenant_id !== actor.tenant_id) throw forbidden("Vous ne pouvez pas modifier ce membre.");
  const updated = await writeMembershipRole(supabase, target, input.role, "directory");
  return { membership: directoryRecord(updated, await readMemberProfile(supabase, updated.user_id)) };
}

export async function updateTenantSettingsMembershipRole(membershipId: string, role: TenantRole) {
  const { supabase, membership: actor } = await getAdminContext();
  const { data, error } = await supabase.from("tenant_memberships")
    .select(MEMBERSHIP_COLUMNS)
    .eq("id", membershipId)
    .eq("tenant_id", actor.tenant_id)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger le membre ciblé.");
  if (!data) throw notFound(ACTIVE_MEMBER_NOT_FOUND);

  const updated = await writeMembershipRole(supabase, data, role, "tenant-settings");
  return { membership: tenantSettingsRecord(updated, await readMemberProfile(supabase, updated.user_id)) };
}

export async function setDefaultMembership(membershipId: string) {
  const { supabase, userId } = await getAdminContext();
  const { error: switchError } = await supabase.rpc("set_active_tenant_membership_default", {
    p_membership_id: membershipId,
  });
  if (switchError?.message === "TENANT_DEFAULT_SWITCH_FORBIDDEN") {
    throw forbidden("Impossible de changer l’organisation par défaut depuis ce compte administrateur.");
  }
  if (switchError) throw mapSupabaseError(switchError, "Impossible de définir l’organisation par défaut.");

  const { data, error } = await supabase.from("tenant_memberships")
    .select(MEMBERSHIP_COLUMNS)
    .eq("id", membershipId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de relire l’organisation par défaut.");
  if (!data) throw notFound("Accès à l’organisation introuvable.");
  return { membership: tenantSettingsRecord(data, await readMemberProfile(supabase, data.user_id)) };
}

export async function deleteMembership(membershipId: string) {
  const { supabase, userId, membership: actorMembership } =
    await getAdminContext();

  const targetMembership = await getMembershipByIdOrThrow(supabase, membershipId);

  if (targetMembership.tenant_id !== actorMembership.tenant_id) {
    throw forbidden("Vous ne pouvez pas retirer ce membre.");
  }

  if (targetMembership.user_id === userId) {
    throw conflict("Vous ne pouvez pas vous retirer vous-même de l’organisation.");
  }

  await assertCanRemoveAdmin(supabase, targetMembership, "directory");

  await removeMemberDriveConnection(
    { tenantId: targetMembership.tenant_id, userId: targetMembership.user_id },
    async () => {
      const { error } = await supabase
        .from("tenant_memberships")
        .delete()
        .eq("id", targetMembership.id);

      if (error) {
        throw mapSupabaseError(error, "Impossible de retirer le membre.");
      }
    }
  );

  return {
    deleted_id: targetMembership.id,
  };
}
