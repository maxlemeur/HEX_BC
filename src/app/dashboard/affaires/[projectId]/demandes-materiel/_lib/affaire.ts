import { notFound } from "next/navigation";

import { fetchAffaireProjectBasic } from "@/lib/affaires/server";
import { getUserContext } from "@/lib/auth/server";
import { canAddToCatalogue } from "@/lib/catalogue/access";

/**
 * The affaire a material request page belongs to, read on the server as the sibling sub-pages do:
 * an unknown affaire, or one of another tenant, is a 404 before anything is rendered.
 */
export async function loadMaterialRequestAffaire(
  projectId: string,
): Promise<{ id: string; name: string; canEditCatalogue: boolean }> {
  const { tenantId, profile } = await getUserContext();
  if (!tenantId) notFound();

  try {
    const project = await fetchAffaireProjectBasic(projectId);
    // Who may set a supply type's preferred supplier (admins and engineers, TI-689): the database checks it again.
    const role = profile?.tenant_role ?? null;
    return { id: projectId, name: project.name, canEditCatalogue: role !== null && canAddToCatalogue(role) };
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "NOT_FOUND"
    ) {
      notFound();
    }
    throw error;
  }
}
