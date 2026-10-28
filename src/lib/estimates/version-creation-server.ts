import "server-only";

import type { ImportSaleCoefficients } from "@/lib/affaires/import-engine-server";
import {
  persistCanonicalEstimateV2,
  type PersistCanonicalEstimateV2Input,
} from "@/lib/estimates/canonical-v2-creation";
import { badRequest } from "@/lib/estimates/errors";
import type { CreateEstimateInput } from "@/lib/estimates/schemas";
import {
  getAuthenticatedContext,
  tryCarryOverTakeoffJobsToNewVersion,
} from "@/lib/estimates/server-context";
import { buildEstimateCreationVersionPlan } from "@/lib/estimates/version-creation-plan";
import {
  ensureDefaultEstimateCategories,
  ensureDefaultLaborRoles,
  loadEstimateCreationProject,
} from "@/lib/estimates/version-creation-repository";
import { loadLinkedDpgfCreationSource } from "@/lib/estimates/version-creation-source-server";
import {
  DEFAULT_CURRENCY,
  normalizeEstimateCurrencyOrThrow,
  toNullableText,
} from "@/lib/estimates/version-write-normalization";

export async function createEstimate(
  input: CreateEstimateInput & { linked_import_id?: string | null }
) {
  const context = await getAuthenticatedContext();
  const { supabase, userId, tenantId } = context;
  const targetProjectId = input.project_id ?? null;
  const creationMode = input.creation_mode ?? "blank";
  const requestedCurrency = input.version?.currency;

  if (creationMode === "linked_dpgf_source" && !targetProjectId) {
    throw badRequest("creation_mode=linked_dpgf_source requiert project_id.");
  }
  if (requestedCurrency !== undefined) {
    normalizeEstimateCurrencyOrThrow(requestedCurrency, { fallback: DEFAULT_CURRENCY });
  }

  const existingProject = targetProjectId
    ? await loadEstimateCreationProject(context, targetProjectId)
    : null;
  if (!targetProjectId && !input.project) {
    throw badRequest("project ou project_id est requis.");
  }
  const latestProjectVersionDefaults = existingProject?.latestVersionDefaults ?? null;
  const projectUserId = existingProject?.project.user_id ?? userId;

  await ensureDefaultEstimateCategories({ supabase, tenantId, userId });
  await ensureDefaultLaborRoles({ supabase, tenantId, ownerUserId: projectUserId });

  let source: PersistCanonicalEstimateV2Input["source"] = {
    kind: "blank",
    importId: input.linked_import_id ?? null,
  };
  let linkedDpgfSaleCoefficients: ImportSaleCoefficients | null = null;
  if (creationMode === "linked_dpgf_source") {
    const linkedSource = await loadLinkedDpgfCreationSource({
      context,
      projectId: targetProjectId!,
      version: input.version,
      latestVersionDefaults: latestProjectVersionDefaults,
    });
    source = linkedSource.source;
    linkedDpgfSaleCoefficients = linkedSource.saleCoefficients;
  }

  const normalizedCurrency = requestedCurrency === undefined
    ? undefined
    : normalizeEstimateCurrencyOrThrow(requestedCurrency, { fallback: DEFAULT_CURRENCY });
  const versionPlan = buildEstimateCreationVersionPlan({
    version: input.version,
    normalizedCurrency,
    linkedDpgfSaleCoefficients,
  });
  const persisted = await persistCanonicalEstimateV2({
    supabase,
    tenantId,
    actorUserId: userId,
    ...versionPlan,
    project: targetProjectId
      ? { kind: "existing", id: targetProjectId }
      : {
          kind: "new",
          name: input.project!.name,
          reference: toNullableText(input.project!.reference),
          clientName: toNullableText(input.project!.client_name),
          notes: toNullableText(input.project!.notes),
        },
    source,
  });

  await tryCarryOverTakeoffJobsToNewVersion({
    supabase,
    tenantId,
    userId,
    sourceVersionId: latestProjectVersionDefaults?.id ?? null,
    targetVersionId: persisted.version.id,
  });
  return { project: persisted.project, version: persisted.version };
}
