import { z } from "zod";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server";

const assemblyLibraryFilterSchema = z.enum(["all", "favorites", "recent"]);
const assemblyLibrarySortSchema = z.enum([
  "recent",
  "name",
  "reference",
  "cost",
  "usage",
]);
const assemblyLibraryDirectionSchema = z.enum(["asc", "desc"]);

export const estimateAssemblyLibraryQuerySchema = z.object({
  search: z.string().trim().max(100).optional().default(""),
  filter: assemblyLibraryFilterSchema.optional().default("all"),
  sort: assemblyLibrarySortSchema.optional().default("recent"),
  direction: assemblyLibraryDirectionSchema.optional().default("desc"),
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export type EstimateAssemblyLibraryQuery = z.infer<
  typeof estimateAssemblyLibraryQuerySchema
>;

type AssemblyLibraryRpcRow = {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  description: string | null;
  reference_code: string | null;
  unit: string | null;
  pricing_source: string | null;
  stored_ds_cents: number | string | null;
  indicative_target_price_cents: number | string | null;
  avg_output_rate: number | string | null;
  avg_time_hours: number | string | null;
  source_metadata: unknown;
  item_count: number | string | null;
  component_names: unknown;
  material_cost_cents: number | string | null;
  labor_cost_cents: number | string | null;
  equipment_cost_cents: number | string | null;
  subcontract_cost_cents: number | string | null;
  calculated_ds_cents: number | string | null;
  pose_only_cents: number | string | null;
  supplied_installed_cents: number | string | null;
  stored_ds_delta_cents: number | string | null;
  is_favorite: boolean | null;
  favorite_position: number | string | null;
  usage_count: number | string | null;
  last_used_at: string | null;
  near_duplicate_count: number | string | null;
  total_count: number | string | null;
};

type FavoriteRpcRow = {
  assembly_id: string;
  is_favorite: boolean;
  favorite_position: number | string | null;
  usage_count: number | string | null;
  last_used_at: string | null;
};

type RpcError = {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
};

type RpcResult = {
  data: unknown;
  error: RpcError | null;
};

type RpcCaller = (
  functionName: string,
  args: Record<string, unknown>
) => PromiseLike<RpcResult>;

function asSafeInteger(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return parsed;
}

function asNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRpcRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function sanitizeAssemblyLibrarySearch(value: string) {
  return value
    .replace(/[%_,\\]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

function toAssemblyLibraryEntity(row: AssemblyLibraryRpcRow) {
  const calculatedDirectCostCents = asSafeInteger(row.calculated_ds_cents);
  const storedDirectCostCents = asSafeInteger(row.stored_ds_cents);

  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: null,
    name: row.name,
    description: row.description,
    reference_code: row.reference_code,
    unit: row.unit,
    pricing_source: row.pricing_source,
    ds_cents: calculatedDirectCostCents,
    stored_ds_cents: storedDirectCostCents,
    indicative_target_price_cents: asSafeInteger(
      row.indicative_target_price_cents
    ),
    avg_output_rate: asNullableNumber(row.avg_output_rate),
    avg_time_hours: asNullableNumber(row.avg_time_hours),
    source_metadata: row.source_metadata ?? {},
    item_count: asSafeInteger(row.item_count),
    component_names: Array.isArray(row.component_names)
      ? row.component_names.filter(
          (component): component is string => typeof component === "string"
        )
      : [],
    material_cost_cents: asSafeInteger(row.material_cost_cents),
    labor_cost_cents: asSafeInteger(row.labor_cost_cents),
    equipment_cost_cents: asSafeInteger(row.equipment_cost_cents),
    subcontract_cost_cents: asSafeInteger(row.subcontract_cost_cents),
    pose_only_cents: asSafeInteger(row.pose_only_cents),
    supplied_installed_cents: asSafeInteger(row.supplied_installed_cents),
    stored_ds_delta_cents: asSafeInteger(row.stored_ds_delta_cents),
    is_favorite: row.is_favorite === true,
    favorite_position:
      row.favorite_position === null
        ? null
        : asSafeInteger(row.favorite_position),
    usage_count: asSafeInteger(row.usage_count),
    last_used_at: row.last_used_at,
    near_duplicate_count: asSafeInteger(row.near_duplicate_count),
  };
}

function toRpcInput(
  tenantId: string,
  query: EstimateAssemblyLibraryQuery,
  page = query.page
) {
  return {
    p_tenant_id: tenantId,
    p_q: sanitizeAssemblyLibrarySearch(query.search) || null,
    p_filter: query.filter,
    p_sort: query.sort,
    p_dir: query.direction,
    p_page: page,
    p_size: query.pageSize,
  };
}

export async function listEstimateAssemblyLibraryPage(
  input: EstimateAssemblyLibraryQuery
) {
  const query = estimateAssemblyLibraryQuerySchema.parse(input);
  const { supabase, tenantId } = await getAuthenticatedContext();
  const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

  const pageResult = await callRpc(
    "estimate_assemblies_page",
    toRpcInput(tenantId, query)
  );
  if (pageResult.error) {
    throw mapSupabaseError(
      pageResult.error,
      "Impossible de charger la bibliothèque d'ouvrages."
    );
  }

  const rows = asRpcRows<AssemblyLibraryRpcRow>(pageResult.data);
  let totalItems = asSafeInteger(rows[0]?.total_count);

  if (rows.length === 0 && query.page > 1) {
    const countProbe = await callRpc(
      "estimate_assemblies_page",
      toRpcInput(tenantId, query, 1)
    );
    if (countProbe.error) {
      throw mapSupabaseError(
        countProbe.error,
        "Impossible de vérifier la pagination des ouvrages."
      );
    }
    const probeRows = asRpcRows<AssemblyLibraryRpcRow>(countProbe.data);
    totalItems = asSafeInteger(probeRows[0]?.total_count);
  }

  return {
    assemblies: rows.map(toAssemblyLibraryEntity),
    pagination: {
      page: query.page,
      page_size: query.pageSize,
      total_items: totalItems,
      total_pages:
        totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
    },
  };
}

export async function setEstimateAssemblyFavorite(
  assemblyId: string,
  favorite: boolean
) {
  const { supabase, tenantId } = await getAuthenticatedContext();
  const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;
  const result = await callRpc("set_estimate_assembly_favorite", {
    p_tenant_id: tenantId,
    p_assembly_id: assemblyId,
    p_favorite: favorite,
  });

  if (result.error) {
    throw mapSupabaseError(
      result.error,
      "Impossible de mettre à jour le favori."
    );
  }

  const row = asRpcRows<FavoriteRpcRow>(result.data)[0];
  return {
    assembly_id: row?.assembly_id ?? assemblyId,
    is_favorite: row?.is_favorite === true,
    favorite_position:
      row?.favorite_position === null || row?.favorite_position === undefined
        ? null
        : asSafeInteger(row.favorite_position),
    usage_count: asSafeInteger(row?.usage_count),
    last_used_at: row?.last_used_at ?? null,
  };
}
