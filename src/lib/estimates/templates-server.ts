import { instantiateCanonicalEstimateV2FromTemplate } from "@/lib/estimates/canonical-v2-creation";
import {
  loadEstimateTemplateItems,
  loadEstimateTemplateOrThrow,
  loadTemplateLineCountByTemplateId,
  throwTemplateNameConflictIfNeeded,
  throwTemplateNotFoundIfNeeded,
  throwTemplateSourceVersionNotFoundIfNeeded,
  toRpcUuid,
  toTemplateSummary,
} from "@/lib/estimates/estimate-template-helpers";
import {
  getAuthenticatedContext,
  toNullableText,
} from "@/lib/estimates/server-context";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

type Supabase = SupabaseClient<Database>;
type EstimateTemplateRow = Database["public"]["Tables"]["estimate_templates"]["Row"];
import {
  badRequest,
  internalError,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import { linkTakeoffJobsFromSourceVersionToTargetVersion } from "@/lib/takeoff/version-links";
import type {
  CreateEstimateTemplateFromVersionInput,
  DuplicateEstimateTemplateInput,
  InstantiateEstimateFromTemplateInput,
  ListEstimateTemplatesQueryInput,
  UpdateEstimateTemplateInput,
} from "@/lib/estimates/schemas";

export async function listEstimateTemplates(query: ListEstimateTemplatesQueryInput) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  let templatesQuery = supabase
    .from("estimate_templates")
    .select("*")
    .eq("tenant_id", tenantId);

  const search = toNullableText(query.search);
  if (search) {
    templatesQuery = templatesQuery.or(
      `name.ilike.%${search}%,description.ilike.%${search}%`
    );
  }

  const { data, error } = await templatesQuery
    .order("updated_at", { ascending: query.order === "oldest" })
    .limit(query.limit);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les templates.");
  }

  const templates = (data ?? []) as unknown as EstimateTemplateRow[];
  const lineCountByTemplateId = await loadTemplateLineCountByTemplateId({
    supabase,
    tenantId,
    templateIds: templates.map((template) => template.id),
  });

  return {
    templates: templates.map((template) =>
      toTemplateSummary(template, lineCountByTemplateId.get(template.id) ?? 0)
    ),
  };
}

export async function getEstimateTemplate(templateId: string) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  const template = await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId,
  });
  const items = await loadEstimateTemplateItems({
    supabase,
    tenantId,
    templateId,
  });
  const lineCount = items.filter((item) => item.item_type === "line").length;

  return {
    template: {
      ...toTemplateSummary(template, lineCount),
      items,
    },
  };
}

export async function createEstimateTemplateFromVersion(
  input: CreateEstimateTemplateFromVersionInput
) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  const { data, error } = await supabase.rpc(
    "create_estimate_template_from_version",
    {
      p_source_version_id: input.source_version_id,
      p_name: input.name.trim(),
      p_description: toNullableText(input.description),
    }
  );

  if (error) {
    throwTemplateNameConflictIfNeeded(error);
    throwTemplateSourceVersionNotFoundIfNeeded(error);
    throw mapSupabaseError(error, "Impossible de créer le template.");
  }

  const templateId = toRpcUuid(data);
  if (!templateId) {
    throw badRequest("Impossible de créer le template.");
  }

  const template = await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId,
  });
  const lineCountByTemplateId = await loadTemplateLineCountByTemplateId({
    supabase,
    tenantId,
    templateIds: [template.id],
  });

  return {
    template: toTemplateSummary(
      template,
      lineCountByTemplateId.get(template.id) ?? 0
    ),
  };
}

export async function updateEstimateTemplate(
  templateId: string,
  input: UpdateEstimateTemplateInput
) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId,
  });

  const payload: { name?: string; description?: string | null } = {};

  if ("name" in input) {
    payload.name = (input.name ?? "").trim();
  }
  if ("description" in input) {
    payload.description = toNullableText(input.description);
  }

  const { data, error } = await supabase
    .from("estimate_templates")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", templateId)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throwTemplateNameConflictIfNeeded(error);
      throw mapSupabaseError(error, "Impossible de mettre a jour le template.");
    }
    throw badRequest("Impossible de mettre a jour le template.");
  }

  const updatedTemplate = data as unknown as EstimateTemplateRow;
  const lineCountByTemplateId = await loadTemplateLineCountByTemplateId({
    supabase,
    tenantId,
    templateIds: [updatedTemplate.id],
  });

  return {
    template: toTemplateSummary(
      updatedTemplate,
      lineCountByTemplateId.get(updatedTemplate.id) ?? 0
    ),
  };
}

export async function deleteEstimateTemplate(templateId: string) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId,
  });

  const { error: deleteItemsError } = await supabase
    .from("estimate_template_items")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("template_id", templateId);

  if (deleteItemsError) {
    throw mapSupabaseError(deleteItemsError, "Impossible de supprimer le template.");
  }

  const { error: deleteTemplateError } = await supabase
    .from("estimate_templates")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", templateId);

  if (deleteTemplateError) {
    throw mapSupabaseError(deleteTemplateError, "Impossible de supprimer le template.");
  }

  return {
    deleted_id: templateId,
  };
}

export async function duplicateEstimateTemplate(
  templateId: string,
  input: DuplicateEstimateTemplateInput
) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  const { data, error } = await supabase.rpc("duplicate_estimate_template", {
    p_template_id: templateId,
    p_name: toNullableText(input.name) ?? "",
  });

  if (error) {
    throwTemplateNameConflictIfNeeded(error);
    throwTemplateNotFoundIfNeeded(error);
    throw mapSupabaseError(error, "Impossible de dupliquer le template.");
  }

  const duplicatedTemplateId = toRpcUuid(data);
  if (!duplicatedTemplateId) {
    throw badRequest("Impossible de dupliquer le template.");
  }

  const duplicatedTemplate = await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId: duplicatedTemplateId,
  });
  const lineCountByTemplateId = await loadTemplateLineCountByTemplateId({
    supabase,
    tenantId,
    templateIds: [duplicatedTemplate.id],
  });

  return {
    template: toTemplateSummary(
      duplicatedTemplate,
      lineCountByTemplateId.get(duplicatedTemplate.id) ?? 0
    ),
  };
}

async function tryCarryOverTakeoffJobsToNewVersion(input: {
  supabase: Supabase;
  tenantId: string;
  userId: string;
  sourceVersionId: string | null;
  targetVersionId: string;
}) {
  if (!input.sourceVersionId) {
    return;
  }

  try {
    await linkTakeoffJobsFromSourceVersionToTargetVersion({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
      sourceVersionId: input.sourceVersionId,
      targetVersionId: input.targetVersionId,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Unexpected table:")
    ) {
      return;
    }

    console.warn("takeoff carry-over skipped", {
      sourceVersionId: input.sourceVersionId,
      targetVersionId: input.targetVersionId,
      error,
    });
  }
}

async function resolveLatestProjectVersionId(input: {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
}): Promise<string | null> {
  const { data, error } = await input.supabase
    .from("estimate_versions")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("version_number", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la version courante du projet.");
  }

  return data?.id ?? null;
}

export async function instantiateEstimateFromTemplate(
  templateId: string,
  input: InstantiateEstimateFromTemplateInput
) {
  const { supabase, tenantId, userId } = await getAuthenticatedContext();
  const targetProjectId = input.project_id ?? null;
  const projectName = toNullableText(input.project_name);

  if (!targetProjectId && !projectName) {
    throw badRequest(
      "project_name ou project_id est requis.",
      undefined,
      "ESTIMATE_TEMPLATE_PROJECT_REQUIRED"
    );
  }

  const sourceVersionIdForCarryOver = targetProjectId
    ? await resolveLatestProjectVersionId({
        supabase,
        tenantId,
        projectId: targetProjectId,
      })
    : null;

  let created: Awaited<ReturnType<typeof instantiateCanonicalEstimateV2FromTemplate>>;
  try {
    created = await instantiateCanonicalEstimateV2FromTemplate({
      supabase,
      tenantId,
      actorUserId: userId,
      templateId,
      project: targetProjectId
        ? { kind: "existing", id: targetProjectId }
        : {
            kind: "new",
            name: projectName!,
            notes: toNullableText(input.project_notes),
          },
      versionTitle: toNullableText(input.version_title),
      dateDevis: input.date_devis ?? null,
      validiteJours: input.validite_jours ?? null,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "ESTIMATE_CANONICAL_V2_TEMPLATE_NOT_FOUND"
    ) {
      throw notFound(
        "Template introuvable.",
        error,
        "ESTIMATE_TEMPLATE_NOT_FOUND"
      );
    }
    if (
      error instanceof Error &&
      error.message === "ESTIMATE_CANONICAL_V2_PROJECT_NOT_FOUND"
    ) {
      throw notFound(
        "Projet cible introuvable.",
        error,
        "ESTIMATE_TEMPLATE_TARGET_PROJECT_NOT_FOUND"
      );
    }
    throw internalError(
      "Impossible d'instancier le template.",
      error,
      "ESTIMATE_TEMPLATE_INSTANTIATE_FAILED"
    );
  }
  const projectId = created.project.id;
  const versionId = created.version.id;

  await tryCarryOverTakeoffJobsToNewVersion({
    supabase,
    tenantId,
    userId,
    sourceVersionId: sourceVersionIdForCarryOver,
    targetVersionId: versionId,
  });

  return {
    projectId,
    versionId,
    redirectTo: `/dashboard/estimates/${versionId}/edit`,
  };
}
