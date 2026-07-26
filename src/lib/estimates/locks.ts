import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import {
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "./errors";

type Supabase = SupabaseClient<Database>;
type TenantRole = Database["public"]["Enums"]["tenant_role"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type DraftLockRow = Database["public"]["Tables"]["draft_locks"]["Row"];
type DraftLockInsert = Database["public"]["Tables"]["draft_locks"]["Insert"];
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role" | "is_default" | "created_at"
>;
type EmbeddedProjectAccess = Pick<
  Database["public"]["Tables"]["estimate_projects"]["Row"],
  "tenant_id" | "user_id"
>;
type VersionAccessRow = Pick<
  Database["public"]["Tables"]["estimate_versions"]["Row"],
  "id" | "tenant_id" | "status"
> & {
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};
type ProfileOwnerRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "work_email"
>;

type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
};

const DRAFT_LOCK_TTL_MINUTES = 30;
const TENANT_ADMIN_ROLE: TenantRole = "admin";

type LockOwner = {
  id: string;
  full_name: string | null;
  work_email: string | null;
};

export type DraftLock = {
  id: string;
  version_id: string;
  tenant_id: string;
  user_id: string;
  locked_at: string;
  expires_at: string;
  is_current_user: boolean;
  is_expired: boolean;
  owner: LockOwner | null;
};

export type AcquireDraftLockResult = {
  lock: DraftLock;
};

export type RenewDraftLockResult = {
  lock: DraftLock;
};

export type ReleaseDraftLockResult = {
  released: boolean;
  lock: DraftLock | null;
};

export type GetDraftLockInfoResult = {
  lock: DraftLock | null;
};

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function isTenantAdmin(tenantRole: TenantRole) {
  return tenantRole === TENANT_ADMIN_ROLE;
}

function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    isTenantAdmin(input.context.tenantRole)
  );
}

function isDraftStatus(status: EstimateStatus) {
  return status === "draft";
}

function assertDraftStatus(status: EstimateStatus) {
  if (isDraftStatus(status)) return;
  throw forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY");
}

function toLockExpiryIsoDate() {
  return new Date(Date.now() + DRAFT_LOCK_TTL_MINUTES * 60 * 1000).toISOString();
}

function isExpiredLock(expiresAt: string) {
  const expiresTimestamp = Date.parse(expiresAt);
  if (!Number.isFinite(expiresTimestamp)) return false;
  return expiresTimestamp <= Date.now();
}

function isUniqueLockError(error: PostgrestError) {
  const normalizedMessage = (error.message ?? "").toLowerCase();
  return (
    error.code === "23505" ||
    normalizedMessage.includes("duplicate key") ||
    normalizedMessage.includes("unique")
  );
}

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw mapSupabaseError(membershipError, "Impossible de charger le tenant courant.");
  }

  const membership = memberships?.[0] as TenantMembershipRow | undefined;

  if (!membership?.tenant_id || !membership.role) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    tenantRole: membership.role,
  };
}

async function assertVersionAccessOrThrow(
  context: AuthenticatedContext,
  versionId: string,
  options: {
    requireDraft: boolean;
  }
) {
  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select("id, tenant_id, status, estimate_projects!inner(tenant_id, user_id)")
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const version = data as unknown as VersionAccessRow;
  const project = resolveEmbeddedOne(version.estimate_projects);

  if (
    !project ||
    project.tenant_id !== context.tenantId ||
    !canAccessOwnerResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Version de chiffrage introuvable.");
  }

  if (options.requireDraft) {
    assertDraftStatus(version.status);
  }
}

async function cleanupExpiredLocks(context: AuthenticatedContext) {
  const { error } = await context.supabase.rpc("cleanup_expired_draft_locks", {
    target_tenant_id: context.tenantId,
  });

  if (error) {
    throw mapSupabaseError(error, "Impossible de nettoyer les verrous expires.");
  }
}

async function getLockRowByVersionId(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("draft_locks")
    .select("id, version_id, user_id, tenant_id, locked_at, expires_at, created_at")
    .eq("version_id", input.versionId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le verrou de brouillon.");
  }

  return data as DraftLockRow | null;
}

async function getLockOwnerById(supabase: Supabase, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, work_email")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as ProfileOwnerRow;
}

async function toDraftLock(input: {
  supabase: Supabase;
  row: DraftLockRow;
  currentUserId: string;
}): Promise<DraftLock> {
  const owner = await getLockOwnerById(input.supabase, input.row.user_id);

  return {
    id: input.row.id,
    version_id: input.row.version_id,
    tenant_id: input.row.tenant_id,
    user_id: input.row.user_id,
    locked_at: input.row.locked_at,
    expires_at: input.row.expires_at,
    is_current_user: input.row.user_id === input.currentUserId,
    is_expired: isExpiredLock(input.row.expires_at),
    owner: owner
      ? {
          id: owner.id,
          full_name: owner.full_name,
          work_email: owner.work_email,
        }
      : null,
  };
}

async function getDraftLockInfoInternal(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const lockRow = await getLockRowByVersionId({
    supabase: input.context.supabase,
    tenantId: input.context.tenantId,
    versionId: input.versionId,
  });

  if (!lockRow) {
    return null;
  }

  return toDraftLock({
    supabase: input.context.supabase,
    row: lockRow,
    currentUserId: input.context.userId,
  });
}

async function renewLockInternal(
  context: AuthenticatedContext,
  versionId: string,
  options: {
    force: boolean;
    requireDraftCheck: boolean;
  }
): Promise<RenewDraftLockResult> {
  if (options.force && !isTenantAdmin(context.tenantRole)) {
    throw forbidden("Seuls les admins peuvent forcer le verrou de brouillon.");
  }

  if (options.requireDraftCheck) {
    await assertVersionAccessOrThrow(context, versionId, { requireDraft: true });
  }

  let query = context.supabase
    .from("draft_locks")
    .update({
      expires_at: toLockExpiryIsoDate(),
    })
    .eq("version_id", versionId)
    .eq("tenant_id", context.tenantId);

  if (!options.force) {
    query = query.eq("user_id", context.userId);
  }

  const { data, error } = await query
    .select("id, version_id, user_id, tenant_id, locked_at, expires_at, created_at")
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de renouveler le verrou de brouillon.");
  }

  const lockRow = data as DraftLockRow | null;

  if (lockRow) {
    const lock = await toDraftLock({
      supabase: context.supabase,
      row: lockRow,
      currentUserId: context.userId,
    });

    return {
      lock,
    };
  }

  const existingLock = await getDraftLockInfoInternal({
    context,
    versionId,
  });

  if (existingLock && !options.force && existingLock.user_id !== context.userId) {
    throw conflict(
      "Cette version est déjà verrouillée par un autre utilisateur.",
      {
        lock: existingLock,
      }
    );
  }

  throw notFound("Aucun verrou actif pour cette version.");
}

async function releaseLockInternal(
  context: AuthenticatedContext,
  versionId: string,
  options: {
    force: boolean;
  }
): Promise<ReleaseDraftLockResult> {
  if (options.force && !isTenantAdmin(context.tenantRole)) {
    throw forbidden("Seuls les admins peuvent forcer le deverrouillage.");
  }

  await assertVersionAccessOrThrow(context, versionId, { requireDraft: false });

  let query = context.supabase
    .from("draft_locks")
    .delete()
    .eq("version_id", versionId)
    .eq("tenant_id", context.tenantId);

  if (!options.force) {
    query = query.eq("user_id", context.userId);
  }

  const { data, error } = await query
    .select("id, version_id, user_id, tenant_id, locked_at, expires_at, created_at")
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de liberer le verrou de brouillon.");
  }

  const lockRow = data as DraftLockRow | null;

  if (lockRow) {
    const lock = await toDraftLock({
      supabase: context.supabase,
      row: lockRow,
      currentUserId: context.userId,
    });

    return {
      released: true,
      lock,
    };
  }

  const existingLock = await getDraftLockInfoInternal({
    context,
    versionId,
  });

  if (existingLock && !options.force && existingLock.user_id !== context.userId) {
    throw conflict(
      "Cette version est déjà verrouillée par un autre utilisateur.",
      {
        lock: existingLock,
      }
    );
  }

  return {
    released: false,
    lock: existingLock,
  };
}

export async function getLockInfo(versionId: string): Promise<GetDraftLockInfoResult> {
  const context = await getAuthenticatedContext();

  await assertVersionAccessOrThrow(context, versionId, { requireDraft: false });

  const lock = await getDraftLockInfoInternal({
    context,
    versionId,
  });

  return {
    lock,
  };
}

export async function acquireLock(versionId: string): Promise<AcquireDraftLockResult> {
  const context = await getAuthenticatedContext();

  await assertVersionAccessOrThrow(context, versionId, { requireDraft: true });
  await cleanupExpiredLocks(context);

  const payload: DraftLockInsert = {
    version_id: versionId,
    user_id: context.userId,
    tenant_id: context.tenantId,
    expires_at: toLockExpiryIsoDate(),
  };

  const { data, error } = await context.supabase
    .from("draft_locks")
    .insert(payload)
    .select("id, version_id, user_id, tenant_id, locked_at, expires_at, created_at")
    .single();

  if (data && !error) {
    const lock = await toDraftLock({
      supabase: context.supabase,
      row: data as DraftLockRow,
      currentUserId: context.userId,
    });

    return {
      lock,
    };
  }

  if (error && isUniqueLockError(error)) {
    const existingLock = await getDraftLockInfoInternal({
      context,
      versionId,
    });

    if (existingLock?.user_id === context.userId) {
      return renewLockInternal(context, versionId, {
        force: false,
        requireDraftCheck: false,
      });
    }

    throw conflict(
      "Cette version est déjà verrouillée par un autre utilisateur.",
      existingLock
        ? {
            lock: existingLock,
          }
        : undefined
    );
  }

  if (error) {
    throw mapSupabaseError(error, "Impossible d'acquerir le verrou de brouillon.");
  }

  throw notFound("Version de chiffrage introuvable.");
}

export async function renewLock(
  versionId: string,
  options?: {
    force?: boolean;
  }
): Promise<RenewDraftLockResult> {
  const context = await getAuthenticatedContext();
  return renewLockInternal(context, versionId, {
    force: options?.force === true,
    requireDraftCheck: true,
  });
}

export async function releaseLock(
  versionId: string,
  options?: {
    force?: boolean;
  }
): Promise<ReleaseDraftLockResult> {
  const context = await getAuthenticatedContext();
  return releaseLockInternal(context, versionId, {
    force: options?.force === true,
  });
}

export async function forceReleaseLock(
  versionId: string
): Promise<ReleaseDraftLockResult> {
  return releaseLock(versionId, {
    force: true,
  });
}
