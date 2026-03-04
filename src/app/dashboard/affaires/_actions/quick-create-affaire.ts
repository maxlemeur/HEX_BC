"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  buildImportFlowStats,
  normalizeMappedRowsForEstimateCreation,
} from "@/lib/affaires/import-flow";
import {
  DEFAULT_MARGIN_MULTIPLIER,
  DEFAULT_TAX_RATE_BP,
  fetchLatestMappingId,
  fetchMappedRowsForImport,
  getCurrentMembershipOrThrow,
  getImportOrThrow,
  normalizeNullableText,
  sortValidLinesForEstimateCreation,
  toRpcImportLines,
} from "@/lib/affaires/import-flow-server";
import { createMapping } from "@/lib/mappings/server";
import { mappingRecordSchema } from "@/lib/mappings/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RpcCreateAffaireFromImportRow = {
  project_id: string;
  version_id: string;
  section_id: string;
  inserted_count: number;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
};

const quickCreateAffaireSchema = z.object({
  projectName: z.string().trim().min(1, "Nom projet requis.").max(200),
  clientName: z.string().trim().max(200).nullable().optional(),
  reference: z.string().trim().max(200).nullable().optional(),
  importId: z.string().uuid("importId invalide.").nullable().optional(),
  mapping: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  versionTitle: z.string().trim().max(200).nullable().optional(),
  sectionTitle: z.string().trim().max(200).nullable().optional(),
});

export type QuickCreateAffaireInput = z.infer<typeof quickCreateAffaireSchema>;

function revalidateQuickCreatePaths(projectId: string, versionId: string | null) {
  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${projectId}`);
  revalidatePath("/dashboard/imports");
  revalidatePath("/dashboard/mappings");
  revalidatePath("/dashboard/estimates");

  if (versionId) {
    revalidatePath(`/dashboard/estimates/${versionId}/edit`);
  }
}

function ensureEngineerOrAdmin(role: string) {
  if (role !== "engineer" && role !== "admin") {
    throw new Error("Acces refuse: role non autorise pour cette action.");
  }
}

export async function quickCreateAffaire(input: QuickCreateAffaireInput) {
  const parsed = quickCreateAffaireSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload de creation affaire invalide.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentification requise.");
  }

  const membership = await getCurrentMembershipOrThrow(supabase, user.id);
  ensureEngineerOrAdmin(membership.role);

  const projectName = parsed.data.projectName.trim();
  const clientName = normalizeNullableText(parsed.data.clientName);
  const reference = normalizeNullableText(parsed.data.reference);
  const importId = parsed.data.importId ?? null;

  if (!importId) {
    const { data: project, error: projectError } = await supabase
      .from("estimate_projects")
      .insert({
        tenant_id: membership.tenant_id,
        user_id: user.id,
        name: projectName,
        client_name: clientName,
        reference,
        notes: null,
        is_archived: false,
      })
      .select("id")
      .single();

    if (projectError || !project) {
      throw new Error("Impossible de creer la nouvelle affaire.");
    }

    revalidateQuickCreatePaths(project.id, null);
    redirect(`/dashboard/affaires/${project.id}?created=1`);
  }

  const importRow = await getImportOrThrow({
    supabase,
    importId,
    tenantId: membership.tenant_id,
    userId: user.id,
    isTenantAdmin: membership.role === "admin",
  });

  if (importRow.project_id) {
    throw new Error("Cet import est deja lie a une autre affaire.");
  }

  const normalizedMapping = mappingRecordSchema.parse(parsed.data.mapping ?? {});
  let mappingId: string | null = null;

  if (Object.keys(normalizedMapping).length > 0) {
    const createMappingResult = await createMapping({
      import_id: importId,
      mapping: normalizedMapping,
      save_template: false,
    });
    mappingId = createMappingResult.mapping.id;
  }

  if (!mappingId) {
    mappingId = await fetchLatestMappingId({
      supabase,
      importId,
      tenantId: membership.tenant_id,
    });
  }

  const mappedRows = await fetchMappedRowsForImport({
    supabase,
    importId,
    tenantId: membership.tenant_id,
  });

  const normalizedRows = normalizeMappedRowsForEstimateCreation(mappedRows, {
    marginMultiplier: DEFAULT_MARGIN_MULTIPLIER,
    defaultTaxRateBp: DEFAULT_TAX_RATE_BP,
  });

  if (normalizedRows.validLines.length === 0) {
    throw new Error("Aucune ligne valide a inserer pour creer le chiffrage.");
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "create_affaire_from_import_lines",
    {
      p_import_id: importId,
      p_project_name: projectName,
      p_project_client: clientName,
      p_project_reference: reference,
      p_version_title: normalizeNullableText(parsed.data.versionTitle),
      p_section_title: normalizeNullableText(parsed.data.sectionTitle),
      p_lines: toRpcImportLines(
        sortValidLinesForEstimateCreation(normalizedRows.validLines)
      ),
    }
  );

  if (rpcError) {
    throw new Error("Impossible de creer l'affaire depuis l'import.");
  }

  const created = Array.isArray(rpcData)
    ? (rpcData[0] as RpcCreateAffaireFromImportRow | undefined)
    : undefined;

  if (!created?.project_id || !created.version_id) {
    throw new Error("La creation affaire + import a retourne une reponse invalide.");
  }

  const stats = buildImportFlowStats(normalizedRows, created.inserted_count ?? 0);
  revalidateQuickCreatePaths(created.project_id, created.version_id);

  const redirectParams = new URLSearchParams({
    fromQuickCreate: "1",
    projectId: created.project_id,
    importId,
    insertedRows: String(stats.insertedRows),
    skippedRows: String(stats.skippedRows),
    mappingId: mappingId ?? "",
  });

  redirect(`/dashboard/estimates/${created.version_id}/edit?${redirectParams.toString()}`);
}
