import { type JsonRecord, toNumber, getRootPayload, extractEntity } from "@/lib/estimates/client-json";
import { requestJson } from "@/lib/estimates/client-requests";
import { assemblyTargetPriceCents } from "@/lib/estimates/assembly-target-price";
import { type EstimateItem, parseEstimateItems } from "@/lib/estimates/editor-read-client";
import type { Database } from "@/types/database";
import { isRecord, toNonEmptyString } from "@/lib/value-guards";
import type { LaborRole } from "@/lib/estimates/editor-items";

type EstimateAssemblyItemRow =
  Database["public"]["Tables"]["estimate_assembly_items"]["Row"];

type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];

export type EstimateAssemblyItem = EstimateAssemblyItemRow;
export type EstimateAssemblyLaborRole = LaborRole;
export type EstimateAssemblySupplyType = SupplyType;
export type EstimateAssemblyMember =
  Database["public"]["Tables"]["estimate_assembly_members"]["Row"] & {
    child_assembly: {
      id: string;
      name: string;
      reference_code: string | null;
      unit: string | null;
      ds_cents: number;
      avg_time_hours: number | null;
    } | null;
  };

export type EstimateAssemblySummary = {
  id: string;
  name: string;
  description: string | null;
  referenceCode?: string | null;
  unit?: string | null;
  pricingSource?: string | null;
  directCostCents?: number;
  /** Null when the ouvrage has no target price (see `assemblyTargetPriceCents`). */
  targetPriceCents?: number | null;
  averageOutputRate?: number | null;
  averageTimeHours?: number | null;
  sourceMetadata?: unknown;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  memberCount?: number;
};

export type EstimateAssemblyDetail = EstimateAssemblySummary & {
  items: EstimateAssemblyItem[];
  members?: EstimateAssemblyMember[];
};

export type CreateEstimateAssemblyPayload = {
  name: string;
  description?: string | null;
  referenceCode?: string | null;
  unit?: string | null;
  items: Array<{
    title: string;
    unit?: string | null;
    kFo?: number;
    kMo?: number;
    laborRoleId?: string | null;
    supplyTypeId?: string | null;
    defaultQuantity?: number | null;
    laborHours?: number;
    position: number;
    costType?: EstimateAssemblyItem["cost_type"];
    unitCostHtCents?: number;
    lossCoeffBp?: number;
    yieldValue?: number | null;
    yieldUnit?: string | null;
    sourceMetadata?: unknown;
  }>;
  members?: Array<{
    childAssemblyId: string;
    quantity: number;
    position: number;
  }>;
};

export type UpdateEstimateAssemblyPayload = {
  name?: string;
  description?: string | null;
  referenceCode?: string | null;
  unit?: string | null;
  items?: Array<{
    title: string;
    unit?: string | null;
    kFo?: number;
    kMo?: number;
    laborRoleId?: string | null;
    supplyTypeId?: string | null;
    defaultQuantity?: number | null;
    laborHours?: number;
    position: number;
    costType?: EstimateAssemblyItem["cost_type"];
    unitCostHtCents?: number;
    lossCoeffBp?: number;
    yieldValue?: number | null;
    yieldUnit?: string | null;
    sourceMetadata?: unknown;
  }>;
  members?: Array<{
    childAssemblyId: string;
    quantity: number;
    position: number;
  }>;
};

function parseEstimateAssemblySummaryEntity(
  value: unknown
): EstimateAssemblySummary | null {
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
    createdBy:
      toNonEmptyString(value.created_by) ?? toNonEmptyString(value.createdBy) ?? null,
    createdAt,
    updatedAt,
    itemCount: toNumber(value.item_count) ?? toNumber(value.itemCount) ?? 0,
    memberCount:
      toNumber(value.member_count) ?? toNumber(value.memberCount) ?? 0,
    referenceCode: toNonEmptyString(value.reference_code),
    unit: toNonEmptyString(value.unit),
    pricingSource: toNonEmptyString(value.pricing_source),
    directCostCents: toNumber(value.ds_cents) ?? 0,
    targetPriceCents: assemblyTargetPriceCents(value),
    averageOutputRate: toNumber(value.avg_output_rate),
    averageTimeHours: toNumber(value.avg_time_hours),
    sourceMetadata: value.source_metadata ?? null,
  };
}

function parseEstimateAssemblyItems(value: unknown): EstimateAssemblyItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isRecord(entry)) as EstimateAssemblyItem[];
}

function parseEstimateAssemblyMembers(
  value: unknown
): EstimateAssemblyMember[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isRecord(entry)) as EstimateAssemblyMember[];
}

function parseEstimateAssemblySummaryList(
  payload: unknown
): EstimateAssemblySummary[] {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return [];
  const rawItems = Array.isArray(root.assemblies)
    ? root.assemblies
    : Array.isArray(root.items)
      ? root.items
      : [];

  return rawItems
    .map((item) => parseEstimateAssemblySummaryEntity(item))
    .filter((item): item is EstimateAssemblySummary => Boolean(item));
}

function parseEstimateAssemblyDetail(payload: unknown): EstimateAssemblyDetail {
  const root = getRootPayload(payload);
  const assemblyEntity = extractEntity(root, ["assembly"]);
  const summary = parseEstimateAssemblySummaryEntity(assemblyEntity);
  if (!summary) {
    throw new Error("Impossible de récupérer l'ouvrage.");
  }

  const items = parseEstimateAssemblyItems(
    (assemblyEntity as JsonRecord | null)?.items ??
      (isRecord(root) ? root.items : null)
  );
  const members = parseEstimateAssemblyMembers(
    (assemblyEntity as JsonRecord | null)?.members ??
      (isRecord(root) ? root.members : null)
  );

  return {
    ...summary,
    items,
    members,
  };
}

function toAssemblyItemRequestPayload(
  item: CreateEstimateAssemblyPayload["items"][number]
) {
  return {
    title: item.title,
    unit: item.unit ?? null,
    k_fo: item.kFo ?? 1,
    k_mo: item.kMo ?? 1,
    labor_role_id: item.laborRoleId ?? null,
    supply_type_id: item.supplyTypeId ?? null,
    default_quantity: item.defaultQuantity ?? null,
    h_mo: item.laborHours ?? 0,
    position: item.position,
    cost_type: item.costType ?? "material",
    unit_cost_ht_cents: item.unitCostHtCents ?? 0,
    loss_coeff_bp: item.lossCoeffBp ?? 0,
    yield_value: item.yieldValue ?? null,
    yield_unit: item.yieldUnit ?? null,
    source_metadata: item.sourceMetadata ?? {},
  };
}

function toAssemblyMemberRequestPayload(
  member: NonNullable<CreateEstimateAssemblyPayload["members"]>[number]
) {
  return {
    child_assembly_id: member.childAssemblyId,
    quantity: member.quantity,
    position: member.position,
  };
}

export async function fetchEstimateAssemblies(options?: {
  search?: string;
  limit?: number;
  order?: "recent" | "oldest";
}): Promise<EstimateAssemblySummary[]> {
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
    ? `/api/estimates/assemblies?${query}`
    : "/api/estimates/assemblies";

  const payload = await requestJson<unknown>(
    path,
    {
      method: "GET",
    },
    "Impossible de charger les ouvrages."
  );

  return parseEstimateAssemblySummaryList(payload);
}

export async function fetchEstimateAssemblyOptions(): Promise<{
  laborRoles: EstimateAssemblyLaborRole[];
  supplyTypes: EstimateAssemblySupplyType[];
  assemblies: EstimateAssemblySummary[];
}> {
  const payload = await requestJson<unknown>(
    "/api/estimates/assemblies?limit=100",
    {
      method: "GET",
    },
    "Impossible de charger les options des ouvrages."
  );
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    return { laborRoles: [], supplyTypes: [], assemblies: [] };
  }

  return {
    assemblies: parseEstimateAssemblySummaryList(payload),
    laborRoles: Array.isArray(root.labor_roles)
      ? (root.labor_roles.filter((entry) => isRecord(entry)) as EstimateAssemblyLaborRole[])
      : [],
    supplyTypes: Array.isArray(root.supply_types)
      ? (root.supply_types.filter((entry) => isRecord(entry)) as EstimateAssemblySupplyType[])
      : [],
  };
}
export async function fetchEstimateAssembly(
  assemblyId: string
): Promise<EstimateAssemblyDetail> {
  const payload = await requestJson<unknown>(
    `/api/estimates/assemblies/${assemblyId}`,
    {
      method: "GET",
    },
    "Impossible de charger l'ouvrage."
  );

  return parseEstimateAssemblyDetail(payload);
}

export async function createEstimateAssembly(
  input: CreateEstimateAssemblyPayload
): Promise<EstimateAssemblyDetail> {
  const payload = await requestJson<unknown>(
    "/api/estimates/assemblies",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        description: input.description ?? null,
        reference_code: input.referenceCode ?? null,
        unit: input.unit ?? null,
        items: input.items.map((item) => toAssemblyItemRequestPayload(item)),
        members: (input.members ?? []).map((member) =>
          toAssemblyMemberRequestPayload(member)),
      }),
    },
    "Impossible de créer l'ouvrage."
  );

  return parseEstimateAssemblyDetail(payload);
}

export async function updateEstimateAssembly(
  assemblyId: string,
  updates: UpdateEstimateAssemblyPayload
): Promise<EstimateAssemblyDetail> {
  const body: Record<string, unknown> = {};

  if ("name" in updates) {
    body.name = updates.name;
  }
  if ("description" in updates) {
    body.description = updates.description ?? null;
  }
  if ("referenceCode" in updates) {
    body.reference_code = updates.referenceCode ?? null;
  }
  if ("unit" in updates) {
    body.unit = updates.unit ?? null;
  }
  if ("items" in updates && updates.items) {
    body.items = updates.items.map((item) => toAssemblyItemRequestPayload(item));
  }
  if ("members" in updates && updates.members) {
    body.members = updates.members.map((member) =>
      toAssemblyMemberRequestPayload(member)
    );
  }

  const payload = await requestJson<unknown>(
    `/api/estimates/assemblies/${assemblyId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Impossible de mettre à jour l'ouvrage."
  );

  return parseEstimateAssemblyDetail(payload);
}

export async function deleteEstimateAssembly(assemblyId: string): Promise<void> {
  await requestJson<unknown>(
    `/api/estimates/assemblies/${assemblyId}`,
    {
      method: "DELETE",
    },
    "Impossible de supprimer l'ouvrage."
  );
}

export async function duplicateEstimateAssembly(
  assemblyId: string,
  options?: { name?: string | null }
): Promise<EstimateAssemblyDetail> {
  const source = await fetchEstimateAssembly(assemblyId);

  return createEstimateAssembly({
    name: options?.name?.trim() || `${source.name} (copie)`,
    description: source.description,
    unit: source.unit,
    items: source.items.map((item) => ({
      title: item.title,
      unit: item.unit,
      kFo: item.k_fo,
      kMo: item.k_mo,
      laborRoleId: item.labor_role_id,
      supplyTypeId: item.supply_type_id,
      defaultQuantity: item.default_quantity,
      laborHours: item.h_mo,
      costType: item.cost_type,
      unitCostHtCents: item.unit_cost_ht_cents,
      lossCoeffBp: item.loss_coeff_bp,
      yieldValue: item.yield_value,
      yieldUnit: item.yield_unit,
      sourceMetadata: item.source_metadata,
      position: item.position,
    })),
    members: (source.members ?? []).map((member) => ({
      childAssemblyId: member.child_assembly_id,
      quantity: member.quantity,
      position: member.position,
    })),
  });
}

export async function insertAssemblyIntoVersion(
  assemblyId: string,
  input: {
    versionId: string;
    afterItemId?: string | null;
  }
): Promise<EstimateItem[]> {
  const params = new URLSearchParams();
  params.set("versionId", input.versionId);

  const payload = await requestJson<unknown>(
    `/api/estimates/assemblies/${assemblyId}/insert?${params.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        afterItemId: input.afterItemId ?? null,
      }),
    },
    "Impossible d'insérer l'ouvrage.",
    undefined,
    { mutation: { versionId: input.versionId, structural: true, requireAssemblyTotals: true } }
  );

  return parseEstimateItems(payload);
}
