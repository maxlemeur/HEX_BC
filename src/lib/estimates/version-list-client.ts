import { toNumber, getRootPayload, pickArray } from "@/lib/estimates/client-json";
import { requestJson } from "@/lib/estimates/client-requests";
import { normalizeEstimateCurrency } from "@/lib/money";
import { isEstimateStatus, type EstimateStatus } from "@/lib/estimates/status";
import { isRecord, toNonEmptyString } from "@/lib/value-guards";

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
  currency: string;
  dateDevis: string | null;
  validiteJours: number | null;
};

export type EstimateDraftVersionTarget = {
  id: string;
  projectId: string;
  versionNumber: number;
  status: EstimateStatus;
  title: string | null;
  updatedAt: string;
};

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
    toNonEmptyString(value.projectId) ??
    toNonEmptyString(value.project_id) ??
    (projectNode ? toNonEmptyString(projectNode.id) : null);
  const projectName =
    toNonEmptyString(value.projectName) ??
    toNonEmptyString(value.project_name) ??
    (projectNode ? toNonEmptyString(projectNode.name) : null);
  const versionId =
    toNonEmptyString(value.versionId) ??
    toNonEmptyString(value.version_id) ??
    toNonEmptyString(value.id);
  const versionNumber =
    toNumber(value.versionNumber) ?? toNumber(value.version_number);
  const statusValue =
    toNonEmptyString(value.status) ??
    toNonEmptyString(value.estimate_status) ??
    toNonEmptyString(value.version_status);
  const updatedAt =
    toNonEmptyString(value.updatedAt) ?? toNonEmptyString(value.updated_at);
  const totalHtCents =
    toNumber(value.totalHtCents) ??
    toNumber(value.total_ht_cents) ??
    toNumber(value.total);
  const currency =
    normalizeEstimateCurrency(toNonEmptyString(value.currency)) ??
    normalizeEstimateCurrency(toNonEmptyString(value.currency_code)) ??
    "EUR";

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
    toNonEmptyString(value.title) ?? toNonEmptyString(value.version_title) ?? null;

  const projectReference =
    toNonEmptyString(value.projectReference) ??
    toNonEmptyString(value.project_reference) ??
    (projectNode ? toNonEmptyString(projectNode.reference) : null) ??
    null;

  const projectClient =
    toNonEmptyString(value.projectClient) ??
    toNonEmptyString(value.project_client_name) ??
    toNonEmptyString(value.project_client) ??
    (projectNode ? toNonEmptyString(projectNode.client_name) : null) ??
    null;

  const dateDevis =
    toNonEmptyString(value.dateDevis) ??
    toNonEmptyString(value.date_devis) ??
    null;

  const validiteJours =
    toNumber(value.validiteJours) ??
    toNumber(value.validite_jours) ??
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
    currency,
    dateDevis,
    validiteJours,
  };
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

function parseEstimateDraftVersionTarget(
  value: unknown
): EstimateDraftVersionTarget | null {
  if (!isRecord(value)) return null;

  const id = toNonEmptyString(value.id);
  const projectId =
    toNonEmptyString(value.projectId) ?? toNonEmptyString(value.project_id);
  const versionNumber =
    toNumber(value.versionNumber) ?? toNumber(value.version_number);
  const statusValue = toNonEmptyString(value.status);
  const updatedAt =
    toNonEmptyString(value.updatedAt) ?? toNonEmptyString(value.updated_at);

  if (
    !id ||
    !projectId ||
    versionNumber === null ||
    !statusValue ||
    !isEstimateStatus(statusValue) ||
    !updatedAt
  ) {
    return null;
  }

  return {
    id,
    projectId,
    versionNumber,
    status: statusValue,
    title: toNonEmptyString(value.title) ?? null,
    updatedAt,
  };
}

function parseEstimateDraftVersionTargets(
  payload: unknown
): EstimateDraftVersionTarget[] {
  const root = getRootPayload(payload);
  const rows = pickArray(root, ["items", "versions", "rows"]);

  return rows
    .map((row) => parseEstimateDraftVersionTarget(row))
    .filter((row): row is EstimateDraftVersionTarget => row !== null)
    .sort((left, right) => {
      if (left.versionNumber !== right.versionNumber) {
        return right.versionNumber - left.versionNumber;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
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

export async function fetchEstimateDraftVersions(
  versionId: string
): Promise<EstimateDraftVersionTarget[]> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/draft-versions`,
    {
      method: "GET",
    },
    "Impossible de charger les versions brouillon."
  );

  return parseEstimateDraftVersionTargets(payload);
}
