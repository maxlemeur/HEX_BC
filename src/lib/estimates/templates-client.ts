import {
  type JsonRecord,
  toNumber,
  getRootPayload,
  extractEntity,
  libraryListPath,
  parseLibraryList,
  pickRecordArray,
} from "@/lib/estimates/client-json";
import { jsonRequest } from "@/lib/estimates/client-http";
import { requestJson } from "@/lib/estimates/client-requests";
import { type EstimateItem, parseEstimateItems } from "@/lib/estimates/editor-read-client";
import type { Database } from "@/types/database";
import { isRecord, toNonEmptyString } from "@/lib/value-guards";

type EstimateTemplateItem =
  Database["public"]["Tables"]["estimate_template_items"]["Row"];

export type EstimateTemplateSummary = {
  id: string;
  name: string;
  description: string | null;
  sourceVersionId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
};

export type EstimateTemplateDetail = EstimateTemplateSummary & {
  items: EstimateTemplateItem[];
};

export type CreateEstimateTemplatePayload = {
  sourceVersionId: string;
  name: string;
  description?: string | null;
};

export type UpdateEstimateTemplatePayload = {
  name?: string;
  description?: string | null;
};

export type InstantiateEstimateTemplatePayload = {
  projectName?: string;
  projectId?: string;
  versionTitle?: string | null;
  dateDevis?: string;
  validiteJours?: number;
  projectNotes?: string | null;
  /** Sous-lot 2.10a (D3) : moteur des nouvelles versions lu par la page. */
  expectedCalcEngineVersion?: 2 | 3;
};

/** Sous-lot 2.10a (P-12, D-h) : modèle entré dans une v3, lignes converties et réglages non repris. */
export type InstantiateEstimateTemplateConversion = {
  convertedLines: Array<{ title: string; templateHours: number; convertedHours: number }>;
  droppedSettings: Array<{ setting: string; label: string }>;
};

export type InstantiateEstimateTemplateResult = {
  projectId: string;
  versionId: string;
  redirectTo: string;
  /** Absent hors moteur 3. */
  conversion?: InstantiateEstimateTemplateConversion;
};

function parseEstimateTemplateSummaryEntity(
  value: unknown
): EstimateTemplateSummary | null {
  if (!isRecord(value)) return null;

  const id = toNonEmptyString(value.id);
  const name = toNonEmptyString(value.name);
  const createdAt = toNonEmptyString(value.created_at);
  const updatedAt = toNonEmptyString(value.updated_at);
  if (!id || !name || !createdAt || !updatedAt) return null;

  return {
    id,
    name,
    description: toNonEmptyString(value.description),
    sourceVersionId:
      toNonEmptyString(value.source_version_id) ??
      toNonEmptyString(value.sourceVersionId) ??
      null,
    createdBy:
      toNonEmptyString(value.created_by) ?? toNonEmptyString(value.createdBy) ?? null,
    createdAt,
    updatedAt,
    itemCount:
      toNumber(value.item_count) ??
      toNumber(value.itemCount) ??
      0,
  };
}

function parseEstimateTemplateDetail(payload: unknown): EstimateTemplateDetail {
  const root = getRootPayload(payload);
  const templateEntity = extractEntity(root, ["template"]);
  const summary = parseEstimateTemplateSummaryEntity(templateEntity);
  if (!summary) {
    throw new Error("Impossible de récupérer le template.");
  }

  const items = pickRecordArray<EstimateTemplateItem>(
    (templateEntity as JsonRecord | null)?.items ?? (isRecord(root) ? root.items : null)
  );

  return {
    ...summary,
    items,
  };
}

function parseInstantiateTemplateResult(payload: unknown) {
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    throw new Error("Impossible d'instancier le template.");
  }

  const versionId =
    toNonEmptyString(root.version_id) ??
    toNonEmptyString(root.versionId);
  const projectId =
    toNonEmptyString(root.project_id) ??
    toNonEmptyString(root.projectId);
  const redirectTo =
    toNonEmptyString(root.redirect_to) ??
    toNonEmptyString(root.redirectTo) ??
    (versionId ? `/dashboard/estimates/${versionId}/edit` : null);

  if (!versionId || !projectId || !redirectTo) {
    throw new Error("Impossible d'instancier le template.");
  }

  // Sous-lot 2.10a : rapport d'un modèle entré dans une v3 (les deux listes, ou aucune hors moteur 3).
  const conversion: InstantiateEstimateTemplateConversion | undefined =
    Array.isArray(root.converted_lines) && Array.isArray(root.dropped_settings)
      ? {
          convertedLines: root.converted_lines.flatMap((line) => {
            if (!isRecord(line)) return [];
            const title = toNonEmptyString(line.title);
            const templateHours = toNumber(line.template_hours);
            const convertedHours = toNumber(line.converted_hours);
            return title !== null && templateHours !== null && convertedHours !== null
              ? [{ title, templateHours, convertedHours }]
              : [];
          }),
          droppedSettings: root.dropped_settings.flatMap((entry) => {
            if (!isRecord(entry)) return [];
            const setting = toNonEmptyString(entry.setting);
            const label = toNonEmptyString(entry.label);
            return setting !== null && label !== null ? [{ setting, label }] : [];
          }),
        }
      : undefined;

  return {
    projectId,
    versionId,
    redirectTo,
    ...(conversion ? { conversion } : {}),
  };
}

export async function fetchEstimateTemplates(options?: {
  search?: string;
  limit?: number;
  order?: "recent" | "oldest";
}): Promise<EstimateTemplateSummary[]> {
  const payload = await requestJson<unknown>(
    libraryListPath("/api/estimates/templates", options),
    {
      method: "GET",
    },
    "Impossible de charger les templates."
  );

  return parseLibraryList(payload, "templates", parseEstimateTemplateSummaryEntity);
}

export async function fetchEstimateTemplate(
  templateId: string
): Promise<EstimateTemplateDetail> {
  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}`,
    {
      method: "GET",
    },
    "Impossible de charger le template."
  );

  return parseEstimateTemplateDetail(payload);
}

export async function createEstimateTemplate(
  input: CreateEstimateTemplatePayload
): Promise<EstimateTemplateSummary> {
  const payload = await requestJson<unknown>(
    "/api/estimates/templates",
    jsonRequest("POST", {
      sourceVersionId: input.sourceVersionId,
      name: input.name,
      description: input.description ?? null,
    }),
    "Impossible de créer le template."
  );

  const entity = extractEntity(payload, ["template"]);
  const parsed = parseEstimateTemplateSummaryEntity(entity);
  if (!parsed) {
    throw new Error("Impossible de créer le template.");
  }

  return parsed;
}

export async function updateEstimateTemplate(
  templateId: string,
  updates: UpdateEstimateTemplatePayload
): Promise<EstimateTemplateSummary> {
  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}`,
    jsonRequest("PATCH", updates),
    "Impossible de mettre à jour le template."
  );

  const entity = extractEntity(payload, ["template"]);
  const parsed = parseEstimateTemplateSummaryEntity(entity);
  if (!parsed) {
    throw new Error("Impossible de mettre à jour le template.");
  }

  return parsed;
}

export async function deleteEstimateTemplate(templateId: string): Promise<void> {
  await requestJson<unknown>(
    `/api/estimates/templates/${templateId}`,
    {
      method: "DELETE",
    },
    "Impossible de supprimer le template."
  );
}

export async function duplicateEstimateTemplate(
  templateId: string,
  options?: { name?: string | null }
): Promise<EstimateTemplateSummary> {
  const body: Record<string, unknown> = {};
  if (options?.name && options.name.trim().length > 0) {
    body.name = options.name.trim();
  }

  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}/duplicate`,
    jsonRequest("POST", body),
    "Impossible de dupliquer le template."
  );

  const entity = extractEntity(payload, ["template"]);
  const parsed = parseEstimateTemplateSummaryEntity(entity);
  if (!parsed) {
    throw new Error("Impossible de dupliquer le template.");
  }

  return parsed;
}

export async function instantiateEstimateFromTemplate(
  templateId: string,
  input: InstantiateEstimateTemplatePayload
): Promise<InstantiateEstimateTemplateResult> {
  const projectName = input.projectName?.trim() ?? null;
  const projectId = input.projectId?.trim() ?? null;

  if (!projectId && !projectName) {
    throw new Error("projectName ou projectId est requis.");
  }

  const requestBody: Record<string, unknown> = {
    versionTitle: input.versionTitle ?? null,
    dateDevis: input.dateDevis,
    validiteJours: input.validiteJours,
    projectNotes: input.projectNotes ?? null,
    ...(input.expectedCalcEngineVersion != null
      ? { expectedCalcEngineVersion: input.expectedCalcEngineVersion }
      : {}),
  };

  if (projectId) {
    requestBody.projectId = projectId;
  }

  if (projectName) {
    requestBody.projectName = projectName;
  }

  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}/instantiate`,
    jsonRequest("POST", requestBody),
    "Impossible d'instancier le template."
  );

  return parseInstantiateTemplateResult(payload);
}

export async function insertTemplateIntoVersion(
  templateId: string,
  input: {
    versionId: string;
    afterItemId?: string | null;
  }
): Promise<EstimateItem[]> {
  const params = new URLSearchParams();
  params.set("versionId", input.versionId);

  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}/insert?${params.toString()}`,
    jsonRequest("POST", {
      afterItemId: input.afterItemId ?? null,
    }),
    "Impossible d'insérer le template.",
    undefined,
    { mutation: { versionId: input.versionId, structural: true } }
  );

  return parseEstimateItems(payload);
}
