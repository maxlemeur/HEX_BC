import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import type { RpcImportItemPayload } from "@/lib/affaires/import-flow-server";
import { buildEstimateV2SnapshotProjection } from "@/lib/estimate-v2-snapshot";
import { NEW_ESTIMATE_CALC_ENGINE_VERSION } from "@/lib/estimates/calc-engine-version";
import { DEFAULT_MAX_SECTION_DEPTH } from "@/lib/estimates/hierarchy";
import {
  calculateEstimateSnapshotForItems,
  type EstimateTotalsVersionConfig,
} from "@/lib/estimates/version-totals";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, Json } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItemInsert = Database["public"]["Tables"]["estimate_items"]["Insert"];
type CanonicalEstimateCreationItem = Omit<EstimateItemInsert, "version_id">;
type EstimateTemplateRow = Database["public"]["Tables"]["estimate_templates"]["Row"];
type EstimateTemplateItemRow =
  Database["public"]["Tables"]["estimate_template_items"]["Row"];

type ExistingProjectTarget = {
  kind: "existing";
  id: string;
};

type NewProjectTarget = {
  kind: "new";
  id?: string;
  name: string;
  reference?: string | null;
  clientName?: string | null;
  notes?: string | null;
};

type CanonicalV2VersionOverrides = Partial<
  Pick<
    EstimateVersionRow,
    | "title"
    | "date_devis"
    | "validite_jours"
    | "margin_multiplier"
    | "margin_mode"
    | "currency"
    | "margin_bp"
    | "discount_bp"
    | "discount_mode"
    | "discount_steps"
    | "global_coefficient"
    | "tax_rate_bp"
    | "rounding_mode"
    | "rounding_step_cents"
    | "max_section_depth"
    | "contractor_role"
  >
>;

export type CanonicalV2TemplateItem = Pick<
  EstimateItemInsert,
  | "id"
  | "parent_id"
  | "item_type"
  | "position"
  | "title"
  | "description"
  | "quantity"
  | "unit_price_ht_cents"
  | "tax_rate_bp"
  | "k_fo"
  | "h_mo"
  | "k_mo"
  | "h_mo_atelier"
  | "labor_role_atelier_id"
  | "h_mo_chantier"
  | "labor_role_chantier_id"
  | "pu_ht_cents"
  | "labor_role_id"
  | "category_id"
  | "supply_type_id"
  | "line_total_ht_cents"
  | "line_tax_cents"
  | "line_total_ttc_cents"
> & {
  h_mo_majoration: number | null;
  k_mo_atelier: number | null;
  k_mo_chantier: number | null;
};

type CanonicalV2CreationSource =
  | {
      kind: "blank";
      importId?: string | null;
    }
  | {
      kind: "template";
      items: CanonicalV2TemplateItem[];
    }
  | {
      kind: "import";
      importId: string;
      mappingId: string | null;
      filename: string;
      sectionTitle?: string | null;
      items: RpcImportItemPayload[];
    };

export type PersistCanonicalEstimateV2Input = {
  supabase: Supabase;
  tenantId: string;
  actorUserId: string;
  project: ExistingProjectTarget | NewProjectTarget;
  version?: CanonicalV2VersionOverrides;
  source: CanonicalV2CreationSource;
};

export type PersistCanonicalEstimateV2Result = {
  project: EstimateProjectRow;
  version: EstimateVersionRow;
  insertedLineCount: number;
  insertedSectionCount: number;
  rootSectionId: string | null;
};

export type InstantiateCanonicalEstimateV2FromTemplateInput = {
  supabase: Supabase;
  tenantId: string;
  actorUserId: string;
  templateId: string;
  project: ExistingProjectTarget | NewProjectTarget;
  versionTitle?: string | null;
  dateDevis?: string | null;
  validiteJours?: number | null;
};

type LatestVersionDefaults = Pick<
  EstimateVersionRow,
  | "date_devis"
  | "validite_jours"
  | "margin_multiplier"
  | "margin_mode"
  | "currency"
  | "margin_bp"
  | "discount_bp"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "tax_rate_bp"
  | "rounding_mode"
  | "rounding_step_cents"
  | "max_section_depth"
  | "contractor_role"
>;

const DEFAULT_VERSION_SETTINGS: LatestVersionDefaults = {
  date_devis: "",
  validite_jours: 30,
  margin_multiplier: 1,
  margin_mode: "fixed",
  currency: "EUR",
  margin_bp: 0,
  discount_bp: 0,
  discount_mode: "simple",
  discount_steps: [],
  global_coefficient: 1,
  tax_rate_bp: 2000,
  rounding_mode: "none",
  rounding_step_cents: 1,
  max_section_depth: DEFAULT_MAX_SECTION_DEPTH,
  contractor_role: "principal",
};

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeNullableText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toJsonObject(value: Json | undefined): Record<string, Json | undefined> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as Record<string, Json | undefined>;
}

function createImportSectionTitle(value: string | null | undefined) {
  const explicitTitle = normalizeNullableText(value);
  if (explicitTitle) return explicitTitle;

  const timestamp = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Paris",
  }).format(new Date());
  return `Import DPGF ${timestamp}`;
}

function createBaseItem(input: {
  id: string;
  parentId: string | null;
  itemType: "section" | "line";
  position: number;
  title: string;
}): CanonicalEstimateCreationItem {
  return {
    id: input.id,
    parent_id: input.parentId,
    item_type: input.itemType,
    position: input.position,
    title: input.title,
    description: null,
    quantity: null,
    unit_price_ht_cents: null,
    tax_rate_bp: null,
    k_fo: null,
    h_mo: null,
    h_mo_majoration: 1,
    k_mo: null,
    h_mo_atelier: null,
    k_mo_atelier: 1,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: 1,
    labor_role_chantier_id: null,
    pu_ht_cents: null,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    source_provider: null,
    source_job_id: null,
    source_file_name: null,
    source_page: null,
    source_metadata: {},
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
  };
}

function cloneTemplateItems(
  items: CanonicalV2TemplateItem[]
): CanonicalEstimateCreationItem[] {
  const sourceById = new Map<string, CanonicalV2TemplateItem>();
  for (const item of items) {
    if (!item.id || sourceById.has(item.id)) {
      throw new Error("ESTIMATE_TEMPLATE_ITEM_ID_INVALID");
    }
    sourceById.set(item.id, item);
  }
  const idBySourceId = new Map(items.map((item) => [item.id!, randomUUID()]));

  const clonedBySourceId = new Map(
    items.map((item) => {
      const id = idBySourceId.get(item.id!);
      if (!id) throw new Error("ESTIMATE_TEMPLATE_ITEM_ID_INVALID");

      const parentId = item.parent_id
        ? idBySourceId.get(item.parent_id) ?? null
        : null;
      if (item.parent_id && !parentId) {
        throw new Error("ESTIMATE_TEMPLATE_HIERARCHY_INVALID");
      }

      return [
        item.id!,
        {
          ...createBaseItem({
            id,
            parentId,
            itemType: item.item_type,
            position: item.position ?? 0,
            title: item.title,
          }),
          description: item.description ?? null,
          quantity: item.quantity ?? null,
          unit_price_ht_cents: item.unit_price_ht_cents ?? null,
          tax_rate_bp: item.tax_rate_bp ?? null,
          k_fo: item.k_fo ?? null,
          h_mo: item.h_mo ?? null,
          h_mo_majoration: item.h_mo_majoration ?? 1,
          k_mo: item.k_mo ?? null,
          h_mo_atelier: item.h_mo_atelier ?? null,
          k_mo_atelier: item.k_mo_atelier ?? 1,
          labor_role_atelier_id: item.labor_role_atelier_id ?? null,
          h_mo_chantier: item.h_mo_chantier ?? null,
          k_mo_chantier: item.k_mo_chantier ?? 1,
          labor_role_chantier_id: item.labor_role_chantier_id ?? null,
          pu_ht_cents: item.pu_ht_cents ?? null,
          labor_role_id: item.labor_role_id ?? null,
          category_id: item.category_id ?? null,
          supply_type_id: item.supply_type_id ?? null,
          line_total_ht_cents: item.line_total_ht_cents ?? null,
          line_tax_cents: item.line_tax_cents ?? null,
          line_total_ttc_cents: item.line_total_ttc_cents ?? null,
        },
      ] as const;
    })
  );

  const ordered: CanonicalEstimateCreationItem[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (sourceId: string) => {
    if (visited.has(sourceId)) return;
    if (visiting.has(sourceId)) {
      throw new Error("ESTIMATE_TEMPLATE_HIERARCHY_INVALID");
    }
    const source = sourceById.get(sourceId);
    const cloned = clonedBySourceId.get(sourceId);
    if (!source || !cloned) {
      throw new Error("ESTIMATE_TEMPLATE_ITEM_ID_INVALID");
    }
    visiting.add(sourceId);
    if (source.parent_id) {
      if (!sourceById.has(source.parent_id)) {
        throw new Error("ESTIMATE_TEMPLATE_HIERARCHY_INVALID");
      }
      visit(source.parent_id);
    }
    visiting.delete(sourceId);
    visited.add(sourceId);
    ordered.push(cloned);
  };

  for (const item of items) visit(item.id!);
  return ordered;
}

function createImportItems(source: Extract<CanonicalV2CreationSource, { kind: "import" }>) {
  const rootSectionId = randomUUID();
  const items: CanonicalEstimateCreationItem[] = [
    {
      ...createBaseItem({
        id: rootSectionId,
        parentId: null,
        itemType: "section",
        position: 1,
        title: createImportSectionTitle(source.sectionTitle),
      }),
      source_provider: "dpgf",
      source_file_name: source.filename,
      source_metadata: {
        import_id: source.importId,
        kind: "import_root",
      },
    },
  ];
  let levelOneSectionId: string | null = null;
  let levelTwoSectionId: string | null = null;
  let insertedLineCount = 0;
  let insertedSectionCount = 1;

  source.items.forEach((sourceItem, index) => {
    const position = index + 1;
    const sourceMetadata = {
      ...toJsonObject(sourceItem.source_metadata),
      import_id: source.importId,
      mapping_id: source.mappingId,
      mapped_row_id: sourceItem.mapped_row_id,
      row_index: sourceItem.row_index,
      ...(sourceItem.item_type === "line" && sourceItem.notes
        ? { notes: sourceItem.notes }
        : {}),
    } satisfies Record<string, Json | undefined>;

    if (sourceItem.item_type === "section") {
      const id = randomUUID();
      let parentId: string;
      if (sourceItem.section_level === 1) {
        parentId = rootSectionId;
        levelOneSectionId = id;
        levelTwoSectionId = null;
      } else {
        if (!levelOneSectionId) {
          throw new Error("ESTIMATE_IMPORT_LEVEL_TWO_WITHOUT_LEVEL_ONE");
        }
        parentId = levelOneSectionId;
        levelTwoSectionId = id;
      }

      items.push({
        ...createBaseItem({
          id,
          parentId,
          itemType: "section",
          position,
          title: normalizeNullableText(sourceItem.title) ?? `Section ${position}`,
        }),
        source_provider: "dpgf",
        source_file_name: source.filename,
        source_page: sourceItem.source_page,
        source_metadata: sourceMetadata as Json,
      });
      insertedSectionCount += 1;
      return;
    }

    const parentId = levelTwoSectionId ?? levelOneSectionId ?? rootSectionId;
    items.push({
      ...createBaseItem({
        id: randomUUID(),
        parentId,
        itemType: "line",
        position,
        title: normalizeNullableText(sourceItem.title) ?? `Ligne ${position}`,
      }),
      description: normalizeNullableText(sourceItem.description),
      quantity: sourceItem.quantity,
      unit_price_ht_cents: sourceItem.unit_price_ht_cents,
      tax_rate_bp: sourceItem.tax_rate_bp,
      k_fo: sourceItem.k_fo,
      h_mo: sourceItem.h_mo,
      h_mo_majoration: sourceItem.h_mo_majoration,
      k_mo: sourceItem.k_mo,
      pu_ht_cents: sourceItem.pu_ht_cents,
      source_provider: "dpgf",
      source_file_name: source.filename,
      source_page: sourceItem.source_page,
      source_metadata: sourceMetadata as Json,
      line_total_ht_cents: sourceItem.line_total_ht_cents,
      line_tax_cents: sourceItem.line_tax_cents,
      line_total_ttc_cents: sourceItem.line_total_ttc_cents,
    });
    insertedLineCount += 1;
  });

  return {
    items,
    insertedLineCount,
    insertedSectionCount,
    rootSectionId,
  };
}

async function loadExistingProjectContext(input: {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
}) {
  const { data: project, error: projectError } = await input.supabase
    .from("estimate_projects")
    .select("id, user_id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.projectId)
    .eq("is_archived", false)
    .maybeSingle();
  if (projectError || !project) {
    throw new Error("ESTIMATE_CANONICAL_V2_PROJECT_NOT_FOUND", {
      cause: projectError ?? undefined,
    });
  }

  const { data: latestVersion, error: versionError } = await input.supabase
    .from("estimate_versions")
    .select(
      "date_devis, validite_jours, margin_multiplier, margin_mode, currency, margin_bp, discount_bp, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, max_section_depth, contractor_role"
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("version_number", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) {
    throw new Error("ESTIMATE_CANONICAL_V2_DEFAULTS_UNAVAILABLE", {
      cause: versionError,
    });
  }

  return {
    projectUserId: project.user_id,
    latestVersion: (latestVersion ?? null) as LatestVersionDefaults | null,
  };
}

function resolveVersionPayload(input: {
  overrides?: CanonicalV2VersionOverrides;
  latestVersion: LatestVersionDefaults | null;
}) {
  const base = {
    ...DEFAULT_VERSION_SETTINGS,
    date_devis: todayDateOnly(),
    ...(input.latestVersion ?? {}),
    ...(input.overrides ?? {}),
  };

  return {
    id: randomUUID(),
    title: normalizeNullableText(input.overrides?.title),
    date_devis: base.date_devis,
    validite_jours: base.validite_jours,
    margin_multiplier: base.margin_multiplier,
    margin_mode: base.margin_mode,
    currency: base.currency,
    margin_bp: base.margin_bp,
    discount_bp: base.discount_bp,
    discount_mode: base.discount_mode,
    discount_steps: base.discount_steps,
    global_coefficient: base.global_coefficient,
    tax_rate_bp: base.tax_rate_bp,
    rounding_mode: base.rounding_mode,
    rounding_step_cents: base.rounding_step_cents,
    max_section_depth: base.max_section_depth,
    contractor_role: base.contractor_role,
    calc_engine_version: NEW_ESTIMATE_CALC_ENGINE_VERSION,
    total_ht_cents: 0,
    total_tax_cents: 0,
    total_ttc_cents: 0,
  };
}

function toCalculationItem(item: CanonicalEstimateCreationItem): EstimateItemRecord {
  return {
    id: item.id!,
    parent_id: item.parent_id ?? null,
    item_type: item.item_type,
    position: item.position ?? 0,
    title: item.title,
    description: item.description ?? null,
    quantity: item.quantity ?? null,
    unit_price_ht_cents: item.unit_price_ht_cents ?? null,
    tax_rate_bp: item.tax_rate_bp ?? null,
    k_fo: item.k_fo ?? null,
    h_mo: item.h_mo ?? null,
    h_mo_majoration: item.h_mo_majoration ?? 1,
    k_mo: item.k_mo ?? null,
    h_mo_atelier: item.h_mo_atelier ?? null,
    k_mo_atelier: item.k_mo_atelier ?? 1,
    labor_role_atelier_id: item.labor_role_atelier_id ?? null,
    h_mo_chantier: item.h_mo_chantier ?? null,
    k_mo_chantier: item.k_mo_chantier ?? 1,
    labor_role_chantier_id: item.labor_role_chantier_id ?? null,
    pu_ht_cents: item.pu_ht_cents ?? null,
    labor_role_id: item.labor_role_id ?? null,
    category_id: item.category_id ?? null,
    supply_type_id: item.supply_type_id ?? null,
    line_total_ht_cents: item.line_total_ht_cents ?? null,
    line_tax_cents: item.line_tax_cents ?? null,
    line_total_ttc_cents: item.line_total_ttc_cents ?? null,
  };
}

/**
 * Unique seam for every non-duplication estimate creation path. It owns source
 * normalization, hierarchy remapping, v2 calculation and the protected atomic
 * persistence contract; callers only provide authenticated domain context.
 */
export async function persistCanonicalEstimateV2(
  input: PersistCanonicalEstimateV2Input
): Promise<PersistCanonicalEstimateV2Result> {
  const existingContext =
    input.project.kind === "existing"
      ? await loadExistingProjectContext({
          supabase: input.supabase,
          tenantId: input.tenantId,
          projectId: input.project.id,
        })
      : null;
  const projectUserId = existingContext?.projectUserId ?? input.actorUserId;
  const versionPayload = resolveVersionPayload({
    overrides: input.version,
    latestVersion: existingContext?.latestVersion ?? null,
  });
  const sourceResult =
    input.source.kind === "blank"
      ? {
          items: [],
          insertedLineCount: 0,
          insertedSectionCount: 0,
          rootSectionId: null,
        }
      : input.source.kind === "template"
      ? {
          items: cloneTemplateItems(input.source.items),
          insertedLineCount: input.source.items.filter(
            (item) => item.item_type === "line"
          ).length,
          insertedSectionCount: input.source.items.filter(
            (item) => item.item_type === "section"
          ).length,
          rootSectionId: null,
        }
      : createImportItems(input.source);
  const calculationItems = sourceResult.items.map(toCalculationItem);
  const versionConfig: EstimateTotalsVersionConfig = {
    margin_multiplier: versionPayload.margin_multiplier,
    margin_mode: versionPayload.margin_mode,
    tax_rate_bp: versionPayload.tax_rate_bp,
    discount_bp: versionPayload.discount_bp,
    discount_mode: versionPayload.discount_mode,
    discount_steps: versionPayload.discount_steps,
    global_coefficient: versionPayload.global_coefficient,
    rounding_mode: versionPayload.rounding_mode,
    rounding_step_cents: versionPayload.rounding_step_cents,
    contractor_role: versionPayload.contractor_role,
    calc_engine_version: NEW_ESTIMATE_CALC_ENGINE_VERSION,
  };
  const calculated = await calculateEstimateSnapshotForItems({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectUserId,
    version: versionConfig,
    lineItems: calculationItems,
  });
  if (!calculated.breakdown.invariants.matchesFooter) {
    throw new Error("ESTIMATE_CANONICAL_V2_TOTALS_OUT_OF_SYNC");
  }
  const projection = buildEstimateV2SnapshotProjection({
    items: calculationItems,
    breakdown: calculated.breakdown,
  });
  const projectionById = new Map(projection.items.map((item) => [item.id, item]));
  const persistedItems = sourceResult.items.map((item) => {
    const projected = projectionById.get(item.id!);
    if (!projected) return item;
    return {
      ...item,
      line_total_ht_cents: projected.line_total_ht_cents,
      line_tax_cents: projected.line_tax_cents,
      line_total_ttc_cents: projected.line_total_ttc_cents,
    };
  });
  Object.assign(versionPayload, {
    total_ht_cents: projection.totals.total_ht_cents,
    total_tax_cents: projection.totals.total_tax_cents,
    total_ttc_cents: projection.totals.total_ttc_cents,
  });

  const projectId =
    input.project.kind === "existing" ? input.project.id : input.project.id ?? randomUUID();
  const projectPayload =
    input.project.kind === "new"
      ? {
          id: projectId,
          name: input.project.name.trim(),
          reference: normalizeNullableText(input.project.reference),
          client_name: normalizeNullableText(input.project.clientName),
          notes: normalizeNullableText(input.project.notes),
        }
      : null;
  const persistenceClient = createServiceRoleClient();
  const { data, error } = await persistenceClient.rpc(
    "persist_estimate_creation_atomic",
    {
      p_tenant_id: input.tenantId,
      p_actor_user_id: input.actorUserId,
      p_project_id: input.project.kind === "existing" ? projectId : null,
      p_project_payload: projectPayload,
      p_version_payload: versionPayload,
      p_items: persistedItems,
      p_import_id:
        input.source.kind === "import"
          ? input.source.importId
          : input.source.kind === "blank"
            ? input.source.importId ?? null
            : null,
    }
  );
  if (error || !data) {
    throw new Error("ESTIMATE_CANONICAL_V2_PERSIST_FAILED", {
      cause: error ?? undefined,
    });
  }

  const persisted = data as unknown as {
    project?: EstimateProjectRow;
    version?: EstimateVersionRow;
  };
  if (!persisted.project?.id || !persisted.version?.id) {
    throw new Error("ESTIMATE_CANONICAL_V2_RESPONSE_INVALID");
  }

  return {
    project: persisted.project,
    version: persisted.version,
    insertedLineCount: sourceResult.insertedLineCount,
    insertedSectionCount: sourceResult.insertedSectionCount,
    rootSectionId: sourceResult.rootSectionId,
  };
}

/** Template adapter at the same seam: loading and translating template defaults
 * stay private to the canonical creation module instead of leaking to callers. */
export async function instantiateCanonicalEstimateV2FromTemplate(
  input: InstantiateCanonicalEstimateV2FromTemplateInput
) {
  const { data: templateData, error: templateError } = await input.supabase
    .from("estimate_templates")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.templateId)
    .maybeSingle();
  if (templateError || !templateData) {
    throw new Error("ESTIMATE_CANONICAL_V2_TEMPLATE_NOT_FOUND", {
      cause: templateError ?? undefined,
    });
  }
  const template = templateData as EstimateTemplateRow;

  const { data: itemData, error: itemError } = await input.supabase
    .from("estimate_template_items")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("template_id", input.templateId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (itemError) {
    throw new Error("ESTIMATE_CANONICAL_V2_TEMPLATE_ITEMS_UNAVAILABLE", {
      cause: itemError,
    });
  }

  return persistCanonicalEstimateV2({
    supabase: input.supabase,
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    project: input.project,
    version: {
      title: normalizeNullableText(input.versionTitle),
      date_devis: input.dateDevis ?? todayDateOnly(),
      validite_jours: input.validiteJours ?? template.validite_jours,
      margin_multiplier: template.margin_multiplier,
      margin_mode: template.margin_mode,
      currency: template.currency,
      margin_bp: template.margin_bp,
      discount_bp: template.discount_bp,
      discount_mode: template.discount_mode,
      discount_steps: template.discount_steps,
      global_coefficient: template.global_coefficient,
      tax_rate_bp: template.tax_rate_bp,
      rounding_mode: template.rounding_mode,
      rounding_step_cents: template.rounding_step_cents,
    },
    source: {
      kind: "template",
      items: (itemData ?? []) as EstimateTemplateItemRow[],
    },
  });
}
