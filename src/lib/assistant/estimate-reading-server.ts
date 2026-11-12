import "server-only";

import type { EstimateReading } from "@/lib/assistant/estimate-reading";
import { buildEstimateReading, type EstimateReadingSource } from "@/lib/assistant/estimate-reading-build";
import { AssistantToolError } from "@/lib/assistant/loop";
import { requireEstimateEngineVersion, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import type { AuthenticatedContext } from "@/lib/estimates/server-context";
import { getOwnedEstimateVersion } from "@/lib/estimates/version-owner-access";
import { calculateEstimateBreakdownForItems, calculateEstimateV3SnapshotForItems } from "@/lib/estimates/version-totals";

const NO_ACCESS = "Ce devis est introuvable ou vous n’y avez pas accès.";

/** A refusal the application worded for its user (4xx) is told as is; anything else is not. */
function userFacingMessage(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  return error instanceof Error && typeof status === "number" && status >= 400 && status < 500 ? error.message : null;
}

/** The versions of an affaire that this member may open, most recent first. */
export async function listAffaireEstimateVersions(context: AuthenticatedContext, projectId: string) {
  const project = await context.supabase.from("estimate_projects").select("id, user_id")
    .eq("id", projectId).eq("tenant_id", context.tenantId).maybeSingle();
  // Same rule as every estimate read: the affaire's owner or an admin.
  if (project.error || !project.data || (project.data.user_id !== context.userId && context.tenantRole !== "admin")) {
    throw new AssistantToolError("Vous n’avez pas accès aux devis de cette affaire.");
  }
  const versions = await context.supabase.from("estimate_versions")
    .select("id, version_number, variant_label, title, status, updated_at")
    .eq("project_id", projectId).eq("tenant_id", context.tenantId).order("version_number", { ascending: false }).limit(50);
  if (versions.error) throw new AssistantToolError("Les devis de cette affaire n’ont pas pu être lus.");
  return versions.data.map((version) => ({
    id: version.id, version: [`V${version.version_number ?? "?"}`, version.variant_label?.trim()].filter(Boolean).join(" "),
    titre: version.title, statut: version.status, modifie_le: version.updated_at,
  }));
}

/**
 * Reads one estimate of the conversation's affaire with the caller's own rights.
 * A draft is computed by its pinned engine, as the editor shows it; an issued
 * version is read on its frozen amounts and never recalculated at today's rates.
 */
export async function loadEstimateReading(
  context: AuthenticatedContext, input: { versionId: string; projectId: string },
): Promise<EstimateReading> {
  const access = await getOwnedEstimateVersion(context, input.versionId).catch(() => { throw new AssistantToolError(NO_ACCESS); });
  if (access.project.id !== input.projectId) {
    throw new AssistantToolError("Ce devis n’appartient pas à l’affaire de cette conversation.");
  }
  const versionRead = await context.supabase.from("estimate_versions").select("*")
    .eq("id", input.versionId).eq("tenant_id", context.tenantId).single();
  if (versionRead.error || !versionRead.data) throw new AssistantToolError(NO_ACCESS);
  const version = versionRead.data;
  const items = await readAllEstimateItems({ supabase: context.supabase, tenantId: context.tenantId, versionId: version.id });

  let calculation: EstimateReadingSource["calculation"] = { kind: "frozen" };
  if (version.status === "draft") {
    const scope = {
      supabase: context.supabase, tenantId: context.tenantId, projectUserId: access.project.user_id, version, lineItems: items,
    };
    try {
      calculation = usesSaleCoefficients(requireEstimateEngineVersion(version))
        ? { kind: "v3", breakdown: (await calculateEstimateV3SnapshotForItems(scope)).breakdown }
        : { kind: "v2", breakdown: await calculateEstimateBreakdownForItems(scope) };
    } catch (error) {
      const message = userFacingMessage(error);
      if (!message) throw error;
      calculation = { kind: "refused", message };
    }
  }
  return buildEstimateReading({ version, items, calculation });
}
