import "server-only";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import type { EstimateReading } from "@/lib/assistant/estimate-reading";
import { buildEstimateReading, type EstimateReadingSource } from "@/lib/assistant/estimate-reading-build";
import { AssistantToolError, isUserFacingRefusal } from "@/lib/assistant/loop";
import { requireEstimateEngineVersion, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { canAccessOwnerResource } from "@/lib/estimates/server-context";
import { calculateEstimateBreakdownForItems, calculateEstimateV3SnapshotForItems } from "@/lib/estimates/version-totals";

const NO_ACCESS = "Ce devis est introuvable ou vous n’y avez pas accès.";

/** A refusal the application worded for its user (4xx) is told as is; anything else is not. */
function userFacingMessage(error: unknown) {
  return isUserFacingRefusal(error) ? error.message : null;
}

/** Every estimate read checks again, with the member's own rights, that they may still read the affaire. */
async function affaireReadAccess(projectId: string, refusal: string) {
  try {
    return await requireAffaireAccess(projectId, "read");
  } catch (error) {
    if (isUserFacingRefusal(error)) throw new AssistantToolError(refusal);
    throw error;
  }
}

/** The estimate versions of the affaire, most recent first, for every member who may read the affaire. */
export async function listAffaireEstimateVersions(projectId: string) {
  const { context, project } = await affaireReadAccess(projectId, "Vous n’avez pas accès aux devis de cette affaire.");
  const versions = await context.supabase.from("estimate_versions")
    .select("id, version_number, variant_label, title, status, updated_at")
    .eq("project_id", project.id).eq("tenant_id", context.tenantId).order("version_number", { ascending: false }).limit(50);
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
 * A member who reads the affaire without opening its estimates in the editor
 * (a director) gets the document view.
 */
export async function loadEstimateReading(input: { versionId: string; projectId: string; cache?: Map<string, EstimateReading> }): Promise<EstimateReading> {
  const { context, project } = await affaireReadAccess(input.projectId, NO_ACCESS);
  const versionRead = await context.supabase.from("estimate_versions").select("*")
    .eq("id", input.versionId).eq("tenant_id", context.tenantId).maybeSingle();
  if (versionRead.error || !versionRead.data) throw new AssistantToolError(NO_ACCESS);
  const version = versionRead.data;
  if (version.project_id !== project.id) {
    throw new AssistantToolError("Ce devis n’appartient pas à l’affaire de cette conversation.");
  }
  const view = canAccessOwnerResource({ context, resourceUserId: project.user_id }) ? "editor" : "document";
  const cached = input.cache?.get(version.id);
  if (cached?.view === view) return cached;
  const items = await readAllEstimateItems({ supabase: context.supabase, tenantId: context.tenantId, versionId: version.id });

  let calculation: EstimateReadingSource["calculation"] = { kind: "frozen" };
  const isV3 = usesSaleCoefficients(requireEstimateEngineVersion(version));
  // The read-only page shows an engine 3 draft on its stored amounts, and an older engine's draft computed.
  if (version.status === "draft" && view === "document" && isV3) {
    calculation = { kind: "stored" };
  } else if (version.status === "draft") {
    const scope = {
      supabase: context.supabase, tenantId: context.tenantId, projectUserId: project.user_id, version, lineItems: items,
    };
    try {
      calculation = isV3
        ? { kind: "v3", breakdown: (await calculateEstimateV3SnapshotForItems(scope)).breakdown }
        : { kind: "v2", breakdown: await calculateEstimateBreakdownForItems(scope) };
    } catch (error) {
      const message = userFacingMessage(error);
      if (!message) throw error;
      calculation = { kind: "refused", message };
    }
  }
  // Lines are read by pages: an edit meanwhile would mix two revisions into amounts that never existed.
  await assertEstimateVersionUnchanged({ supabase: context.supabase, version }).catch((error: unknown) => {
    if ((error as { code?: unknown } | null)?.code === "VERSION_CONFLICT") {
      throw new AssistantToolError("Le devis vient d’être modifié pendant la lecture. Relis-le.");
    }
    throw error;
  });
  const reading = buildEstimateReading({ version, items, calculation }, view);
  input.cache?.set(version.id, reading);
  return reading;
}
