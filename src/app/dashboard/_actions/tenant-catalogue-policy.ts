"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { ApiError } from "@/lib/estimates/errors";

export type SaveTenantCataloguePolicyResult =
  | { ok: true; engineersCanEditShared: boolean }
  | { ok: false; message: string };

const ADMIN_ONLY_MESSAGE = "Seul un administrateur de l'entreprise modifie ce réglage.";
const SESSION_EXPIRED_MESSAGE = "Session expirée. Reconnectez-vous pour enregistrer le réglage.";
const FAILURE_MESSAGE = "Impossible d'enregistrer le réglage. Réessayez.";

const inputSchema = z.object({ engineersCanEditShared: z.boolean() });

/**
 * TI-689: the admin of the active tenant decides whether engineers change the shared catalogue (suppliers and items
 * they did not add). The database checks the role again (`public.set_tenant_catalogue_policy`).
 */
export async function saveTenantCataloguePolicy(input: {
  engineersCanEditShared: boolean;
}): Promise<SaveTenantCataloguePolicyResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Saisie illisible. Rechargez la page." };
  try {
    const context = await getAuthenticatedContext();
    if (context.tenantRole !== "admin") return { ok: false, message: ADMIN_ONLY_MESSAGE };
    const { data, error } = await context.supabase.rpc("set_tenant_catalogue_policy", {
      p_tenant_id: context.tenantId,
      p_engineers_can_edit_shared: parsed.data.engineersCanEditShared,
    });
    if (error) {
      return {
        ok: false,
        message: error.message.includes("TENANT_CATALOGUE_POLICY_ADMIN_ONLY") ? ADMIN_ONLY_MESSAGE : FAILURE_MESSAGE,
      };
    }
    revalidatePath("/dashboard/admin/catalogue-rights");
    return { ok: true, engineersCanEditShared: data?.engineers_can_edit_shared === true };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.status === 401 ? SESSION_EXPIRED_MESSAGE : error.message };
    }
    return { ok: false, message: FAILURE_MESSAGE };
  }
}
