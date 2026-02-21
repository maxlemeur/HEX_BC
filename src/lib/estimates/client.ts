import type { Database } from "@/types/database";

type EstimateProjectRow =
  Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateTemplateItem =
  Database["public"]["Tables"]["estimate_template_items"]["Row"];
type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
type MarginTier = Database["public"]["Tables"]["margin_tiers"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];

export type EstimateStatus = Database["public"]["Enums"]["estimate_status"];

const ESTIMATE_STATUS_VALUES: EstimateStatus[] = [
  "draft",
  "sent",
  "accepted",
  "archived",
];

type JsonRecord = Record<string, unknown>;

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
    code?: string;
    details?: unknown;
  };
};

export type EstimateListItem = {
  projectId: string;
  projectName: string;
  projectReference: string | null;
  projectClient: string | null;
  versionId: string;
  versionNumber: number;
  status: EstimateStatus;
  title: string | null;
  updatedAt: string;
  totalHtCents: number;
};

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
  projectName: string;
  versionTitle?: string | null;
  dateDevis?: string;
  validiteJours?: number;
};

export type EstimateVersionWithProject = EstimateVersionRow & {
  estimate_projects:
    | Pick<
        EstimateProjectRow,
        "id" | "name" | "reference" | "client_name" | "is_archived"
      >
    | Pick<
        EstimateProjectRow,
        "id" | "name" | "reference" | "client_name" | "is_archived"
      >[]
    | { name: string }
    | { name: string }[]
    | null;
};

export type EstimateEditorData = {
  version: EstimateVersionWithProject;
  items: EstimateItem[];
  categories: EstimateCategory[];
  supplyTypes: SupplyType[];
  laborRoles: LaborRole[];
  marginTiers: MarginTier[];
  suggestionRules: SuggestionRule[];
};

export type CreateEstimatePayload = {
  projectName: string;
  title: string | null;
  dateDevis: string;
  validiteJours: number;
  marginMultiplier?: number;
};

export type EstimateVersionToken = Pick<EstimateVersionRow, "id" | "updated_at">;

export type BulkUpdateEstimateItemsResult = {
  updatedCount: number;
  versionToken: EstimateVersionToken;
};

export type BulkUpdateEstimateVersionPatch = Pick<
  EstimateVersionRow,
  "total_ht_cents" | "total_tax_cents" | "total_ttc_cents"
>;

export type SuggestionRuleFeedback = "accept" | "reject";

export type EstimateDraftLock = {
  versionId: string;
  userId: string | null;
  holderName: string | null;
  lockedAt: string | null;
  expiresAt: string | null;
  isOwnedByCurrentUser: boolean | null;
};

export type AcquireEstimateDraftLockResult = {
  acquired: boolean;
  lock: EstimateDraftLock | null;
};

export type RenewEstimateDraftLockResult = {
  renewed: boolean;
  lock: EstimateDraftLock | null;
};

export type ReleaseEstimateDraftLockOptions = {
  force?: boolean;
  keepalive?: boolean;
};

export type ReleaseEstimateDraftLockResult = {
  released: boolean;
};

export class EstimateApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  readonly code: string | null;

  constructor(
    message: string,
    status: number,
    details: unknown,
    code: string | null
  ) {
    super(message);
    this.name = "EstimateApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export function isEstimateApiError(error: unknown): error is EstimateApiError {
  return error instanceof EstimateApiError;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function isEstimateStatus(value: string): value is EstimateStatus {
  return ESTIMATE_STATUS_VALUES.includes(value as EstimateStatus);
}

function getRootPayload(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  if (payload.data !== undefined) return payload.data;
  return payload;
}

function extractEntity(payload: unknown, keys: string[]): JsonRecord | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  for (const key of keys) {
    const value = root[key];
    if (isRecord(value)) return value;
    if (Array.isArray(value) && value.length > 0 && isRecord(value[0])) {
      return value[0] as JsonRecord;
    }
  }

  if (typeof root.id === "string") {
    return root;
  }

  return null;
}

function extractString(payload: unknown, keys: string[]): string | null {
  const root = getRootPayload(payload);

  if (typeof root === "string") {
    const trimmed = root.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!isRecord(root)) return null;

  for (const key of keys) {
    const value = root[key];
    const parsed = toStringValue(value);
    if (parsed) return parsed;
  }

  return null;
}

function extractBoolean(payload: unknown, keys: string[]): boolean | null {
  const root = getRootPayload(payload);

  if (!isRecord(root)) return null;

  for (const key of keys) {
    const value = root[key];
    const parsed = toBooleanValue(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

function pickRecord(root: JsonRecord, keys: string[]): JsonRecord | null {
  for (const key of keys) {
    const value = root[key];
    if (isRecord(value)) return value;
    if (Array.isArray(value) && value.length > 0 && isRecord(value[0])) {
      return value[0] as JsonRecord;
    }
  }
  return null;
}

function toErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.length > 0) return trimmed;
  }

  if (!isRecord(payload)) return fallback;

  const envelope = payload as ApiEnvelope<unknown>;
  const candidates = [
    envelope.error?.message,
    envelope.error?.code,
    payload.message,
    payload.error,
    payload.details,
  ];

  for (const candidate of candidates) {
    const parsed = toStringValue(candidate);
    if (parsed) return parsed;
  }

  return fallback;
}

function extractErrorDetails(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;

  const envelope = payload as ApiEnvelope<unknown>;

  if (envelope.error?.details !== undefined) {
    return envelope.error.details;
  }

  if (payload.details !== undefined) {
    return payload.details;
  }

  return payload;
}

function extractErrorCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const envelope = payload as ApiEnvelope<unknown>;
  return (
    toStringValue(envelope.error?.code) ??
    toStringValue(payload.code) ??
    null
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new EstimateApiError(
      toErrorMessage(payload, fallbackMessage),
      response.status,
      extractErrorDetails(payload),
      extractErrorCode(payload)
    );
  }

  const root = getRootPayload(payload);
  return root as T;
}

function normalizeEstimateListItem(value: unknown): EstimateListItem | null {
  if (!isRecord(value)) return null;

  const projectNode = (() => {
    if (isRecord(value.estimate_projects)) {
      return value.estimate_projects;
    }
    if (Array.isArray(value.estimate_projects)) {
      const first = value.estimate_projects[0];
      if (isRecord(first)) return first;
    }
    return null;
  })();

  const projectId =
    toStringValue(value.projectId) ??
    toStringValue(value.project_id) ??
    (projectNode ? toStringValue(projectNode.id) : null);
  const projectName =
    toStringValue(value.projectName) ??
    toStringValue(value.project_name) ??
    (projectNode ? toStringValue(projectNode.name) : null);
  const versionId =
    toStringValue(value.versionId) ??
    toStringValue(value.version_id) ??
    toStringValue(value.id);
  const versionNumber =
    toNumber(value.versionNumber) ?? toNumber(value.version_number);
  const statusValue =
    toStringValue(value.status) ??
    toStringValue(value.estimate_status) ??
    toStringValue(value.version_status);
  const updatedAt =
    toStringValue(value.updatedAt) ?? toStringValue(value.updated_at);
  const totalHtCents =
    toNumber(value.totalHtCents) ??
    toNumber(value.total_ht_cents) ??
    toNumber(value.total);

  if (
    !projectId ||
    !projectName ||
    !versionId ||
    versionNumber === null ||
    !statusValue ||
    !updatedAt ||
    totalHtCents === null ||
    !isEstimateStatus(statusValue)
  ) {
    return null;
  }

  const title =
    toStringValue(value.title) ?? toStringValue(value.version_title) ?? null;

  const projectReference =
    toStringValue(value.projectReference) ??
    toStringValue(value.project_reference) ??
    (projectNode ? toStringValue(projectNode.reference) : null) ??
    null;

  const projectClient =
    toStringValue(value.projectClient) ??
    toStringValue(value.project_client) ??
    (projectNode ? toStringValue(projectNode.client_name) : null) ??
    null;

  return {
    projectId,
    projectName,
    projectReference,
    projectClient,
    versionId,
    versionNumber,
    status: statusValue,
    title,
    updatedAt,
    totalHtCents,
  };
}

function pickArray(root: unknown, keys: string[]): unknown[] {
  if (Array.isArray(root)) return root;
  if (!isRecord(root)) return [];

  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function parseEstimateList(payload: unknown): EstimateListItem[] {
  const root = getRootPayload(payload);
  const rows = pickArray(root, ["items", "estimates", "rows", "versions"]);

  const mapped = rows
    .map((row) => normalizeEstimateListItem(row))
    .filter((row): row is EstimateListItem => row !== null);

  const sorted = [...mapped].sort((left, right) => {
    if (left.versionNumber !== right.versionNumber) {
      return right.versionNumber - left.versionNumber;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });

  const latestByProject = new Map<string, EstimateListItem>();
  sorted.forEach((item) => {
    if (!latestByProject.has(item.projectId)) {
      latestByProject.set(item.projectId, item);
    }
  });

  return Array.from(latestByProject.values()).sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function parseEstimateEditorData(payload: unknown): EstimateEditorData {
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    throw new Error("Impossible de charger les donnees du chiffrage.");
  }

  const versionNode =
    (isRecord(root.version) ? root.version : null) ??
    (isRecord(root.estimateVersion) ? root.estimateVersion : null) ??
    (isRecord(root.estimate) ? root.estimate : null);

  if (!versionNode) {
    throw new Error("Version de chiffrage introuvable.");
  }

  const projectName =
    toStringValue(root.projectName) ??
    toStringValue(root.project_name) ??
    toStringValue(versionNode.projectName) ??
    toStringValue(versionNode.project_name);

  const estimateProjects =
    versionNode.estimate_projects ?? (projectName ? { name: projectName } : null);

  const version = {
    ...(versionNode as EstimateVersionRow),
    estimate_projects:
      (estimateProjects as EstimateVersionWithProject["estimate_projects"]) ?? null,
  } as EstimateVersionWithProject;

  const items = pickArray(root, ["items", "estimateItems", "estimate_items"]);
  const categories = pickArray(root, [
    "categories",
    "estimateCategories",
    "estimate_categories",
  ]);
  const supplyTypes = pickArray(root, [
    "supplyTypes",
    "supply_types",
    "supplyTypesList",
  ]);
  const laborRoles = pickArray(root, ["laborRoles", "labor_roles", "roles"]);
  const marginTiers = pickArray(root, ["marginTiers", "margin_tiers"]);
  const suggestionRules = pickArray(root, [
    "suggestionRules",
    "suggestion_rules",
    "rules",
  ]);

  return {
    version,
    items: items as EstimateItem[],
    categories: categories as EstimateCategory[],
    supplyTypes: supplyTypes as SupplyType[],
    laborRoles: laborRoles as LaborRole[],
    marginTiers: marginTiers as MarginTier[],
    suggestionRules: suggestionRules as SuggestionRule[],
  };
}

function parseEstimateItems(payload: unknown): EstimateItem[] {
  const root = getRootPayload(payload);
  const rows = pickArray(root, ["items", "estimateItems", "estimate_items"]);
  return rows as EstimateItem[];
}

function parseVersionToken(payload: unknown): EstimateVersionToken | null {
  const entity = extractEntity(payload, ["version", "estimateVersion"]);
  if (!entity) return null;

  const id = toStringValue(entity.id);
  const updatedAt = toStringValue(entity.updated_at);

  if (!id || !updatedAt) return null;

  return {
    id,
    updated_at: updatedAt,
  };
}

function parseEstimateTemplateSummaryEntity(
  value: unknown
): EstimateTemplateSummary | null {
  if (!isRecord(value)) return null;

  const id = toStringValue(value.id);
  const name = toStringValue(value.name);
  const createdAt = toStringValue(value.created_at);
  const updatedAt = toStringValue(value.updated_at);
  if (!id || !name || !createdAt || !updatedAt) return null;

  return {
    id,
    name,
    description: toStringValue(value.description),
    sourceVersionId:
      toStringValue(value.source_version_id) ??
      toStringValue(value.sourceVersionId) ??
      null,
    createdBy:
      toStringValue(value.created_by) ?? toStringValue(value.createdBy) ?? null,
    createdAt,
    updatedAt,
    itemCount:
      toNumber(value.item_count) ??
      toNumber(value.itemCount) ??
      0,
  };
}

function parseEstimateTemplateItems(value: unknown): EstimateTemplateItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isRecord(entry)) as EstimateTemplateItem[];
}

function parseEstimateTemplateSummaryList(payload: unknown): EstimateTemplateSummary[] {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return [];
  const rawItems = Array.isArray(root.templates)
    ? root.templates
    : Array.isArray(root.items)
      ? root.items
      : [];

  return rawItems
    .map((item) => parseEstimateTemplateSummaryEntity(item))
    .filter((item): item is EstimateTemplateSummary => Boolean(item));
}

function parseEstimateTemplateDetail(payload: unknown): EstimateTemplateDetail {
  const root = getRootPayload(payload);
  const templateEntity = extractEntity(root, ["template"]);
  const summary = parseEstimateTemplateSummaryEntity(templateEntity);
  if (!summary) {
    throw new Error("Impossible de recuperer le template.");
  }

  const items = parseEstimateTemplateItems(
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
    toStringValue(root.version_id) ??
    toStringValue(root.versionId);
  const projectId =
    toStringValue(root.project_id) ??
    toStringValue(root.projectId);
  const redirectTo =
    toStringValue(root.redirect_to) ??
    toStringValue(root.redirectTo) ??
    (versionId ? `/dashboard/estimates/${versionId}/edit` : null);

  if (!versionId || !projectId || !redirectTo) {
    throw new Error("Impossible d'instancier le template.");
  }

  return {
    projectId,
    versionId,
    redirectTo,
  };
}

function parseEstimateDraftLock(
  payload: unknown,
  fallbackVersionId?: string
): EstimateDraftLock | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const lockEntity =
    pickRecord(root, ["lock", "draft_lock", "draftLock"]) ??
    pickRecord(root, ["data"]) ??
    root;

  const holderEntity = pickRecord(lockEntity, [
    "holder",
    "owner",
    "profile",
    "profiles",
    "locked_by",
  ]);

  const versionId =
    toStringValue(lockEntity.version_id) ??
    toStringValue(lockEntity.versionId) ??
    toStringValue(root.version_id) ??
    toStringValue(root.versionId) ??
    fallbackVersionId ??
    null;

  if (!versionId) return null;

  const userId =
    toStringValue(lockEntity.user_id) ??
    toStringValue(lockEntity.userId) ??
    toStringValue(lockEntity.locked_by_user_id) ??
    (holderEntity
      ? toStringValue(holderEntity.user_id) ?? toStringValue(holderEntity.id)
      : null) ??
    null;

  const holderName =
    toStringValue(lockEntity.holder_name) ??
    toStringValue(lockEntity.holderName) ??
    toStringValue(lockEntity.locked_by_name) ??
    toStringValue(lockEntity.lockedByName) ??
    (holderEntity
      ? toStringValue(holderEntity.full_name) ??
        toStringValue(holderEntity.fullName) ??
        toStringValue(holderEntity.name)
      : null) ??
    null;

  const lockedAt =
    toStringValue(lockEntity.locked_at) ??
    toStringValue(lockEntity.lockedAt) ??
    null;

  const expiresAt =
    toStringValue(lockEntity.expires_at) ??
    toStringValue(lockEntity.expiresAt) ??
    null;

  const isOwnedByCurrentUser =
    toBooleanValue(lockEntity.is_current_user) ??
    toBooleanValue(lockEntity.isCurrentUser) ??
    toBooleanValue(lockEntity.is_owner) ??
    toBooleanValue(lockEntity.isOwnedByCurrentUser) ??
    toBooleanValue(lockEntity.owned_by_current_user) ??
    toBooleanValue(lockEntity.ownedByCurrentUser) ??
    toBooleanValue(root.is_owner) ??
    toBooleanValue(root.isOwnedByCurrentUser) ??
    toBooleanValue(root.owned_by_current_user) ??
    toBooleanValue(root.ownedByCurrentUser) ??
    null;

  return {
    versionId,
    userId,
    holderName,
    lockedAt,
    expiresAt,
    isOwnedByCurrentUser,
  };
}

function buildEstimateDraftLockPath(
  versionId: string,
  options?: { force?: boolean }
) {
  const query = new URLSearchParams();
  if (options?.force) {
    query.set("force", "1");
  }

  const basePath = `/api/estimates/${versionId}/lock`;
  const queryString = query.toString();
  if (!queryString) return basePath;
  return `${basePath}?${queryString}`;
}

export async function fetchEstimateList(): Promise<EstimateListItem[]> {
  const payload = await requestJson<unknown>(
    "/api/estimates",
    {
      method: "GET",
    },
    "Impossible de charger les chiffrages."
  );

  return parseEstimateList(payload);
}

export async function createEstimate(
  input: CreateEstimatePayload
): Promise<string> {
  const payload = await requestJson<unknown>(
    "/api/estimates",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project: {
          name: input.projectName,
          reference: null,
          client_name: null,
          notes: null,
        },
        version: {
          title: input.title,
          date_devis: input.dateDevis,
          validite_jours: input.validiteJours,
          margin_multiplier: input.marginMultiplier ?? 1,
        },
      }),
    },
    "Impossible de creer le chiffrage."
  );

  const versionEntity = extractEntity(payload, ["version", "estimateVersion"]);
  if (versionEntity && typeof versionEntity.id === "string") {
    return versionEntity.id;
  }

  const versionId = extractString(payload, [
    "versionId",
    "version_id",
    "estimateVersionId",
    "id",
  ]);

  if (!versionId) {
    throw new Error("Impossible de creer le chiffrage.");
  }

  return versionId;
}

export async function duplicateEstimateVersion(
  versionId: string
): Promise<string> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/duplicate`,
    {
      method: "POST",
    },
    "Impossible de dupliquer le chiffrage."
  );

  const duplicatedVersionId = extractString(payload, [
    "versionId",
    "version_id",
    "duplicatedVersionId",
    "duplicated_version_id",
    "id",
  ]);

  if (!duplicatedVersionId) {
    throw new Error("Impossible de dupliquer le chiffrage.");
  }

  return duplicatedVersionId;
}

export async function fetchEstimateEditorData(
  versionId: string
): Promise<EstimateEditorData> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}`,
    {
      method: "GET",
    },
    "Impossible de charger le chiffrage."
  );

  return parseEstimateEditorData(payload);
}

export async function fetchEstimateItemsForVersion(
  versionId: string
): Promise<EstimateItem[]> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/items`,
    {
      method: "GET",
    },
    "Impossible de charger les lignes."
  );

  return parseEstimateItems(payload);
}

export async function saveEstimateVersion(
  versionId: string,
  updates: Database["public"]["Tables"]["estimate_versions"]["Update"],
  updatedAtToken: string
): Promise<EstimateVersionRow> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": updatedAtToken,
      },
      body: JSON.stringify({
        ...updates,
        updated_at: updatedAtToken,
      }),
    },
    "Impossible de sauvegarder le chiffrage."
  );

  const entity = extractEntity(payload, ["version", "estimateVersion"]);
  if (!entity || !toStringValue(entity.updated_at)) {
    throw new Error("Impossible de recuperer la version mise a jour.");
  }

  return entity as EstimateVersionRow;
}

export async function bulkUpdateEstimateItems(
  versionId: string,
  updatedAtToken: string,
  updates: Array<{
    id: string;
    updates: Database["public"]["Tables"]["estimate_items"]["Update"];
  }>,
  versionPatch?: BulkUpdateEstimateVersionPatch
): Promise<BulkUpdateEstimateItemsResult> {
  if (updates.length === 0 && !versionPatch) {
    return {
      updatedCount: 0,
      versionToken: {
        id: versionId,
        updated_at: updatedAtToken,
      },
    };
  }

  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/items/bulk`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": updatedAtToken,
      },
      body: JSON.stringify({
        updated_at: updatedAtToken,
        updates: updates.map((entry) => ({
          id: entry.id,
          ...entry.updates,
        })),
        ...(versionPatch ? { version_patch: versionPatch } : {}),
      }),
    },
    "Impossible de mettre a jour les lignes."
  );

  const versionToken = parseVersionToken(payload);
  if (!versionToken) {
    throw new Error("Impossible de recuperer le jeton de version.");
  }

  const root = getRootPayload(payload);
  const updatedCount =
    (isRecord(root) ? toNumber(root.updated_count) : null) ?? updates.length;

  return {
    updatedCount,
    versionToken,
  };
}

export async function createEstimateItem(
  versionId: string,
  item: Database["public"]["Tables"]["estimate_items"]["Insert"]
): Promise<EstimateItem> {
  const lineItem = item as typeof item & {
    h_mo_majoration?: number | null;
    supply_type_id?: string | null;
  };
  const body =
    item.item_type === "section"
      ? {
          item_type: "section" as const,
          parent_id: item.parent_id ?? null,
          position: item.position,
          title: item.title,
        }
      : {
          item_type: "line" as const,
          parent_id: item.parent_id ?? null,
          position: item.position,
          title: item.title,
          description: item.description ?? null,
          quantity: item.quantity,
          unit_price_ht_cents: item.unit_price_ht_cents,
          tax_rate_bp: item.tax_rate_bp,
          k_fo: item.k_fo,
          h_mo: item.h_mo,
          h_mo_majoration: lineItem.h_mo_majoration ?? null,
          k_mo: item.k_mo,
          labor_role_id: item.labor_role_id ?? null,
          category_id: item.category_id ?? null,
          supply_type_id: lineItem.supply_type_id ?? null,
        };

  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/items`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Impossible d'ajouter la ligne."
  );

  const entity = extractEntity(payload, ["item", "estimateItem"]);
  if (!entity) {
    throw new Error("Impossible d'ajouter la ligne.");
  }

  return entity as EstimateItem;
}

export async function updateEstimateItem(
  versionId: string,
  itemId: string,
  updates: Database["public"]["Tables"]["estimate_items"]["Update"]
): Promise<void> {
  await requestJson<unknown>(
    `/api/estimates/${versionId}/items`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: itemId,
        ...updates,
      }),
    },
    "Impossible de mettre a jour la ligne."
  );
}

export async function deleteEstimateItem(
  versionId: string,
  itemId: string
): Promise<void> {
  await requestJson<unknown>(
    `/api/estimates/${versionId}/items`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: itemId,
      }),
    },
    "Impossible de supprimer la ligne."
  );
}

export async function reorderEstimateItems(
  versionId: string,
  parentId: string | null,
  orderedIds: string[]
): Promise<void> {
  await requestJson<unknown>(
    `/api/estimates/${versionId}/items/reorder`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent_id: parentId,
        ordered_ids: orderedIds,
      }),
    },
    "Impossible de reordonner les lignes."
  );
}

export async function updateEstimateStatus(
  versionId: string,
  status: EstimateStatus,
  updatedAtToken: string
): Promise<EstimateVersionRow> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": updatedAtToken,
      },
      body: JSON.stringify({
        status,
        updated_at: updatedAtToken,
      }),
    },
    "Impossible de mettre a jour le statut."
  );

  const entity = extractEntity(payload, ["version", "estimateVersion"]);
  if (!entity || !toStringValue(entity.updated_at)) {
    throw new Error("Impossible de recuperer la version mise a jour.");
  }

  return entity as EstimateVersionRow;
}

export async function acquireEstimateDraftLock(
  versionId: string
): Promise<AcquireEstimateDraftLockResult> {
  try {
    const payload = await requestJson<unknown>(
      buildEstimateDraftLockPath(versionId),
      {
        method: "POST",
      },
      "Impossible d'acquerir le verrou de brouillon."
    );

    const lock = parseEstimateDraftLock(payload, versionId);
    const acquired =
      extractBoolean(payload, ["acquired", "is_acquired"]) ??
      lock?.isOwnedByCurrentUser ??
      true;

    return {
      acquired,
      lock,
    };
  } catch (error) {
    if (isEstimateApiError(error) && error.status === 409) {
      return {
        acquired: false,
        lock: parseEstimateDraftLock(error.details, versionId),
      };
    }
    throw error;
  }
}

export async function renewEstimateDraftLock(
  versionId: string
): Promise<RenewEstimateDraftLockResult> {
  try {
    const payload = await requestJson<unknown>(
      buildEstimateDraftLockPath(versionId),
      {
        method: "PATCH",
      },
      "Impossible de renouveler le verrou de brouillon."
    );

    const lock = parseEstimateDraftLock(payload, versionId);
    const renewed =
      extractBoolean(payload, ["renewed", "is_renewed"]) ??
      lock?.isOwnedByCurrentUser ??
      true;

    return {
      renewed,
      lock,
    };
  } catch (error) {
    if (isEstimateApiError(error) && error.status === 409) {
      return {
        renewed: false,
        lock: parseEstimateDraftLock(error.details, versionId),
      };
    }
    throw error;
  }
}

export async function releaseEstimateDraftLock(
  versionId: string,
  options: ReleaseEstimateDraftLockOptions = {}
): Promise<ReleaseEstimateDraftLockResult> {
  try {
    const payload = await requestJson<unknown>(
      buildEstimateDraftLockPath(versionId, { force: options.force }),
      {
        method: "DELETE",
        keepalive: options.keepalive,
      },
      options.force
        ? "Impossible de forcer le deverrouillage."
        : "Impossible de liberer le verrou de brouillon."
    );

    const released =
      extractBoolean(payload, ["released", "ok", "success"]) ?? true;

    return {
      released,
    };
  } catch (error) {
    if (isEstimateApiError(error) && error.status === 404) {
      return {
        released: true,
      };
    }
    throw error;
  }
}

export async function createEstimateCategory(
  versionId: string,
  category: Pick<
    Database["public"]["Tables"]["estimate_categories"]["Insert"],
    "name" | "color" | "position"
  >
): Promise<EstimateCategory> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/categories`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(category),
    },
    "Impossible de creer la categorie."
  );

  const entity = extractEntity(payload, ["category", "item"]);
  if (!entity) {
    throw new Error("Impossible de creer la categorie.");
  }

  return entity as EstimateCategory;
}

export async function createEstimateLaborRole(
  versionId: string,
  role: Pick<
    Database["public"]["Tables"]["labor_roles"]["Insert"],
    "name" | "hourly_rate_cents" | "is_active" | "position"
  >
): Promise<LaborRole> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/labor-roles`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(role),
    },
    "Impossible de creer le role."
  );

  const entity = extractEntity(payload, ["labor_role", "laborRole", "role"]);
  if (!entity) {
    throw new Error("Impossible de creer le role.");
  }

  return entity as LaborRole;
}

export async function updateEstimateLaborRole(
  versionId: string,
  roleId: string,
  updates: Database["public"]["Tables"]["labor_roles"]["Update"]
): Promise<void> {
  await requestJson<unknown>(
    `/api/estimates/${versionId}/labor-roles/${roleId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
    "Impossible de mettre a jour le role."
  );
}

export async function createEstimateSuggestionRule(
  versionId: string,
  rule: Pick<
    Database["public"]["Tables"]["estimate_suggestion_rules"]["Insert"],
    | "name"
    | "match_type"
    | "match_value"
    | "unit"
    | "category_id"
    | "k_fo"
    | "k_mo"
    | "labor_role_id"
    | "position"
    | "is_active"
  >
): Promise<SuggestionRule> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-rules`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rule),
    },
    "Impossible de creer la regle."
  );

  const entity = extractEntity(payload, ["suggestion_rule", "suggestionRule", "rule"]);
  if (!entity) {
    throw new Error("Impossible de creer la regle.");
  }

  return entity as SuggestionRule;
}

export async function updateEstimateSuggestionRule(
  versionId: string,
  ruleId: string,
  updates: Database["public"]["Tables"]["estimate_suggestion_rules"]["Update"]
): Promise<SuggestionRule | null> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-rules/${ruleId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
    "Impossible de mettre a jour la regle."
  );

  const entity = extractEntity(payload, ["suggestion_rule", "suggestionRule", "rule"]);
  return entity ? (entity as SuggestionRule) : null;
}

export async function sendEstimateSuggestionRuleFeedback(
  versionId: string,
  ruleId: string,
  feedback: SuggestionRuleFeedback
): Promise<SuggestionRule | null> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-rules/${ruleId}/feedback`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        feedback,
      }),
    },
    "Impossible d'enregistrer le feedback de la regle."
  );

  const entity = extractEntity(payload, ["suggestion_rule", "suggestionRule", "rule"]);
  return entity ? (entity as SuggestionRule) : null;
}

export async function fetchEstimateTemplates(options?: {
  search?: string;
  limit?: number;
  order?: "recent" | "oldest";
}): Promise<EstimateTemplateSummary[]> {
  const params = new URLSearchParams();
  if (options?.search?.trim()) {
    params.set("search", options.search.trim());
  }
  if (options?.limit && Number.isFinite(options.limit) && options.limit > 0) {
    params.set("limit", String(Math.floor(options.limit)));
  }
  if (options?.order) {
    params.set("order", options.order);
  }

  const query = params.toString();
  const path = query.length > 0
    ? `/api/estimates/templates?${query}`
    : "/api/estimates/templates";

  const payload = await requestJson<unknown>(
    path,
    {
      method: "GET",
    },
    "Impossible de charger les templates."
  );

  return parseEstimateTemplateSummaryList(payload);
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
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceVersionId: input.sourceVersionId,
        name: input.name,
        description: input.description ?? null,
      }),
    },
    "Impossible de creer le template."
  );

  const entity = extractEntity(payload, ["template"]);
  const parsed = parseEstimateTemplateSummaryEntity(entity);
  if (!parsed) {
    throw new Error("Impossible de creer le template.");
  }

  return parsed;
}

export async function updateEstimateTemplate(
  templateId: string,
  updates: UpdateEstimateTemplatePayload
): Promise<EstimateTemplateSummary> {
  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
    "Impossible de mettre a jour le template."
  );

  const entity = extractEntity(payload, ["template"]);
  const parsed = parseEstimateTemplateSummaryEntity(entity);
  if (!parsed) {
    throw new Error("Impossible de mettre a jour le template.");
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
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
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
): Promise<{ projectId: string; versionId: string; redirectTo: string }> {
  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}/instantiate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectName: input.projectName,
        versionTitle: input.versionTitle ?? null,
        dateDevis: input.dateDevis,
        validiteJours: input.validiteJours,
      }),
    },
    "Impossible d'instancier le template."
  );

  return parseInstantiateTemplateResult(payload);
}
