import type { Database } from "@/types/database";
import type {
  EstimateOutlierFlagsByItemId,
  EstimateOutlierFlagKey,
} from "@/lib/estimates/outlier-detection";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

export const ESTIMATE_QUALITY_FLAG_KEYS = [
  "missing_price",
  "missing_quantity",
  "missing_labor_time",
  "missing_labor_role",
  "supplier_price_outdated",
  "labor_split_incomplete",
  "price_outlier",
  "quantity_outlier",
] as const;

export type EstimateQualityFlagKey = (typeof ESTIMATE_QUALITY_FLAG_KEYS)[number];

export type EstimateQualityFlagMeta = {
  label: string;
  description: string;
};

export const ESTIMATE_QUALITY_FLAG_META: Record<
  EstimateQualityFlagKey,
  EstimateQualityFlagMeta
> = {
  missing_price: {
    label: "Prix manquant",
    description: "Le prix unitaire FO est absent ou egal a 0.",
  },
  missing_quantity: {
    label: "Quantite manquante",
    description: "La quantite est absente ou egale a 0.",
  },
  missing_labor_time: {
    label: "Temps MO manquant",
    description: "Le temps de main d'oeuvre est absent ou egal a 0.",
  },
  missing_labor_role: {
    label: "Role MO manquant",
    description:
      "Un temps MO est saisi mais aucun role de main d'oeuvre n'est selectionne.",
  },
  supplier_price_outdated: {
    label: "Prix fournisseur obsolete",
    description:
      "Le prix fournisseur selectionne est obsolete selon le seuil de fraicheur configure.",
  },
  labor_split_incomplete: {
    label: "Split MO incomplet",
    description:
      "Le split atelier/chantier est incomplet: une seule des deux composantes est renseignee.",
  },
  price_outlier: {
    label: "Prix atypique",
    description:
      "Le prix unitaire est statistiquement atypique par rapport aux autres lignes comparees.",
  },
  quantity_outlier: {
    label: "Quantite atypique",
    description:
      "La quantite est statistiquement atypique par rapport aux autres lignes comparees.",
  },
};

export type EstimateQualityFlagsByItemId = Record<string, EstimateQualityFlagKey[]>;

export type EstimateQualityFlagCounts = {
  linesCount: number;
  linesWithAnomaliesCount: number;
  totalFlagsCount: number;
  byFlag: Record<EstimateQualityFlagKey, number>;
};

function parsePositiveNumber(value: number | null) {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return value ?? 0;
}

type EstimateQualityComputationOptions = {
  outlierFlagsByItemId?: EstimateOutlierFlagsByItemId;
  dismissedOutlierFlagsByItemId?: EstimateOutlierFlagsByItemId;
  staleSupplierPriceItemIds?: ReadonlySet<string>;
  isLaborSplitEnabled?: boolean;
};

function isOutlierFlag(flag: EstimateQualityFlagKey): flag is EstimateOutlierFlagKey {
  return flag === "price_outlier" || flag === "quantity_outlier";
}

function resolveActiveOutlierFlags(input: {
  itemId: string;
  outlierFlagsByItemId?: EstimateOutlierFlagsByItemId;
  dismissedOutlierFlagsByItemId?: EstimateOutlierFlagsByItemId;
}): EstimateOutlierFlagKey[] {
  const detected = input.outlierFlagsByItemId?.[input.itemId] ?? [];
  const dismissed = new Set(
    input.dismissedOutlierFlagsByItemId?.[input.itemId] ?? []
  );

  return detected.filter((flag) => !dismissed.has(flag));
}

function hasLaborSplitPayload(item: EstimateItem) {
  return (
    (item.h_mo_atelier !== null && item.h_mo_atelier !== undefined) ||
    (item.labor_role_atelier_id !== null &&
      item.labor_role_atelier_id !== undefined) ||
    (item.h_mo_chantier !== null && item.h_mo_chantier !== undefined) ||
    (item.labor_role_chantier_id !== null &&
      item.labor_role_chantier_id !== undefined) ||
    ((item.k_mo_atelier ?? 1) !== 1) ||
    ((item.k_mo_chantier ?? 1) !== 1)
  );
}

function hasLaborValue(hours: number, roleId: string | null) {
  return hours > 0 || Boolean(roleId);
}

export function computeEstimateQualityFlagsForItem(
  item: EstimateItem,
  options?: EstimateQualityComputationOptions
): EstimateQualityFlagKey[] {
  if (item.item_type !== "line") return [];

  const flags: EstimateQualityFlagKey[] = [];
  const quantity = parsePositiveNumber(item.quantity);
  const unitPriceHtCents = parsePositiveNumber(item.unit_price_ht_cents);
  const laborHours = parsePositiveNumber(item.h_mo);
  const laborRoleId = item.labor_role_id ?? null;
  const laborHoursAtelier = parsePositiveNumber(item.h_mo_atelier ?? null);
  const laborHoursChantier = parsePositiveNumber(item.h_mo_chantier ?? null);
  const laborRoleAtelierId = item.labor_role_atelier_id ?? null;
  const laborRoleChantierId = item.labor_role_chantier_id ?? null;

  if (unitPriceHtCents <= 0) {
    flags.push("missing_price");
  }
  if (quantity <= 0) {
    flags.push("missing_quantity");
  }
  if (laborHours <= 0) {
    flags.push("missing_labor_time");
  }
  if (laborHours > 0 && !laborRoleId) {
    flags.push("missing_labor_role");
  }

  if (options?.staleSupplierPriceItemIds?.has(item.id)) {
    flags.push("supplier_price_outdated");
  }

  const splitEnabled =
    options?.isLaborSplitEnabled ?? hasLaborSplitPayload(item);
  if (splitEnabled) {
    const hasAtelierValues = hasLaborValue(laborHoursAtelier, laborRoleAtelierId);
    const hasChantierValues = hasLaborValue(
      laborHoursChantier,
      laborRoleChantierId
    );
    if (hasAtelierValues !== hasChantierValues) {
      flags.push("labor_split_incomplete");
    }
  }

  const activeOutlierFlags = resolveActiveOutlierFlags({
    itemId: item.id,
    outlierFlagsByItemId: options?.outlierFlagsByItemId,
    dismissedOutlierFlagsByItemId: options?.dismissedOutlierFlagsByItemId,
  });

  activeOutlierFlags.forEach((flag) => {
    if (isOutlierFlag(flag)) {
      flags.push(flag);
    }
  });

  return flags;
}

export function computeEstimateQualityFlagsByItemId(
  items: EstimateItem[],
  options?: EstimateQualityComputationOptions
): EstimateQualityFlagsByItemId {
  const result: EstimateQualityFlagsByItemId = {};

  items.forEach((item) => {
    if (item.item_type !== "line") return;
    result[item.id] = computeEstimateQualityFlagsForItem(item, options);
  });

  return result;
}

export function countEstimateQualityFlags(
  flagsByItemId: EstimateQualityFlagsByItemId
): EstimateQualityFlagCounts {
  const byFlag = ESTIMATE_QUALITY_FLAG_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: 0 }),
    {} as Record<EstimateQualityFlagKey, number>
  );

  let linesWithAnomaliesCount = 0;
  let totalFlagsCount = 0;

  Object.values(flagsByItemId).forEach((flags) => {
    if (flags.length > 0) {
      linesWithAnomaliesCount += 1;
    }
    flags.forEach((flag) => {
      byFlag[flag] += 1;
      totalFlagsCount += 1;
    });
  });

  return {
    linesCount: Object.keys(flagsByItemId).length,
    linesWithAnomaliesCount,
    totalFlagsCount,
    byFlag,
  };
}
