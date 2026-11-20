import { toNumber, toBooleanValue, getRootPayload, pickRecord, pickArray, parseOptionalNullableStringProperty } from "@/lib/estimates/client-json";
import { type EstimateVersionToken, parseVersionToken } from "@/lib/estimates/client-version";
import { requestJson } from "@/lib/estimates/client-requests";
import { isRecord, toNonEmptyString } from "@/lib/value-guards";

export type EstimateStructureDraftSourceKind =
  | "linked_dpgf"
  | "primary_cctp"
  | "historical_versions"
  | "template_library"
  | "assembly_library"
  | "project_notes"
  | "confirmed_brief";

export type EstimateStructureDraftStrategy = "hybrid";
export type EstimateStructureDraftNodeAction = "create" | "merge" | "skip";
export type EstimateStructureDraftApplyMode =
  | "create_empty"
  | "merge_existing";

export type EstimateStructureDraftEvidenceEntry = {
  type: "dpgf" | "cctp" | "history" | "template" | "assembly" | "brief";
  label: string;
  excerpt: string | null;
};

export type EstimateStructureDraftNode = {
  id: string;
  parentId: string | null;
  orderIndex: number;
  hierarchyLevel: number;
  label: string;
  normalizedLabel: string;
  confidence: number;
  confidenceLabel: "elevee" | "moyenne" | "faible";
  defaultAction: EstimateStructureDraftNodeAction;
  duplicateMatchItemId: string | null;
  duplicateMatchPath: string | null;
  provenance: EstimateStructureDraftEvidenceEntry[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  children: EstimateStructureDraftNode[];
};

export type EstimateStructureDraftSourceSummary = {
  kind: EstimateStructureDraftSourceKind;
  label: string;
  available: boolean;
  used: boolean;
  detail: string | null;
};

export type EstimateStructureDraftSummary = {
  rootCount: number;
  newCount: number;
  mergeCount: number;
  duplicateCount: number;
  lowConfidenceCount: number;
};

export type EstimateStructureDraft = {
  draftId: string;
  versionId: string;
  strategy: EstimateStructureDraftStrategy;
  sources: EstimateStructureDraftSourceSummary[];
  summary: EstimateStructureDraftSummary;
  nodes: EstimateStructureDraftNode[];
  generatedAt: string;
};

export type GenerateEstimateStructureDraftPayload = {
  strategy?: EstimateStructureDraftStrategy;
};

export type ApplyEstimateStructureDraftPayload = {
  mode: EstimateStructureDraftApplyMode;
  selectedRootNodeIds: string[];
  overrides?: Array<{
    nodeId: string;
    action: EstimateStructureDraftNodeAction;
    renameTo?: string | null;
    mergeIntoItemId?: string | null;
  }>;
};

export type ApplyEstimateStructureDraftResult = {
  draftId: string;
  versionId: string;
  mode: EstimateStructureDraftApplyMode;
  createdCount: number;
  mergedCount: number;
  skippedCount: number;
  createdItemIds: string[];
  mergedItemIds: string[];
  versionToken: EstimateVersionToken | null;
};

function isEstimateStructureDraftSourceKind(
  value: string
): value is EstimateStructureDraftSourceKind {
  return (
    value === "linked_dpgf" ||
    value === "primary_cctp" ||
    value === "historical_versions" ||
    value === "template_library" ||
    value === "assembly_library" ||
    value === "project_notes" ||
    value === "confirmed_brief"
  );
}

function isEstimateStructureDraftNodeAction(
  value: string
): value is EstimateStructureDraftNodeAction {
  return value === "create" || value === "merge" || value === "skip";
}

function isEstimateStructureDraftApplyMode(
  value: string
): value is EstimateStructureDraftApplyMode {
  return value === "create_empty" || value === "merge_existing";
}

function parseEstimateStructureDraftEvidenceEntry(
  value: unknown
): EstimateStructureDraftEvidenceEntry | null {
  if (!isRecord(value)) return null;

  const type = toNonEmptyString(value.type);
  const label = toNonEmptyString(value.label);
  if (
    !type ||
    !label ||
    (type !== "dpgf" &&
      type !== "cctp" &&
      type !== "history" &&
      type !== "template" &&
      type !== "assembly" &&
      type !== "brief")
  ) {
    return null;
  }

  return {
    type,
    label,
    excerpt: toNonEmptyString(value.excerpt),
  };
}

function parseEstimateStructureDraftNode(
  value: unknown
): EstimateStructureDraftNode | null {
  if (!isRecord(value)) return null;

  const id = toNonEmptyString(value.id);
  const label = toNonEmptyString(value.label);
  const normalizedLabel =
    toNonEmptyString(value.normalizedLabel) ??
    toNonEmptyString(value.normalized_label);
  const orderIndex =
    toNumber(value.orderIndex) ?? toNumber(value.order_index);
  const hierarchyLevel =
    toNumber(value.hierarchyLevel) ?? toNumber(value.hierarchy_level);
  const confidence = toNumber(value.confidence);
  const confidenceLabel =
    toNonEmptyString(value.confidenceLabel) ??
    toNonEmptyString(value.confidence_label);
  const defaultAction =
    toNonEmptyString(value.defaultAction) ??
    toNonEmptyString(value.default_action);

  if (
    !id ||
    !label ||
    !normalizedLabel ||
    orderIndex === null ||
    hierarchyLevel === null ||
    confidence === null ||
    !confidenceLabel ||
    (confidenceLabel !== "elevee" &&
      confidenceLabel !== "moyenne" &&
      confidenceLabel !== "faible") ||
    !defaultAction ||
    !isEstimateStructureDraftNodeAction(defaultAction)
  ) {
    return null;
  }

  const children = pickArray(value, ["children"])
    .map((entry) => parseEstimateStructureDraftNode(entry))
    .filter((entry): entry is EstimateStructureDraftNode => entry !== null);

  return {
    id,
    parentId:
      parseOptionalNullableStringProperty(value, ["parent_id", "parentId"]) ?? null,
    orderIndex: Math.max(0, Math.trunc(orderIndex)),
    hierarchyLevel: Math.max(1, Math.trunc(hierarchyLevel)),
    label,
    normalizedLabel,
    confidence: Math.max(0, Math.min(1, confidence)),
    confidenceLabel,
    defaultAction,
    duplicateMatchItemId:
      parseOptionalNullableStringProperty(value, [
        "duplicate_match_item_id",
        "duplicateMatchItemId",
      ]) ?? null,
    duplicateMatchPath:
      parseOptionalNullableStringProperty(value, [
        "duplicate_match_path",
        "duplicateMatchPath",
      ]) ?? null,
    provenance: pickArray(value, ["provenance"])
      .map((entry) => parseEstimateStructureDraftEvidenceEntry(entry))
      .filter(
        (entry): entry is EstimateStructureDraftEvidenceEntry => entry !== null
      ),
    facts: pickArray(value, ["facts"])
      .map((entry) => toNonEmptyString(entry))
      .filter((entry): entry is string => entry !== null),
    hypotheses: pickArray(value, ["hypotheses"])
      .map((entry) => toNonEmptyString(entry))
      .filter((entry): entry is string => entry !== null),
    inferences: pickArray(value, ["inferences"])
      .map((entry) => toNonEmptyString(entry))
      .filter((entry): entry is string => entry !== null),
    children,
  };
}

function parseEstimateStructureDraftSourceSummary(
  value: unknown
): EstimateStructureDraftSourceSummary | null {
  if (!isRecord(value)) return null;

  const kind = toNonEmptyString(value.kind);
  const label = toNonEmptyString(value.label);
  if (!kind || !label || !isEstimateStructureDraftSourceKind(kind)) {
    return null;
  }

  return {
    kind,
    label,
    available: toBooleanValue(value.available) ?? false,
    used: toBooleanValue(value.used) ?? false,
    detail: toNonEmptyString(value.detail),
  };
}

function parseEstimateStructureDraftSummary(
  value: unknown
): EstimateStructureDraftSummary | null {
  if (!isRecord(value)) return null;

  const rootCount = toNumber(value.rootCount) ?? toNumber(value.root_count);
  const newCount = toNumber(value.newCount) ?? toNumber(value.new_count);
  const mergeCount = toNumber(value.mergeCount) ?? toNumber(value.merge_count);
  const duplicateCount =
    toNumber(value.duplicateCount) ?? toNumber(value.duplicate_count);
  const lowConfidenceCount =
    toNumber(value.lowConfidenceCount) ?? toNumber(value.low_confidence_count);

  if (
    rootCount === null ||
    newCount === null ||
    mergeCount === null ||
    duplicateCount === null ||
    lowConfidenceCount === null
  ) {
    return null;
  }

  return {
    rootCount: Math.max(0, Math.trunc(rootCount)),
    newCount: Math.max(0, Math.trunc(newCount)),
    mergeCount: Math.max(0, Math.trunc(mergeCount)),
    duplicateCount: Math.max(0, Math.trunc(duplicateCount)),
    lowConfidenceCount: Math.max(0, Math.trunc(lowConfidenceCount)),
  };
}

function parseEstimateStructureDraft(
  payload: unknown
): EstimateStructureDraft | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const draftId = toNonEmptyString(root.draftId) ?? toNonEmptyString(root.draft_id);
  const versionId =
    toNonEmptyString(root.versionId) ?? toNonEmptyString(root.version_id);
  const strategy = toNonEmptyString(root.strategy);
  const generatedAt =
    toNonEmptyString(root.generatedAt) ?? toNonEmptyString(root.generated_at);
  const summary = parseEstimateStructureDraftSummary(
    pickRecord(root, ["summary"]) ?? root.summary
  );

  if (!draftId || !versionId || strategy !== "hybrid" || !generatedAt || !summary) {
    return null;
  }

  return {
    draftId,
    versionId,
    strategy,
    sources: pickArray(root, ["sources"])
      .map((entry) => parseEstimateStructureDraftSourceSummary(entry))
      .filter(
        (entry): entry is EstimateStructureDraftSourceSummary => entry !== null
      ),
    summary,
    nodes: pickArray(root, ["nodes"])
      .map((entry) => parseEstimateStructureDraftNode(entry))
      .filter((entry): entry is EstimateStructureDraftNode => entry !== null),
    generatedAt,
  };
}

function parseApplyEstimateStructureDraftResult(
  payload: unknown
): ApplyEstimateStructureDraftResult | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const draftId = toNonEmptyString(root.draftId) ?? toNonEmptyString(root.draft_id);
  const versionId =
    toNonEmptyString(root.versionId) ?? toNonEmptyString(root.version_id);
  const mode = toNonEmptyString(root.mode);
  const createdCount =
    toNumber(root.createdCount) ?? toNumber(root.created_count);
  const mergedCount =
    toNumber(root.mergedCount) ?? toNumber(root.merged_count);
  const skippedCount =
    toNumber(root.skippedCount) ?? toNumber(root.skipped_count);

  if (
    !draftId ||
    !versionId ||
    !mode ||
    !isEstimateStructureDraftApplyMode(mode) ||
    createdCount === null ||
    mergedCount === null ||
    skippedCount === null
  ) {
    return null;
  }

  const createdItemIds = pickArray(root, ["createdItemIds", "created_item_ids"])
    .map((entry) => toNonEmptyString(entry))
    .filter((entry): entry is string => entry !== null);
  const mergedItemIds = pickArray(root, ["mergedItemIds", "merged_item_ids"])
    .map((entry) => toNonEmptyString(entry))
    .filter((entry): entry is string => entry !== null);

  return {
    draftId,
    versionId,
    mode,
    createdCount: Math.max(0, Math.trunc(createdCount)),
    mergedCount: Math.max(0, Math.trunc(mergedCount)),
    skippedCount: Math.max(0, Math.trunc(skippedCount)),
    createdItemIds,
    mergedItemIds,
    versionToken: parseVersionToken(root),
  };
}

export async function generateEstimateStructureDraft(
  targetVersionId: string,
  input: GenerateEstimateStructureDraftPayload = {}
): Promise<EstimateStructureDraft> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${targetVersionId}/structure-drafts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        strategy: input.strategy ?? "hybrid",
      }),
    },
    "Impossible de générer la prévisualisation de structure."
  );

  const parsed = parseEstimateStructureDraft(payload);
  if (!parsed) {
    throw new Error("Impossible de lire la preview de structure.");
  }

  return parsed;
}

export async function fetchEstimateStructureDraft(
  targetVersionId: string,
  draftId: string
): Promise<EstimateStructureDraft> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${targetVersionId}/structure-drafts/${draftId}`,
    {
      method: "GET",
    },
    "Impossible de charger la preview de structure."
  );

  const parsed = parseEstimateStructureDraft(payload);
  if (!parsed) {
    throw new Error("Impossible de lire la preview de structure.");
  }

  return parsed;
}

export async function applyEstimateStructureDraft(
  targetVersionId: string,
  draftId: string,
  input: ApplyEstimateStructureDraftPayload
): Promise<ApplyEstimateStructureDraftResult> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${targetVersionId}/structure-drafts/${draftId}/apply`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: input.mode,
        selectedRootNodeIds: input.selectedRootNodeIds,
        overrides: (input.overrides ?? []).map((override) => ({
          nodeId: override.nodeId,
          action: override.action,
          renameTo: override.renameTo ?? null,
          mergeIntoItemId: override.mergeIntoItemId ?? null,
        })),
      }),
    },
    "Impossible d'appliquer la preview de structure.",
    undefined,
    { mutation: { versionId: targetVersionId, structural: true } }
  );

  const parsed = parseApplyEstimateStructureDraftResult(payload);
  if (!parsed) {
    throw new Error("Impossible de lire le résultat d'application.");
  }

  return parsed;
}
