import {
  IMPORT_PREVIEW_REQUIRED_MESSAGE,
  importRequiresPreview,
  normalizeMappedRowsForEstimateCreation,
  type ImportFlowMappedRowInput,
} from "@/lib/affaires/import-flow";
import type { ImportSaleCoefficients } from "@/lib/affaires/import-engine-server";
import { DEFAULT_TAX_RATE_BP } from "@/lib/estimates/constants";
import { badRequest } from "@/lib/estimates/errors";
import type { CreateEstimateInput } from "@/lib/estimates/schemas";
import type { Database } from "@/types/database";

type EstimateCategoryInsert = Database["public"]["Tables"]["estimate_categories"]["Insert"];
type LaborRoleInsert = Database["public"]["Tables"]["labor_roles"]["Insert"];
type VersionOverrides = CreateEstimateInput["version"];

const DEFAULT_ESTIMATE_CATEGORIES = [
  { name: "Materiaux", position: 1 },
  { name: "Main d'oeuvre", position: 2 },
  { name: "Sous-traitance", position: 3 },
] as const;

const DEFAULT_LABOR_ROLES = [
  { name: "Maçon", hourly_rate_cents: 0, position: 1 },
  { name: "Électricien", hourly_rate_cents: 0, position: 2 },
  { name: "Plombier", hourly_rate_cents: 0, position: 3 },
  { name: "Chauffagiste", hourly_rate_cents: 0, position: 4 },
  { name: "Menuisier", hourly_rate_cents: 0, position: 5 },
  { name: "Plaquiste", hourly_rate_cents: 0, position: 6 },
  { name: "Carreleur", hourly_rate_cents: 0, position: 7 },
  { name: "Peintre", hourly_rate_cents: 0, position: 8 },
  { name: "Couvreur", hourly_rate_cents: 0, position: 9 },
] as const;

export function defaultEstimateLaborRoleNames() {
  return DEFAULT_LABOR_ROLES.map((role) => role.name);
}

export function buildDefaultEstimateCategories(input: {
  tenantId: string;
  userId: string;
}): EstimateCategoryInsert[] {
  return DEFAULT_ESTIMATE_CATEGORIES.map((category) => ({
    tenant_id: input.tenantId,
    user_id: input.userId,
    name: category.name,
    position: category.position,
    color: null,
  }));
}

/** Only missing defaults may write through the tenant calculation gate. */
export function buildMissingDefaultEstimateLaborRoles(input: {
  tenantId: string;
  ownerUserId: string;
  existingNames: ReadonlySet<string>;
}): LaborRoleInsert[] {
  return DEFAULT_LABOR_ROLES
    .filter((role) => !input.existingNames.has(role.name))
    .map((role) => ({
      tenant_id: input.tenantId,
      user_id: input.ownerUserId,
      name: role.name,
      hourly_rate_cents: role.hourly_rate_cents,
      is_active: true,
      position: role.position,
    }));
}

/** Keep the direct creation contract, its row order and its preview refusal. */
export function prepareLinkedDpgfCreationRows(input: {
  mappedRows: ImportFlowMappedRowInput[];
  version: VersionOverrides;
  latestVersionDefaults: {
    margin_multiplier: number;
    tax_rate_bp: number;
  } | null;
  lineContext: {
    engine?: number;
    saleCoefficientFo?: number;
    saleCoefficientMo?: number;
  };
}) {
  const normalized = normalizeMappedRowsForEstimateCreation(input.mappedRows, {
    marginMultiplier:
      input.version?.margin_multiplier ??
      input.latestVersionDefaults?.margin_multiplier ??
      1,
    defaultTaxRateBp:
      input.version?.tax_rate_bp ??
      input.latestVersionDefaults?.tax_rate_bp ??
      DEFAULT_TAX_RATE_BP,
    entry: "direct",
    ...input.lineContext,
  });
  if (importRequiresPreview(normalized)) {
    throw badRequest(IMPORT_PREVIEW_REQUIRED_MESSAGE);
  }
  if (normalized.validLines.length === 0) {
    throw badRequest("Aucune ligne DPGF valide à importer depuis la source liée.");
  }
  return normalized;
}

/** The policy expectation is a transaction guard, never a persisted override. */
export function buildEstimateCreationVersionPlan(input: {
  version: VersionOverrides;
  normalizedCurrency: string | undefined;
  linkedDpgfSaleCoefficients: ImportSaleCoefficients | null;
}) {
  const { expected_calc_engine_version: expectedCalcEngineVersion, ...versionOverrides } = input.version ?? {};
  return {
    expectedCalcEngineVersion,
    version: {
      ...versionOverrides,
      ...(input.normalizedCurrency === undefined
        ? {}
        : { currency: input.normalizedCurrency }),
      // Persist the coefficients that actually priced the linked DPGF lines.
      ...(input.linkedDpgfSaleCoefficients
        ? {
            sale_coefficient_fo: input.linkedDpgfSaleCoefficients.fo,
            sale_coefficient_mo: input.linkedDpgfSaleCoefficients.mo,
          }
        : {}),
    },
  };
}
