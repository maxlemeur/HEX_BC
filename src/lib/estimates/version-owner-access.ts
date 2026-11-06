import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { notFound } from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

type AuthenticatedContext = Pick<AuthenticatedTenantContext, "supabase" | "tenantId" | "userId" | "tenantRole">;

// Owner/admin reads deliberately retain a 404 for every inaccessible version.
type EmbeddedProjectAccess = Pick<
  Database["public"]["Tables"]["estimate_projects"]["Row"],
  "id" | "tenant_id" | "user_id"
>;

type VersionAccessRow = Pick<
  Database["public"]["Tables"]["estimate_versions"]["Row"],
  "id" | "tenant_id" | "status"
> & {
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    input.context.tenantRole === "admin"
  );
}

export async function getOwnedEstimateVersion(
  context: AuthenticatedContext,
  versionId: string
): Promise<{ version: VersionAccessRow; project: EmbeddedProjectAccess }> {
  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select("id, tenant_id, status, estimate_projects!inner(id, tenant_id, user_id)")
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

  return {
    version,
    project,
  };
}
