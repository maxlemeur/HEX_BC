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
import type { Database } from "@/types/database";

import { conflict, forbidden, mapSupabaseError, notFound } from "@/lib/http/api-response";
import { resolveEmbeddedOne } from "@/lib/supabase/embedded";

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
  | "site_address"
  | "client_name"
  | "notes"
  | "is_archived"
>;

export type VersionAccessRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "tenant_id"
  | "status"
  | "margin_mode"
  | "margin_multiplier"
  | "margin_bp"
  | "discount_bp"
  | "discount_amount_cents"
  | "max_section_depth"
  | "tax_rate_bp"
  | "updated_at"
  | "content_revision"
  | "total_ht_cents"
  | "total_tax_cents"
  | "total_ttc_cents"
  | "calc_engine_version"
  | "sale_coefficient_fo"
  | "sale_coefficient_mo"
  | "calc_snapshot_content_revision"
  | "calc_snapshot_context"
> & {
  parent_version_id?: string | null;
  variant_label?: string | null;
  /** Optionnel : absent des jeux de tests/mocks historiques. */
  currency?: string | null;
  /** « Précisions et limites de prestation » : lu par le contrôle d'envoi (réserve écrite, TI-682). Absent des mocks. */
  exclusions?: string | null;
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

/**
 * Rôles du workflow d'approbation. `read` lit les ressources d'approbation de tout chiffrage du
 * tenant ; le propriétaire du chiffrage lit les siennes quel que soit son rôle, et une demande
 * exige aussi d'être propriétaire ou admin.
 */
export const ESTIMATE_APPROVAL_ROLES = {
  request: ["admin", "engineer"],
  approve: ["admin", "director"],
  read: ["admin", "director"],
} as const satisfies Record<string, readonly TenantRole[]>;

export function hasEstimateApprovalRole(
  tenantRole: TenantRole,
  action: keyof typeof ESTIMATE_APPROVAL_ROLES
) {
  return (ESTIMATE_APPROVAL_ROLES[action] as readonly TenantRole[]).includes(tenantRole);
}

export function canAccessApprovalResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    hasEstimateApprovalRole(input.context.tenantRole, "read")
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

/**
 * Qui atteint une version de chiffrage. Chaque règle exige la version et son affaire dans le
 * tenant de l'appelant et répond 404 sinon.
 * - `owner_or_admin` : propriétaire de l'affaire ou admin du tenant, la règle de l'éditeur ;
 * - `owner_or_admin_on_active_project` : la même, sur une affaire non archivée (409 sinon) ;
 * - `owner_or_approval_reader` : propriétaire ou rôle `read` de `ESTIMATE_APPROVAL_ROLES`.
 */
export type VersionAccessMode =
  | "owner_or_admin"
  | "owner_or_admin_on_active_project"
  | "owner_or_approval_reader";

export type VersionAccessQuery = {
  mode: VersionAccessMode;
  /** Colonnes de estimate_versions, sans l'affaire embarquée. */
  versionColumns: string;
  /** Colonnes de estimate_projects en plus de celles que la règle lit (id, tenant_id, user_id, is_archived). */
  projectColumns?: string;
};

type ProjectAccessColumns = Pick<EstimateProjectRow, "id" | "tenant_id" | "user_id" | "is_archived">;

const PROJECT_ACCESS_COLUMNS = ["id", "tenant_id", "user_id", "is_archived"];

const EDITOR_VERSION_ACCESS: VersionAccessQuery = {
  mode: "owner_or_admin",
  versionColumns:
    "id, project_id, tenant_id, status, margin_mode, margin_multiplier, margin_bp, discount_bp, discount_amount_cents, max_section_depth, tax_rate_bp, updated_at, content_revision, total_ht_cents, total_tax_cents, total_ttc_cents, calc_engine_version, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents, calc_snapshot_content_revision, calc_snapshot_context, parent_version_id, variant_label, currency, exclusions",
  projectColumns: "name, reference, estimate_reference, site_address, client_name, notes",
};

function canReachVersion(
  mode: VersionAccessMode,
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">,
  project: ProjectAccessColumns
) {
  const resource = { context, resourceUserId: project.user_id };
  return mode === "owner_or_approval_reader"
    ? canAccessApprovalResource(resource)
    : canAccessOwnerResource(resource);
}

export async function getVersionAccessOrThrow<
  TVersion = unknown,
  TProject extends Pick<EstimateProjectRow, "id" | "tenant_id" | "user_id"> = Pick<EstimateProjectRow, "id" | "tenant_id" | "user_id">,
>(
  supabase: Supabase,
  versionId: string,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  query: VersionAccessQuery
): Promise<{ version: TVersion; project: TProject }>;
/** Sans requête : les colonnes et la règle de l'éditeur. */
export async function getVersionAccessOrThrow(
  supabase: Supabase,
  versionId: string,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">
): Promise<{ version: VersionAccessRow; project: EmbeddedProjectAccess }>;
export async function getVersionAccessOrThrow(
  supabase: Supabase,
  versionId: string,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  query: VersionAccessQuery = EDITOR_VERSION_ACCESS
) {
  const projectColumns = [...new Set([
    ...PROJECT_ACCESS_COLUMNS,
    ...(query.projectColumns ?? "").split(",").map((column) => column.trim()).filter(Boolean),
  ])].join(", ");
  const { data, error } = await supabase
    .from("estimate_versions")
    .select(`${query.versionColumns}, estimate_projects!inner(${projectColumns})`)
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const row = data as unknown as {
    estimate_projects: ProjectAccessColumns | ProjectAccessColumns[] | null;
  };
  const project = resolveEmbeddedOne(row.estimate_projects);

  if (
    !project ||
    project.tenant_id !== context.tenantId ||
    !canReachVersion(query.mode, context, project)
  ) {
    throw notFound("Version de chiffrage introuvable.");
  }

  if (query.mode === "owner_or_admin_on_active_project" && project.is_archived) {
    throw conflict("Cette affaire est archivée.");
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
  draftLockSessionId?: string | null;
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

  const hasExplicitSessionId = input.draftLockSessionId !== undefined;
  const requestSessionId = hasExplicitSessionId
    ? normalizeEstimateDraftLockSessionId(input.draftLockSessionId)
    : await resolveRequestDraftLockSessionId();
  const isCurrentUser = lock.user_id === input.userId;
  const isLegacyTestLock =
    process.env.NODE_ENV === "test" && !lock.session_id && !hasExplicitSessionId;
  const isCurrentSession =
    isCurrentUser &&
    (isLegacyTestLock ||
      (requestSessionId !== null && lock.session_id === requestSessionId));

  if (isCurrentSession) {
    return lock;
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
