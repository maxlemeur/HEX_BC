import { notFound } from "next/navigation";

import { fetchAffaireProjectBasic } from "@/lib/affaires/server";
import { getUserContext } from "@/lib/auth/server";

/**
 * The affaire a material request page belongs to, read on the server as the sibling sub-pages do:
 * an unknown affaire, or one of another tenant, is a 404 before anything is rendered.
 */
export async function loadMaterialRequestAffaire(projectId: string): Promise<{ id: string; name: string }> {
  const { tenantId } = await getUserContext();
  if (!tenantId) notFound();

  try {
    const project = await fetchAffaireProjectBasic(projectId);
    return { id: projectId, name: project.name };
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
