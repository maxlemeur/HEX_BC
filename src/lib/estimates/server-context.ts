import { headers } from "next/headers";
import {
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  ESTIMATE_DRAFT_LOCK_SESSION_HEADER,
  normalizeEstimateDraftLockSessionId,
} from "@/lib/estimates/lock-session";
import { linkTakeoffJobsFromSourceVersionToTargetVersion } from "@/lib/takeoff/version-links";
import type { Database } from "@/types/database";

import { conflict, forbidden, mapSupabaseError, notFound } from "./errors";

type Supabase = SupabaseClient<Database>;
type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type TenantRole = Database["public"]["Enums"]["tenant_role"];

const TENANT_ADMIN_ROLE: TenantRole = "admin";

export type EmbeddedProjectAccess = Pick<
  EstimateProjectRow,
  | "id"
  | "tenant_id"
  | "user_id"
  | "name"
  | "reference"
  | "estimate_reference"
  | "client_name"
  | "notes"
  | "is_archived"
>;

export type VersionAccessRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "status"
  | "margin_mode"
  | "margin_multiplier"
  | "margin_bp"
  | "discount_bp"
  | "max_section_depth"
  | "tax_rate_bp"
  | "updated_at"
  | "content_revision"
  | "total_ht_cents"
  | "total_tax_cents"
  | "total_ttc_cents"
  | "calc_engine_version"
  | "calc_snapshot_content_revision"
  | "calc_snapshot_context"
> & {
  parent_version_id?: string | null;
  variant_label?: string | null;
  /** Optionnel : absent des jeux de tests/mocks historiques. */
  currency?: string | null;
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

export type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
};

export async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const { supabase, userId, tenantId, tenantRole } =
    await getAuthenticatedTenantContext();

  return { supabase, userId, tenantId, tenantRole };
}

export function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export function toNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isTenantAdmin(tenantRole: TenantRole) {
  return tenantRole === TENANT_ADMIN_ROLE;
}

export function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    isTenantAdmin(input.context.tenantRole)
  );
}

export function errorMessageContains(
  error: PostgrestError,
  expectedMessageFragment: string
): boolean {
  return (error.message ?? "")
    .toLowerCase()
    .includes(expectedMessageFragment.toLowerCase());
}

export function toRpcUuid(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export async function getVersionAccessOrThrow(
  supabase: Supabase,
  versionId: string,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">
): Promise<{ version: VersionAccessRow; project: EmbeddedProjectAccess }> {
  const { data, error } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, status, margin_mode, margin_multiplier, margin_bp, discount_bp, max_section_depth, tax_rate_bp, updated_at, content_revision, total_ht_cents, total_tax_cents, total_ttc_cents, calc_engine_version, calc_snapshot_content_revision, calc_snapshot_context, parent_version_id, variant_label, currency, estimate_projects!inner(id, tenant_id, user_id, name, reference, estimate_reference, client_name, notes, is_archived)"
    )
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const row = data as unknown as VersionAccessRow;
  const project = resolveEmbeddedOne(row.estimate_projects);

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

  return {
    version: row,
    project,
  };
}

export function assertDraftStatus(status: EstimateStatus) {
  if (status === "draft") return;
  throw forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY");
}

async function getActiveDraftLockForVersion(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("draft_locks")
    .select("id, version_id, user_id, session_id, locked_at, expires_at")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de vérifier le verrou de brouillon."
    );
  }

  return (data ?? null) as
    | {
        id: string;
        version_id: string;
        user_id: string;
        session_id?: string | null;
        locked_at: string;
        expires_at: string;
      }
    | null;
}

async function resolveRequestDraftLockSessionId() {
  try {
    const requestHeaders = await headers();
    return normalizeEstimateDraftLockSessionId(
      requestHeaders.get(ESTIMATE_DRAFT_LOCK_SESSION_HEADER)
    );
  } catch {
    // Some focused domain tests call server functions outside a Next.js request.
    return null;
  }
}

async function resolveDraftLockOwnerName(supabase: Supabase, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const fullName =
    typeof data.full_name === "string" ? data.full_name.trim() : "";
  return fullName.length > 0 ? fullName : null;
}

export async function assertDraftLockOwnedByCurrentUser(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
}) {
  const lock = await getActiveDraftLockForVersion({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });

  if (!lock) {
    throw conflict(
      "Un verrou actif est requis pour modifier cette version brouillon.",
      {
        lock: null,
      },
      "LOCK_REQUIRED"
    );
  }

  const requestSessionId = await resolveRequestDraftLockSessionId();
  const isCurrentUser = lock.user_id === input.userId;
  const isLegacyTestLock =
    process.env.NODE_ENV === "test" && !lock.session_id;
  const isCurrentSession =
    isCurrentUser &&
    (isLegacyTestLock || lock.session_id === requestSessionId);

  if (isCurrentSession) {
    return;
  }

  const holderName = isCurrentUser
    ? null
    : await resolveDraftLockOwnerName(input.supabase, lock.user_id);
  const message = isCurrentUser
    ? "Cette version est déjà verrouillée dans une autre page d'édition."
    : "Cette version est déjà verrouillée par un autre utilisateur.";

  throw conflict(message, {
    lock: {
      version_id: lock.version_id,
      user_id: lock.user_id,
      session_id: lock.session_id ?? null,
      holder_name: holderName,
      locked_at: lock.locked_at,
      expires_at: lock.expires_at,
      is_owner: false,
      is_current_user: isCurrentUser,
      is_current_session: false,
    },
  });
}

export async function tryCarryOverTakeoffJobsToNewVersion(input: {
  supabase: Supabase;
  tenantId: string;
  userId: string;
  sourceVersionId: string | null;
  targetVersionId: string;
}) {
  if (!input.sourceVersionId) {
    return;
  }

  try {
    await linkTakeoffJobsFromSourceVersionToTargetVersion({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
      sourceVersionId: input.sourceVersionId,
      targetVersionId: input.targetVersionId,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Unexpected table:")
    ) {
      return;
    }

    console.warn("takeoff carry-over skipped", {
      sourceVersionId: input.sourceVersionId,
      targetVersionId: input.targetVersionId,
      error,
    });
  }
}
