import type { Database } from "@/types/database";

type TenantRole = Database["public"]["Enums"]["tenant_role"];

/**
 * TI-689: what a member may write in the catalogue (suppliers and items). The rule itself lives in the database
 * (`public.can_edit_catalogue_record`, policies of `suppliers` and `products`); this copy only decides which
 * buttons to show and which refusal to word.
 */
export type CatalogueAccess = {
  userId: string;
  /** Admins and engineers add suppliers and items. */
  canAdd: boolean;
  /** Admins always; engineers when their admin opened the shared base to them. */
  canEditShared: boolean;
};

export function canAddToCatalogue(role: TenantRole): boolean {
  return role === "admin" || role === "engineer";
}

export function buildCatalogueAccess(input: {
  userId: string;
  role: TenantRole;
  engineersCanEditShared: boolean;
}): CatalogueAccess {
  return {
    userId: input.userId,
    canAdd: canAddToCatalogue(input.role),
    canEditShared: input.role === "admin" || (input.role === "engineer" && input.engineersCanEditShared),
  };
}

/** A member changes or deletes a record of the shared base when allowed, and always the ones they added. */
export function canEditCatalogueRecord(
  access: CatalogueAccess | null | undefined,
  createdBy: string | null | undefined
): boolean {
  if (!access) return false;
  if (access.canEditShared) return true;
  return access.canAdd && Boolean(createdBy) && createdBy === access.userId;
}
