import "server-only";

import { getAuthenticatedContext, type AuthenticatedTenantContext, type TenantRole } from "@/lib/auth/tenant-context";
import { forbidden, mapSupabaseError, notFound } from "@/lib/http/api-response";

export type AffaireAccessMode = "read" | "write";

/**
 * What each role of the tenant may do on an affaire of the tenant it does not own. The owner of an
 * affaire reads and writes it whatever their role.
 */
const MODES_ON_ANY_AFFAIRE: Record<TenantRole, readonly AffaireAccessMode[]> = {
  admin: ["read", "write"],
  director: ["read"],
  engineer: [],
  viewer: [],
};

export const AFFAIRE_ACCESS_PROJECT_COLUMNS = "id, tenant_id, user_id, name, reference, client_name, is_archived";

export type AffaireAccessProject = {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  reference: string | null;
  client_name: string | null;
  is_archived: boolean;
};

export type AffaireAccess = {
  context: AuthenticatedTenantContext;
  project: AffaireAccessProject;
};

type Member = Pick<AuthenticatedTenantContext, "userId" | "tenantRole">;

/** The role rule alone: the caller still checks that the affaire is in the member's tenant and not archived. */
export function canAccessAffaire(member: Member, affaireOwnerId: string, mode: AffaireAccessMode): boolean {
  return affaireOwnerId === member.userId || MODES_ON_ANY_AFFAIRE[member.tenantRole].includes(mode);
}

/**
 * The same rule as a query filter over the affaires of the tenant: the owner the rows must have,
 * or null when the member's role reaches every affaire.
 */
export function affaireOwnerFilter(member: Member, mode: AffaireAccessMode): string | null {
  return MODES_ON_ANY_AFFAIRE[member.tenantRole].includes(mode) ? null : member.userId;
}

/**
 * The affaire, when the signed-in member may read or write it: it is in their active tenant, it is
 * not archived (404 otherwise) and their role or ownership allows the mode (403 otherwise).
 */
export async function requireAffaireAccess(
  projectId: string,
  mode: AffaireAccessMode,
  options: {
    /** The register has always worded its own refusal. */
    forbiddenMessage?: string;
  } = {}
): Promise<AffaireAccess> {
  const context = await getAuthenticatedContext();
  const { data: project, error } = await context.supabase
    .from("estimate_projects")
    .select(AFFAIRE_ACCESS_PROJECT_COLUMNS)
    .eq("id", projectId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (error) throw mapSupabaseError(error, "Impossible de charger l'affaire.");
  if (!project || project.is_archived) throw notFound("Affaire introuvable.");
  if (!canAccessAffaire(context, project.user_id, mode)) {
    throw forbidden(options.forbiddenMessage ?? "Accès refusé à cette affaire.");
  }

  return { context, project };
}
