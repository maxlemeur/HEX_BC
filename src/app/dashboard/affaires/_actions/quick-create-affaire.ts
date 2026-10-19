"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  getCurrentMembershipOrThrow,
  getImportOrThrow,
  normalizeNullableText,
  type Supabase,
} from "@/lib/affaires/import-flow-server";
import { readTenantCalcPolicy } from "@/lib/estimates/calc-policy-server";
import { createEstimate } from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const affaireProjectMetadataSchema = z.object({
  projectName: z.string().trim().min(1, "Nom projet requis.").max(200),
  clientName: z.string().trim().max(200).nullable().optional(),
  reference: z.string().trim().max(200).nullable().optional(),
});

export type InitializeAffaireDraftInput = z.infer<typeof affaireProjectMetadataSchema>;

export type InitializeAffaireDraftResult = {
  projectId: string;
  versionId: string;
  redirectUrl: string;
  manualEstimate: ManualEstimateEntryPointResult;
};

export type ManualEstimateEntryPointResult = {
  mode: "manual";
  creationMode: "blank";
  projectId: string;
  versionId: string;
  editorRedirectUrl: string;
};

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
    throw new Error("Accès refuse: rôle non autorise pour cette action.");
  }
}

function buildManualEstimateEntryPoint(
  projectId: string,
  versionId: string
): ManualEstimateEntryPointResult {
  return {
    mode: "manual",
    creationMode: "blank",
    projectId,
    versionId,
    editorRedirectUrl: `/dashboard/estimates/${versionId}/edit?entry=manual`,
  };
}

/**
 * Sous-lot 2.10a (N1) : une version vierge a des réglages neutres pour tout moteur ; l'action déclare donc le moteur
 * de la politique qu'elle lit, comme l'import de l'affaire. La création relit la politique sous verrou : une
 * politique changée entre-temps donne CONTEXT_CHANGED sans rien écrire (D3).
 */
async function readExpectedCreationEngine(supabase: Supabase, tenantId: string) {
  return (await readTenantCalcPolicy(supabase, tenantId)).engine;
}

async function createProjectWithBlankEstimate({
  projectName,
  clientName,
  reference,
  linkedImportId,
  expectedEngine,
}: {
  projectName: string;
  clientName: string | null;
  reference: string | null;
  linkedImportId?: string | null;
  expectedEngine: 2 | 3;
}) {
  const created = await createEstimate({
    project: {
      name: projectName,
      client_name: clientName,
      reference,
    },
    creation_mode: "blank",
    version: { expected_calc_engine_version: expectedEngine },
    ...(linkedImportId ? { linked_import_id: linkedImportId } : {}),
  });

  return {
    projectId: created.project.id,
    versionId: created.version.id,
  };
}

async function getQuickCreateContext() {
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
  const isTenantAdmin = membership.role === "admin";

  return {
    supabase,
    membership,
    userId: user.id,
    isTenantAdmin,
  };
}

async function createAndOptionallyLinkEmptyAffaire(input: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  membership: Awaited<ReturnType<typeof getQuickCreateContext>>["membership"];
  userId: string;
  isTenantAdmin: boolean;
  projectName: string;
  clientName: string | null;
  reference: string | null;
  linkImportId?: string | null;
}): Promise<InitializeAffaireDraftResult> {
  if (input.linkImportId) {
    const importRow = await getImportOrThrow({
      supabase: input.supabase,
      importId: input.linkImportId,
      tenantId: input.membership.tenant_id,
      userId: input.userId,
      isTenantAdmin: input.isTenantAdmin,
    });

    if (importRow.project_id) {
      throw new Error("Cet import est déjà lié a une autre affaire.");
    }
  }

  const { projectId, versionId } = await createProjectWithBlankEstimate({
    projectName: input.projectName,
    clientName: input.clientName,
    reference: input.reference,
    linkedImportId: input.linkImportId,
    expectedEngine: await readExpectedCreationEngine(input.supabase, input.membership.tenant_id),
  });

  const manualEstimate = buildManualEstimateEntryPoint(projectId, versionId);
  revalidateQuickCreatePaths(projectId, versionId);

  return {
    projectId,
    versionId,
    redirectUrl: manualEstimate.editorRedirectUrl,
    manualEstimate,
  };
}

export async function initializeAffaireDraft(
  input: InitializeAffaireDraftInput & { linkImportId?: string | null }
): Promise<InitializeAffaireDraftResult> {
  const parsed = affaireProjectMetadataSchema
    .extend({
      linkImportId: z.string().uuid("linkImportId invalide.").nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload de création affaire invalide.");
  }

  const context = await getQuickCreateContext();

  return createAndOptionallyLinkEmptyAffaire({
    supabase: context.supabase,
    membership: context.membership,
    userId: context.userId,
    isTenantAdmin: context.isTenantAdmin,
    projectName: parsed.data.projectName.trim(),
    clientName: normalizeNullableText(parsed.data.clientName),
    reference: normalizeNullableText(parsed.data.reference),
    linkImportId: parsed.data.linkImportId ?? null,
  });
}
