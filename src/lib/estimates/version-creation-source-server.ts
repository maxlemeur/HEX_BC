import "server-only";

import {
  resolveImportSaleCoefficients,
  v3LineContext,
} from "@/lib/affaires/import-engine-server";
import { toRpcImportItems } from "@/lib/affaires/import-flow-server";
import type { PersistCanonicalEstimateV2Input } from "@/lib/estimates/canonical-v2-creation";
import { badRequest } from "@/lib/estimates/errors";
import {
  loadLatestDpgfMappingForImport,
  loadLatestLinkedDpgfImportForProject,
  loadMappedRowsForImportWithRetry,
} from "@/lib/estimates/linked-dpgf-read-server";
import type { CreateEstimateInput } from "@/lib/estimates/schemas";
import type { AuthenticatedContext } from "@/lib/estimates/server-context";
import { prepareLinkedDpgfCreationRows } from "@/lib/estimates/version-creation-plan";
import type { CreateEstimateLatestVersionDefaultsRow } from "@/lib/estimates/version-creation-repository";
import { toNullableText } from "@/lib/estimates/version-write-normalization";

export async function loadLinkedDpgfCreationSource(input: {
  context: AuthenticatedContext;
  projectId: string;
  version: CreateEstimateInput["version"];
  latestVersionDefaults: CreateEstimateLatestVersionDefaultsRow | null;
}) {
  const { supabase, tenantId } = input.context;
  const latestImport = await loadLatestLinkedDpgfImportForProject({
    supabase,
    tenantId,
    projectId: input.projectId,
  });
  if (!latestImport) {
    throw badRequest("Aucune source DPGF liée à cette affaire.");
  }
  // Read the entire source by pages: PostgREST's max_rows is 1000.
  const mappedRows = await loadMappedRowsForImportWithRetry({
    supabase,
    tenantId,
    importId: latestImport.id,
    maxAttempts: 10,
    retryDelayMs: 300,
  });
  if (mappedRows.length === 0) {
    throw badRequest("La source DPGF liée ne contient aucune ligne mappee exploitable.");
  }
  const saleCoefficients = await resolveImportSaleCoefficients({
    supabase,
    tenantId,
    rows: mappedRows,
    requested: {
      fo: input.version?.sale_coefficient_fo,
      mo: input.version?.sale_coefficient_mo,
    },
  });
  const normalized = prepareLinkedDpgfCreationRows({
    mappedRows,
    version: input.version,
    latestVersionDefaults: input.latestVersionDefaults,
    lineContext: v3LineContext(saleCoefficients),
  });
  const latestMapping = await loadLatestDpgfMappingForImport({
    supabase,
    tenantId,
    importId: latestImport.id,
  });
  const source: PersistCanonicalEstimateV2Input["source"] = {
    kind: "import",
    importId: latestImport.id,
    mappingId: latestMapping?.id ?? null,
    filename: latestImport.filename,
    sectionTitle: toNullableText(latestImport.filename)
      ? `Import DPGF - ${latestImport.filename}`
      : "Import DPGF",
    items: toRpcImportItems(normalized.validItems, {
      importId: latestImport.id,
      mappingId: latestMapping?.id ?? null,
    }),
    ...(saleCoefficients ? { engine: 3 } : {}),
  };
  return { source, saleCoefficients };
}
