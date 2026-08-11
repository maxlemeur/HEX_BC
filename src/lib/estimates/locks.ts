import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  getAuthenticatedTenantContext as getAuthenticatedContext,
} from "@/lib/auth/tenant-context";
import type { Database } from "@/types/database";

import {
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
} from "./errors";

type Supabase = SupabaseClient<Database>;
type TenantRole = Database["public"]["Enums"]["tenant_role"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type DraftLockRow = Database["public"]["Tables"]["draft_locks"]["Row"] & {
  session_id: string;
};
type DraftLockInsert = Database["public"]["Tables"]["draft_locks"]["Insert"] & {
  session_id: string;
};
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

const DRAFT_LOCK_TTL_SECONDS = 120;
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
  session_id: string;
  locked_at: string;
  expires_at: string;
  is_current_user: boolean;
  is_current_session: boolean;
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
  return new Date(Date.now() + DRAFT_LOCK_TTL_SECONDS * 1000).toISOString();
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
    .select("id, version_id, user_id, session_id, tenant_id, locked_at, expires_at, created_at")
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
  currentSessionId?: string | null;
}): Promise<DraftLock> {
  const owner = await getLockOwnerById(input.supabase, input.row.user_id);

  return {
    id: input.row.id,
    version_id: input.row.version_id,
    tenant_id: input.row.tenant_id,
    user_id: input.row.user_id,
    session_id: input.row.session_id,
    locked_at: input.row.locked_at,
    expires_at: input.row.expires_at,
    is_current_user: input.row.user_id === input.currentUserId,
    is_current_session: input.row.session_id === input.currentSessionId,
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
  sessionId?: string | null;
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
    currentSessionId: input.sessionId,
  });
}

async function renewLockInternal(
  context: AuthenticatedContext,
  versionId: string,
  options: {
    sessionId: string;
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
    query = query
      .eq("user_id", context.userId)
      .eq("session_id", options.sessionId);
  }

  const { data, error } = await query
    .select("id, version_id, user_id, session_id, tenant_id, locked_at, expires_at, created_at")
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
      currentSessionId: options.sessionId,
    });

    return {
      lock,
    };
  }

  const existingLock = await getDraftLockInfoInternal({
    context,
    versionId,
    sessionId: options.sessionId,
  });

  if (existingLock && !options.force) {
    const message = existingLock.is_current_user
      ? "Cette version est déjà verrouillée dans une autre page d'édition."
      : "Cette version est déjà verrouillée par un autre utilisateur.";
    throw conflict(message, {
      lock: existingLock,
    });
  }

  throw notFound("Aucun verrou actif pour cette version.");
}

async function releaseLockInternal(
  context: AuthenticatedContext,
  versionId: string,
  options: {
    sessionId: string;
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
    query = query
      .eq("user_id", context.userId)
      .eq("session_id", options.sessionId);
  }

  const { data, error } = await query
    .select("id, version_id, user_id, session_id, tenant_id, locked_at, expires_at, created_at")
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
      currentSessionId: options.sessionId,
    });

    return {
      released: true,
      lock,
    };
  }

  const existingLock = await getDraftLockInfoInternal({
    context,
    versionId,
    sessionId: options.sessionId,
  });

  if (existingLock && !options.force) {
    const message = existingLock.is_current_user
      ? "Cette version est déjà verrouillée dans une autre page d'édition."
      : "Cette version est déjà verrouillée par un autre utilisateur.";
    throw conflict(message, {
      lock: existingLock,
    });
  }

  return {
    released: false,
    lock: existingLock,
  };
}

export async function getLockInfo(
  versionId: string,
  sessionId?: string | null
): Promise<GetDraftLockInfoResult> {
  const context = await getAuthenticatedContext();

  await assertVersionAccessOrThrow(context, versionId, { requireDraft: false });

  const lock = await getDraftLockInfoInternal({
    context,
    versionId,
    sessionId,
  });

  return {
    lock,
  };
}

export async function acquireLock(
  versionId: string,
  sessionId: string
): Promise<AcquireDraftLockResult> {
  const context = await getAuthenticatedContext();

  await assertVersionAccessOrThrow(context, versionId, { requireDraft: true });
  await cleanupExpiredLocks(context);

  const payload: DraftLockInsert = {
    version_id: versionId,
    user_id: context.userId,
    session_id: sessionId,
    tenant_id: context.tenantId,
    expires_at: toLockExpiryIsoDate(),
  };

  const { data, error } = await context.supabase
    .from("draft_locks")
    .insert(payload)
    .select("id, version_id, user_id, session_id, tenant_id, locked_at, expires_at, created_at")
    .single();

  if (data && !error) {
    const lock = await toDraftLock({
      supabase: context.supabase,
      row: data as DraftLockRow,
      currentUserId: context.userId,
      currentSessionId: sessionId,
    });

    return {
      lock,
    };
  }

  if (error && isUniqueLockError(error)) {
    const existingLock = await getDraftLockInfoInternal({
      context,
      versionId,
      sessionId,
    });

    if (existingLock?.is_current_user && existingLock.is_current_session) {
      return renewLockInternal(context, versionId, {
        sessionId,
        force: false,
        requireDraftCheck: false,
      });
    }

    const message = existingLock?.is_current_user
      ? "Cette version est déjà verrouillée dans une autre page d'édition."
      : "Cette version est déjà verrouillée par un autre utilisateur.";
    throw conflict(
      message,
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
  sessionId: string,
  options?: {
    force?: boolean;
  }
): Promise<RenewDraftLockResult> {
  const context = await getAuthenticatedContext();
  return renewLockInternal(context, versionId, {
    sessionId,
    force: options?.force === true,
    requireDraftCheck: true,
  });
}

export async function releaseLock(
  versionId: string,
  sessionId: string,
  options?: {
    force?: boolean;
  }
): Promise<ReleaseDraftLockResult> {
  const context = await getAuthenticatedContext();
  return releaseLockInternal(context, versionId, {
    sessionId,
    force: options?.force === true,
  });
}

export async function forceReleaseLock(
  versionId: string,
  sessionId: string
): Promise<ReleaseDraftLockResult> {
  return releaseLock(versionId, sessionId, {
    force: true,
  });
}
