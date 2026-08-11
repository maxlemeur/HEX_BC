import { z } from "zod";

import {
  readActiveTenantMembership,
  readAuthenticatedUser,
  type ServerSupabaseClient,
} from "@/lib/auth/tenant-context";
import {
  badRequest,
  forbidden,
  mapSupabaseError,
  notFound,
  ok,
  toErrorResponse,
  unauthorized,
} from "@/lib/memberships/errors";
import { tenantRoleSchema } from "@/lib/memberships/schemas";
import type { Database } from "@/types/database";

type Supabase = ServerSupabaseClient;
type TenantRole = Database["public"]["Enums"]["tenant_role"];
type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];
type TenantMembershipRow = Database["public"]["Tables"]["tenant_memberships"]["Row"];
type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "work_email" | "job_title"
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
  user_job_title: string | null;
};

const membershipSelect = "id, tenant_id, user_id, role, is_default, created_at, updated_at";

const membershipActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set-role"),
    membership_id: z.string().uuid("membership_id invalide."),
    role: tenantRoleSchema,
  }),
  z.object({
    action: z.literal("set-default"),
    membership_id: z.string().uuid("membership_id invalide."),
  }),
]);

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

function assertActorIsTenantAdmin(actorMembership: TenantMembershipRow) {
  if (actorMembership.role !== "admin") {
    throw forbidden("Acces reserve aux administrateurs du tenant.");
  }
}

async function getActorContext() {
  const { supabase, user, error: authError } = await readAuthenticatedUser();

  if (authError || !user) {
    throw unauthorized();
  }

  const { membership, error: membershipError } =
    await readActiveTenantMembership(supabase, user.id);

  if (membershipError) {
    throw mapSupabaseError(membershipError, "Impossible de charger le tenant courant.");
  }

  if (!membership) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return {
    supabase,
    userId: user.id,
    actorMembership: membership,
  };
}

async function getTenantOrThrow(supabase: Supabase, tenantId: string) {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, slug, is_active")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le tenant.");
  }

  if (!data) {
    throw notFound("Tenant introuvable.");
  }

  if (!data.is_active) {
    throw forbidden("Ce tenant est inactif.");
  }

  return data as Pick<TenantRow, "id" | "name" | "slug" | "is_active">;
}

async function listMembershipRowsForTenant(supabase: Supabase, tenantId: string) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select(membershipSelect)
    .eq("tenant_id", tenantId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les memberships.");
  }

  return (data ?? []) as TenantMembershipRow[];
}

async function getProfilesByUserIds(supabase: Supabase, userIds: string[]) {
  if (userIds.length === 0) {
    return [] as ProfileRow[];
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, work_email, job_title")
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
      user_job_title: profile?.job_title ?? null,
    } as MembershipRecord;
  });
}

async function getMembershipByIdForTenantOrThrow(
  supabase: Supabase,
  membershipId: string,
  tenantId: string
) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select(membershipSelect)
    .eq("id", membershipId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le membership cible.");
  }

  if (!data) {
    throw notFound("Membership introuvable pour le tenant courant.");
  }

  return data as TenantMembershipRow;
}

async function countTenantAdmins(supabase: Supabase, tenantId: string) {
  const { count, error } = await supabase
    .from("tenant_memberships")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("role", "admin");

  if (error) {
    throw mapSupabaseError(error, "Impossible de verifier les administrateurs du tenant.");
  }

  return count ?? 0;
}

async function loadSingleMembershipRecord(supabase: Supabase, membership: TenantMembershipRow) {
  const profiles = await getProfilesByUserIds(supabase, [membership.user_id]);
  return toMembershipRecords({ memberships: [membership], profiles })[0] ?? null;
}

async function setMembershipRole(input: {
  supabase: Supabase;
  actorMembership: TenantMembershipRow;
  membershipId: string;
  role: TenantRole;
}) {
  const targetMembership = await getMembershipByIdForTenantOrThrow(
    input.supabase,
    input.membershipId,
    input.actorMembership.tenant_id
  );

  if (targetMembership.role === "admin" && input.role !== "admin") {
    const adminCount = await countTenantAdmins(input.supabase, input.actorMembership.tenant_id);
    if (adminCount <= 1) {
      throw forbidden("Impossible de retirer le dernier administrateur du tenant.");
    }
  }

  const { data, error } = await input.supabase
    .from("tenant_memberships")
    .update({ role: input.role })
    .eq("id", targetMembership.id)
    .eq("tenant_id", input.actorMembership.tenant_id)
    .select(membershipSelect)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de mettre a jour le role du membership.");
  }

  if (!data) {
    throw notFound("Membership introuvable pour le tenant courant.");
  }

  const membership = await loadSingleMembershipRecord(input.supabase, data as TenantMembershipRow);

  return {
    membership,
  };
}

async function setMembershipAsDefault(input: {
  supabase: Supabase;
  userId: string;
  membershipId: string;
}) {
  const { error: switchError } = await input.supabase.rpc(
    "set_active_tenant_membership_default" as never,
    { p_membership_id: input.membershipId } as never
  );

  if (switchError) {
    if (switchError.message === "TENANT_DEFAULT_SWITCH_FORBIDDEN") {
      throw forbidden(
        "Impossible de changer le tenant par defaut depuis ce compte admin."
      );
    }

    throw mapSupabaseError(
      switchError,
      "Impossible de definir le tenant par defaut."
    );
  }

  const { data, error } = await input.supabase
    .from("tenant_memberships")
    .select(membershipSelect)
    .eq("id", input.membershipId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de relire le tenant par defaut.");
  }

  if (!data) {
    throw notFound("Membership cible introuvable.");
  }

  const membership = await loadSingleMembershipRecord(input.supabase, data as TenantMembershipRow);

  return {
    membership,
  };
}

export async function GET() {
  try {
    const { supabase, userId, actorMembership } = await getActorContext();
    assertActorIsTenantAdmin(actorMembership);

    const tenant = await getTenantOrThrow(supabase, actorMembership.tenant_id);
    const memberships = await listMembershipRowsForTenant(supabase, actorMembership.tenant_id);

    const profiles = await getProfilesByUserIds(
      supabase,
      memberships.map((membership) => membership.user_id)
    );

    return ok({
      tenant,
      current_user_id: userId,
      current_membership_id: actorMembership.id,
      memberships: toMembershipRecords({ memberships, profiles }),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = membershipActionSchema.parse(await parseJsonBody(request));
    const { supabase, userId, actorMembership } = await getActorContext();
    assertActorIsTenantAdmin(actorMembership);

    switch (payload.action) {
      case "set-role": {
        const data = await setMembershipRole({
          supabase,
          actorMembership,
          membershipId: payload.membership_id,
          role: payload.role,
        });
        return ok(data);
      }
      case "set-default": {
        const data = await setMembershipAsDefault({
          supabase,
          userId,
          membershipId: payload.membership_id,
        });
        return ok(data);
      }
      default:
        throw badRequest("Action memberships non supportee.");
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
