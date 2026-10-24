import { readAllRows } from "@/lib/supabase/read-all";
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import type { RpcImportItemPayload } from "@/lib/affaires/import-flow-server";
import { buildEstimateV2SnapshotProjection } from "@/lib/estimate-v2-snapshot";
import type { CalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import {
  calcPolicyContextChanged,
  isCalcPolicyContextChangedError,
  readTenantCalcPolicy,
  resolveNewEstimateEngine,
  type TenantCalcPolicy,
} from "@/lib/estimates/calc-policy-server";
import { DEFAULT_TAX_RATE_BP } from "@/lib/estimates/constants";
import {
  assertNever,
  EstimateEngineUnavailableError,
  usesPerUnitLabor,
  usesSaleCoefficients,
} from "@/lib/estimates/engine/capabilities";
import { badRequest, internalError, mapSupabaseError } from "@/lib/estimates/errors";
import {
  assertTemplateLaborRolesOwnedForV3,
  templateHoursWithoutQuantityMessage,
} from "@/lib/estimates/estimate-template-helpers";
import { deriveFoProvision, loadSupplyTypeFoProvisions } from "@/lib/estimates/fo-provision";
import {
  buildHierarchyIndex,
  DEFAULT_MAX_SECTION_DEPTH,
  MAX_SECTION_DEPTH,
  resolveSectionLevel,
} from "@/lib/estimates/hierarchy";
import {
  listTemplateLinesConvertedForV3,
  templateLineHoursPerUnitForV3,
  type TemplateV3ConvertedLine,
} from "@/lib/estimates/template-v3-hours";
import { resolveTemplateV3VersionSettings, type TemplateV3DroppedSetting } from "@/lib/estimates/template-v3-settings";
import { assertEstimateV3VersionShape, toEstimateV3VersionTotals } from "@/lib/estimates/v3-persistence";
import {
  calculateEstimateSnapshotForItems,
  calculateEstimateV3SnapshotForItems,
  type EstimateTotalsVersionConfig,
} from "@/lib/estimates/version-totals";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";
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
    | "discount_amount_cents"
    | "discount_mode"
    | "discount_steps"
    | "global_coefficient"
    | "tax_rate_bp"
    | "rounding_mode"
    | "rounding_step_cents"
    | "max_section_depth"
    | "contractor_role"
    | "sale_coefficient_fo"
    | "sale_coefficient_mo"
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
} & Partial<Pick<
  EstimateItemInsert,
  "unit_code" | "pricing_status" | "h_mo_per_unit" | "h_mo_atelier_per_unit" | "h_mo_chantier_per_unit"
>>;

/** Réglages de version et coefficients de vente d'un modèle (M6 : coefficients nuls hors modèle issu d'une v3). */
export type CanonicalTemplateSettings = Pick<
  EstimateTemplateRow,
  | "margin_multiplier"
  | "margin_mode"
  | "currency"
  | "margin_bp"
  | "discount_bp"
  | "discount_amount_cents"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "tax_rate_bp"
  | "rounding_mode"
  | "rounding_step_cents"
  | "sale_coefficient_fo"
  | "sale_coefficient_mo"
>;

type CanonicalV2CreationSource =
  | {
      kind: "blank";
      importId?: string | null;
    }
  | {
      kind: "template";
      items: CanonicalV2TemplateItem[];
      /**
       * Sous-lot 2.10a (A1, D-h) : réglages du modèle. En v2, ceux de la version créée ; en v3, seuls ceux
       * qu'elle sait représenter, les autres listés (`templateConversion`), et les coefficients du modèle
       * issu d'une v3, sinon ceux de la politique.
       */
      settings?: CanonicalTemplateSettings;
    }
  | {
      kind: "import";
      importId: string;
      mappingId: string | null;
      filename: string;
      sectionTitle?: string | null;
      items: RpcImportItemPayload[];
      /**
       * Lot 2, sous-lot 2.8 (D16) : 3 quand les lignes ont été normalisées pour le moteur 3 (heures par
       * unité, unité du référentiel, statut). Seul un tel import entre dans une v3 ; sans lui, refus nommé.
       */
      engine?: number;
    };

export type PersistCanonicalEstimateV2Input = {
  supabase: Supabase;
  tenantId: string;
  actorUserId: string;
  project: ExistingProjectTarget | NewProjectTarget;
  version?: CanonicalV2VersionOverrides;
  source: CanonicalV2CreationSource;
  /**
   * Lot 2, sous-lot 2.5 (D3) : moteur que le client attend pour ses projections. Absent = 2 ;
   * tout écart avec la politique de l'entreprise lève `CONTEXT_CHANGED` sans rien écrire.
   */
  expectedCalcEngineVersion?: number | null;
};

/** Sous-lot 2.10a (P-12, D-h) : rapport d'un modèle entré dans une v3, même forme que son insertion (M6). */
export type CanonicalTemplateV3Conversion = {
  converted_lines: TemplateV3ConvertedLine[];
  dropped_settings: TemplateV3DroppedSetting[];
};

export type PersistCanonicalEstimateV2Result = {
  project: EstimateProjectRow;
  version: EstimateVersionRow;
  insertedLineCount: number;
  insertedSectionCount: number;
  rootSectionId: string | null;
  /** Création depuis un modèle en moteur 3 seulement. */
  templateConversion?: CanonicalTemplateV3Conversion;
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
  /** Sous-lot 2.10a (D3) : moteur attendu par le client ; absent = 2. */
  expectedCalcEngineVersion?: number | null;
};

/** Moteur historique de la préparation v2, atteinte seulement quand la politique vaut 2. */
const CANONICAL_V2_CALC_ENGINE_VERSION: CalcEngineVersion = 2;

type LatestVersionDefaults = Pick<
  EstimateVersionRow,
  | "date_devis"
  | "validite_jours"
  | "margin_multiplier"
  | "margin_mode"
  | "currency"
  | "margin_bp"
  | "discount_bp"
  | "discount_amount_cents"
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
  discount_amount_cents: null,
  discount_mode: "simple",
  discount_steps: [],
  global_coefficient: 1,
  tax_rate_bp: DEFAULT_TAX_RATE_BP,
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
  items: CanonicalV2TemplateItem[],
  // Sous-lot 2.10a : conversion d'une ligne pour le moteur 3 (heures par unité, unité, défauts de M6).
  mapLine?: (cloned: CanonicalEstimateCreationItem, source: CanonicalV2TemplateItem) => CanonicalEstimateCreationItem
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
    ordered.push(mapLine && cloned.item_type === "line" ? mapLine(cloned, source) : cloned);
  };

  for (const item of items) visit(item.id!);
  return ordered;
}

/**
 * Sous-lot 2.10a (A1, P-12) : une ligne de modèle entrant dans une v3 à sa création, miroir de son insertion dans
 * une v3 (M6 `insert_estimate_template_into_version` puis `estimate_v3_complete_entry_for_writer`) : mêmes
 * défauts (Q 1, PR 0, K 1), heures par unité du modèle issu d'une v3 ou h / Q, unité du modèle, sinon celle
 * du référentiel lue sur `description` pour une ligne chiffrée. Montants : moteur 3, plus loin. Le déclencheur v3
 * dérive les heures de la ligne et la TVA absente (celle de la version).
 */
function toV3TemplateLine(
  cloned: CanonicalEstimateCreationItem,
  source: CanonicalV2TemplateItem
): CanonicalEstimateCreationItem {
  const hours = templateLineHoursPerUnitForV3({
    item_type: source.item_type,
    title: source.title,
    quantity: source.quantity ?? null,
    h_mo: source.h_mo ?? null,
    h_mo_atelier: source.h_mo_atelier ?? null,
    h_mo_chantier: source.h_mo_chantier ?? null,
    h_mo_per_unit: source.h_mo_per_unit,
    h_mo_atelier_per_unit: source.h_mo_atelier_per_unit,
    h_mo_chantier_per_unit: source.h_mo_chantier_per_unit,
  });
  if (!hours) {
    throw badRequest(templateHoursWithoutQuantityMessage(source.title), { title: source.title },
      "ESTIMATE_V3_TEMPLATE_HOURS_WITHOUT_QUANTITY");
  }
  const pricingStatus = source.pricing_status ?? "priced";
  const unit = !source.unit_code && pricingStatus === "priced" ? normalizeMeasurementUnit(source.description) : null;
  return {
    ...cloned,
    quantity: source.quantity ?? 1,
    unit_price_ht_cents: source.unit_price_ht_cents ?? 0,
    k_fo: source.k_fo ?? 1,
    h_mo: source.h_mo ?? 0,
    k_mo: source.k_mo ?? 1,
    unit_code: source.unit_code ?? unit?.unitCode ?? null,
    pricing_status: unit?.pricingStatus ?? pricingStatus,
    ...hours,
  };
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
        source_metadata: sourceMetadata,
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
      // Sub-lot 2.3 (E17): imported hours keep the labour role chosen at the preview.
      labor_role_id: sourceItem.labor_role_id ?? null,
      pu_ht_cents: sourceItem.pu_ht_cents,
      source_provider: "dpgf",
      source_file_name: source.filename,
      source_page: sourceItem.source_page,
      source_metadata: sourceMetadata,
      line_total_ht_cents: sourceItem.line_total_ht_cents,
      line_tax_cents: sourceItem.line_tax_cents,
      line_total_ttc_cents: sourceItem.line_total_ttc_cents,
      // Sub-lot 2.8: the v3 columns of a line normalized for engine 3, absent otherwise.
      ...(sourceItem.pricing_status !== undefined
        ? {
            unit_code: sourceItem.unit_code ?? null,
            pricing_status: sourceItem.pricing_status,
            h_mo_per_unit: sourceItem.h_mo_per_unit ?? null,
          }
        : {}),
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
      "date_devis, validite_jours, margin_multiplier, margin_mode, currency, margin_bp, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, max_section_depth, contractor_role"
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

/**
 * Revue de suivi de F4 (PR #33, §10.6) : niveau de la section la plus profonde du contenu créé (0 sans section).
 * Racine d'import 1, ses sections de niveau 1 et 2 aux niveaux 2 et 3 ; un modèle, sa propre hiérarchie.
 */
function requiredSectionDepthOf(items: CanonicalEstimateCreationItem[]) {
  const index = buildHierarchyIndex(items.map((item) => ({
    id: item.id!,
    parent_id: item.parent_id ?? null,
    item_type: item.item_type,
  })));
  return items.reduce((deepest, item) => item.item_type === "section"
    ? Math.max(deepest, resolveSectionLevel(index, item.id!) ?? 0)
    : deepest, 0);
}

/**
 * Profondeur de la version créée : celle fournie par l'appelant, sinon celle héritée (dernière version de l'affaire,
 * 3 pour une affaire neuve) relevée au besoin du contenu, jamais abaissée. Une version qui naîtrait moins profonde que
 * ses sections serait refusée par `validate_estimate_item_hierarchy_depth`, opaque ; une profondeur fournie trop
 * faible est refusée ici, nommée, avant toute écriture.
 */
function resolveCreationSectionDepth(input: {
  supplied: number | null | undefined;
  inherited: number | null | undefined;
  required: number;
}) {
  const depth = input.supplied ??
    Math.max(input.inherited ?? DEFAULT_VERSION_SETTINGS.max_section_depth, input.required);
  if (input.required > depth || input.required > MAX_SECTION_DEPTH) {
    throw badRequest(
      "La profondeur de sections demandée ne contient pas les sections créées.",
      { max_section_depth: depth, required_section_depth: input.required },
      "ESTIMATE_SECTION_DEPTH_TOO_SHALLOW"
    );
  }
  return depth;
}

function resolveVersionPayload(input: {
  overrides?: CanonicalV2VersionOverrides;
  latestVersion: LatestVersionDefaults | null;
  requiredSectionDepth: number;
}) {
  const base = {
    ...DEFAULT_VERSION_SETTINGS,
    date_devis: todayDateOnly(),
    ...(input.latestVersion ?? {}),
    ...(input.overrides ?? {}),
  };
  const maxSectionDepth = resolveCreationSectionDepth({
    supplied: input.overrides?.max_section_depth,
    inherited: input.latestVersion?.max_section_depth,
    required: input.requiredSectionDepth,
  });

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
    discount_amount_cents: base.discount_amount_cents,
    discount_mode: base.discount_mode,
    discount_steps: base.discount_steps,
    global_coefficient: base.global_coefficient,
    tax_rate_bp: base.tax_rate_bp,
    rounding_mode: base.rounding_mode,
    rounding_step_cents: base.rounding_step_cents,
    max_section_depth: maxSectionDepth,
    contractor_role: base.contractor_role,
    calc_engine_version: CANONICAL_V2_CALC_ENGINE_VERSION,
    total_ht_cents: 0,
    total_tax_cents: 0,
    total_ttc_cents: 0,
  };
}

/** Réglages neutres repris de la dernière version de l'affaire pour une v3 (jamais sa marge v2). */
const V3_INHERITED_SETTINGS = [
  "date_devis",
  "validite_jours",
  "currency",
  "tax_rate_bp",
  "max_section_depth",
  "contractor_role",
] as const satisfies ReadonlyArray<keyof LatestVersionDefaults>;

/** Réglages de création propres au moteur 3 (D5) : fournis ou ceux de la politique ; refusés sur une v2. */
const V3_CREATION_SETTINGS = ["sale_coefficient_fo", "sale_coefficient_mo"] as const;

/**
 * Lot 2, sous-lot 2.5 - charge de version v3 (D5 à D7, §6.2). Une v3 naît en marge fixe à 1,
 * coefficient global 1, remise simple, avec les coefficients de vente fournis ou ceux de la
 * politique ; elle ne reprend de la dernière version que des réglages neutres (une v2 peut porter
 * un palier, un coefficient global ou deux intentions de remise que la v3 interdit).
 */
function resolveV3VersionPayload(input: {
  overrides?: CanonicalV2VersionOverrides;
  latestVersion: LatestVersionDefaults | null;
  policy: TenantCalcPolicy;
  requiredSectionDepth: number;
}) {
  const inherited: Partial<LatestVersionDefaults> = {};
  for (const key of V3_INHERITED_SETTINGS) {
    if (input.latestVersion) Object.assign(inherited, { [key]: input.latestVersion[key] });
  }
  const base = {
    ...DEFAULT_VERSION_SETTINGS,
    date_devis: todayDateOnly(),
    ...inherited,
    ...(input.overrides ?? {}),
  };
  assertEstimateV3VersionShape(base);
  const saleCoefficientFo = input.overrides?.sale_coefficient_fo ?? input.policy.defaultSaleCoefficientFo;
  const saleCoefficientMo = input.overrides?.sale_coefficient_mo ?? input.policy.defaultSaleCoefficientMo;
  if (saleCoefficientFo === null || saleCoefficientFo === undefined ||
    saleCoefficientMo === null || saleCoefficientMo === undefined) {
    throw internalError("La politique de calcul de l'entreprise n'a pas de coefficients de vente par défaut.");
  }
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
    discount_amount_cents: base.discount_amount_cents,
    discount_mode: base.discount_mode,
    discount_steps: base.discount_steps,
    global_coefficient: base.global_coefficient,
    tax_rate_bp: base.tax_rate_bp,
    rounding_mode: base.rounding_mode,
    rounding_step_cents: base.rounding_step_cents,
    max_section_depth: resolveCreationSectionDepth({
      supplied: input.overrides?.max_section_depth,
      inherited: input.latestVersion?.max_section_depth,
      required: input.requiredSectionDepth,
    }),
    contractor_role: base.contractor_role,
    // Moteur attendu par le client, revérifié par la RPC sous la politique verrouillée (D3).
    calc_engine_version: 3,
    sale_coefficient_fo: saleCoefficientFo,
    sale_coefficient_mo: saleCoefficientMo,
    gross_ht_cents: 0,
    discount_applied_cents: 0,
    commercial_rounding_cents: 0,
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

type CanonicalSourceResult = {
  items: CanonicalEstimateCreationItem[];
  insertedLineCount: number;
  insertedSectionCount: number;
  rootSectionId: string | null;
};

function resolveCanonicalSource(source: CanonicalV2CreationSource, engine: 2 | 3): CanonicalSourceResult {
  return source.kind === "blank"
    ? {
        items: [],
        insertedLineCount: 0,
        insertedSectionCount: 0,
        rootSectionId: null,
      }
    : source.kind === "template"
    ? {
        items: cloneTemplateItems(source.items, usesPerUnitLabor(engine) ? toV3TemplateLine : undefined),
        insertedLineCount: source.items.filter(
          (item) => item.item_type === "line"
        ).length,
        insertedSectionCount: source.items.filter(
          (item) => item.item_type === "section"
        ).length,
        rootSectionId: null,
      }
    : createImportItems(source);
}

/**
 * Sous-lot 2.10a (A1, D-h) : réglages de la version créée depuis un modèle. En v2, ceux du modèle tels quels (comme
 * avant 2.10a) ; en v3, ceux qu'elle sait représenter, les autres listés, et les coefficients du modèle issu
 * d'une v3, sinon ceux de la politique (fournis : les montants des lignes en dépendent).
 */
function resolveCreationVersionOverrides(input: PersistCanonicalEstimateV2Input, engine: 2 | 3, policy: TenantCalcPolicy): {
  overrides: CanonicalV2VersionOverrides | undefined;
  droppedSettings: TemplateV3DroppedSetting[];
} {
  const template = input.source.kind === "template" ? input.source.settings : undefined;
  if (!template) return { overrides: input.version, droppedSettings: [] };
  if (!usesSaleCoefficients(engine)) {
    return {
      overrides: {
        ...input.version,
        margin_multiplier: template.margin_multiplier,
        margin_mode: template.margin_mode,
        currency: template.currency,
        margin_bp: template.margin_bp,
        discount_bp: template.discount_bp,
        discount_amount_cents: template.discount_amount_cents,
        discount_mode: template.discount_mode,
        discount_steps: template.discount_steps,
        global_coefficient: template.global_coefficient,
        tax_rate_bp: template.tax_rate_bp,
        rounding_mode: template.rounding_mode,
        rounding_step_cents: template.rounding_step_cents,
      },
      droppedSettings: [],
    };
  }
  const { settings, dropped } = resolveTemplateV3VersionSettings(template);
  return {
    overrides: {
      ...input.version,
      ...settings,
      sale_coefficient_fo: template.sale_coefficient_fo == null ? policy.defaultSaleCoefficientFo : Number(template.sale_coefficient_fo),
      sale_coefficient_mo: template.sale_coefficient_mo == null ? policy.defaultSaleCoefficientMo : Number(template.sale_coefficient_mo),
    },
    droppedSettings: dropped,
  };
}

/** Préparation v2 inchangée : projection du moteur historique et charge canonique v2. */
async function prepareCanonicalV2Creation(input: PersistCanonicalEstimateV2Input, context: {
  projectUserId: string;
  latestVersion: LatestVersionDefaults | null;
  sourceResult: CanonicalSourceResult;
  overrides: CanonicalV2VersionOverrides | undefined;
}) {
  const { projectUserId, sourceResult } = context;
  const versionPayload = resolveVersionPayload({
    overrides: context.overrides,
    latestVersion: context.latestVersion,
    requiredSectionDepth: requiredSectionDepthOf(sourceResult.items),
  });
  const calculationItems = sourceResult.items.map(toCalculationItem);
  const versionConfig: EstimateTotalsVersionConfig = {
    margin_multiplier: versionPayload.margin_multiplier,
    margin_mode: versionPayload.margin_mode,
    tax_rate_bp: versionPayload.tax_rate_bp,
    discount_bp: versionPayload.discount_bp,
    discount_amount_cents: versionPayload.discount_amount_cents,
    discount_mode: versionPayload.discount_mode,
    discount_steps: versionPayload.discount_steps,
    global_coefficient: versionPayload.global_coefficient,
    rounding_mode: versionPayload.rounding_mode,
    rounding_step_cents: versionPayload.rounding_step_cents,
    contractor_role: versionPayload.contractor_role,
    calc_engine_version: CANONICAL_V2_CALC_ENGINE_VERSION,
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

  return { versionPayload, persistedItems };
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
  const policy = await readTenantCalcPolicy(input.supabase, input.tenantId);
  // Sous-lot 2.8 (D16) : sous politique 3, seuls une v3 vierge, un modèle (2.10a, converti ci-dessous) et un import
  // normalisé pour le moteur 3 entrent ; tout autre chemin (import normalisé pour la v2) reçoit un refus nommé et
  // définitif avant la comparaison des attentes : un chemin sans attente ne doit pas recevoir le CONTEXT_CHANGED
  // « rechargez la page », qui boucle (revue 2.5).
  const entersV3 = input.source.kind === "blank" || input.source.kind === "template" ||
    (input.source.kind === "import" && input.source.engine === 3);
  if (!entersV3 && usesSaleCoefficients(policy.engine)) throw new EstimateEngineUnavailableError();
  const engine = resolveNewEstimateEngine({ policy, expectedEngine: input.expectedCalcEngineVersion });
  const sourceResult = resolveCanonicalSource(input.source, engine);
  const { overrides, droppedSettings } = resolveCreationVersionOverrides(input, engine, policy);
  let prepared: { versionPayload: Record<string, unknown>; persistedItems: CanonicalEstimateCreationItem[] };
  switch (engine) {
    case 2: {
      // Revue 2.5 (V3P-13) : un coefficient de vente est un réglage v3 ; refus nommé, jamais un retrait silencieux.
      const v3Fields = V3_CREATION_SETTINGS.filter((key) => input.version?.[key] != null);
      if (v3Fields.length > 0) {
        throw badRequest("Ces réglages sont réservés au moteur de calcul 3.", { fields: v3Fields },
          "ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED");
      }
      prepared = await prepareCanonicalV2Creation(input, {
        projectUserId,
        latestVersion: existingContext?.latestVersion ?? null,
        sourceResult,
        overrides,
      });
      break;
    }
    case 3: {
      const versionPayload = resolveV3VersionPayload({
        overrides,
        latestVersion: existingContext?.latestVersion ?? null,
        policy,
        requiredSectionDepth: requiredSectionDepthOf(sourceResult.items),
      });
      // Sous-lot 2.8 : un import (2.10a : ou un modèle) entre avec ses lignes v3 ; leurs montants sont ceux du
      // moteur 3 aux coefficients fournis (la RPC les revérifie, estimate_v3_assert_draft_for_writer).
      if (sourceResult.items.length > 0 && V3_CREATION_SETTINGS.some((key) => overrides?.[key] == null)) {
        throw internalError("Un import vers le moteur 3 fournit ses coefficients de vente.");
      }
      if (input.source.kind === "template") {
        await assertTemplateLaborRolesOwnedForV3({
          supabase: input.supabase,
          tenantId: input.tenantId,
          projectUserId,
          templateItems: input.source.items,
        });
      }
      // Ligne sans TVA (modèle) : celle de la version, comme le déclencheur v3 et l'insertion M6.
      const v3Items = sourceResult.items.map((item) =>
        item.item_type === "line" && item.tax_rate_bp == null ? { ...item, tax_rate_bp: versionPayload.tax_rate_bp } : item);
      // TI-534 : provision FO que le déclencheur donne à chaque ligne créée, selon son type FO.
      const { provisions: foProvisions, error: foProvisionError } = await loadSupplyTypeFoProvisions(
        input.supabase, input.tenantId, v3Items.map((item) => item.supply_type_id));
      if (foProvisionError) throw mapSupabaseError(foProvisionError, "Impossible de lire les types de fourniture.");
      const lineItems = v3Items
        .filter((item) => item.item_type === "line")
        .map((item) => ({
          ...toCalculationItem(item),
          fo_provision: deriveFoProvision(item.supply_type_id, foProvisions),
          unit_code: item.unit_code ?? null,
          pricing_status: item.pricing_status ?? "priced",
          h_mo_per_unit: item.h_mo_per_unit ?? null,
          h_mo_atelier_per_unit: item.h_mo_atelier_per_unit ?? null,
          h_mo_chantier_per_unit: item.h_mo_chantier_per_unit ?? null,
        }));
      const calculated = await calculateEstimateV3SnapshotForItems({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectUserId,
        version: versionPayload,
        lineItems,
      });
      const lineById = new Map(lineItems.length > 0 ? calculated.breakdown.lines.map((line) => [line.id, line]) : []);
      // Coefficients que le client n'a pas fournis : la RPC prend ceux de la politique qu'elle relit FOR SHARE
      // sous le verrou consultatif, jamais ceux lus ici sans verrou (revue 2.5). Une v3 à blanc vaut 0 sous
      // n'importe quels coefficients : les totaux calculés restent exacts.
      const persistedPayload: Record<string, unknown> = { ...versionPayload };
      for (const key of V3_CREATION_SETTINGS) {
        if (overrides?.[key] == null) delete persistedPayload[key];
      }
      prepared = {
        versionPayload: { ...persistedPayload, ...toEstimateV3VersionTotals(calculated.breakdown) },
        persistedItems: v3Items.map((item) => {
          const line = item.item_type === "line" ? lineById.get(item.id!) : undefined;
          return line
            ? {
                ...item,
                pu_ht_cents: line.pu_ht_cents,
                line_total_ht_cents: line.line_total_ht_cents,
                line_tax_cents: line.line_tax_cents,
                line_total_ttc_cents: line.line_total_ttc_cents,
              }
            : item;
        }),
      };
      break;
    }
    default:
      return assertNever(engine);
  }
  const { versionPayload, persistedItems } = prepared;

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
      p_version_payload: versionPayload as Json,
      p_items: persistedItems,
      p_import_id:
        input.source.kind === "import"
          ? input.source.importId
          : input.source.kind === "blank"
            ? input.source.importId ?? null
            : null,
    }
  );
  if (isCalcPolicyContextChangedError(error)) throw calcPolicyContextChanged();
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
    ...(usesSaleCoefficients(engine) && input.source.kind === "template"
      ? {
          templateConversion: {
            // Même rapport que l'insertion du modèle dans une v3 (M6) : heures MO totales changées par h / Q.
            converted_lines: listTemplateLinesConvertedForV3(input.source.items.map((item) => ({
              item_type: item.item_type,
              title: item.title,
              quantity: item.quantity ?? null,
              h_mo: item.h_mo ?? null,
              h_mo_per_unit: item.h_mo_per_unit,
              h_mo_atelier_per_unit: item.h_mo_atelier_per_unit,
              h_mo_chantier_per_unit: item.h_mo_chantier_per_unit,
            }))),
            dropped_settings: droppedSettings,
          },
        }
      : {}),
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

  const { data: itemData, error: itemError } = await readAllRows(() => input.supabase
    .from("estimate_template_items")
    .select("*", { count: "exact" })
    .eq("tenant_id", input.tenantId)
    .eq("template_id", input.templateId)
    .order("position", { ascending: true })
    .order("id", { ascending: true }));
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
    expectedCalcEngineVersion: input.expectedCalcEngineVersion,
    version: {
      title: normalizeNullableText(input.versionTitle),
      date_devis: input.dateDevis ?? todayDateOnly(),
      validite_jours: input.validiteJours ?? template.validite_jours,
    },
    source: {
      kind: "template",
      items: (itemData ?? []) as EstimateTemplateItemRow[],
      // Réglages repris selon le moteur de la politique, relue par la création (2.10a, D-h).
      settings: {
        margin_multiplier: template.margin_multiplier,
        margin_mode: template.margin_mode,
        currency: template.currency,
        margin_bp: template.margin_bp,
        discount_bp: template.discount_bp,
        discount_amount_cents: template.discount_amount_cents,
        discount_mode: template.discount_mode,
        discount_steps: template.discount_steps,
        global_coefficient: template.global_coefficient,
        tax_rate_bp: template.tax_rate_bp,
        rounding_mode: template.rounding_mode,
        rounding_step_cents: template.rounding_step_cents,
        sale_coefficient_fo: template.sale_coefficient_fo ?? null,
        sale_coefficient_mo: template.sale_coefficient_mo ?? null,
      },
    },
  });
}
