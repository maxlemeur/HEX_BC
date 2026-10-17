// Référentiel d'unités et normaliseur partagés (lot 2, D9, P-08, P-09).
// Source unique : src/lib/units/units.json. Le même algorithme de jeton est porté en SQL par
// private.unit_token (migration M3) ; la table public.measurement_unit_aliases est générée depuis
// ce JSON par scripts/units/generate-units-sql.ts. Les normaliseurs privés du métré
// (takeoff/benchmark.ts, takeoff/dpgf-compare.ts, takeoff/processor.ts) restent propres au métré :
// les noms exportés ici évitent la collision.
import unitsSource from "@/lib/units/units.json";

export const ESTIMATE_LINE_PRICING_STATUSES = [
  "priced",
  "included",
  "for_memory",
  "not_priced",
  "out_of_scope",
  "not_applicable",
] as const;

export type EstimateLinePricingStatus = (typeof ESTIMATE_LINE_PRICING_STATUSES)[number];

export const MEASUREMENT_UNIT_DIMENSIONS = [
  "count",
  "set",
  "lump_sum",
  "length",
  "area",
  "volume",
  "mass",
  "time",
  "inch",
] as const;

export type MeasurementUnitDimension = (typeof MEASUREMENT_UNIT_DIMENSIONS)[number];

export type MeasurementUnit = {
  code: string;
  label: string;
  symbol: string;
  dimension: MeasurementUnitDimension;
  sortOrder: number;
  active: boolean;
};

export type MeasurementUnitResolution = {
  unitCode: string | null;
  pricingStatus: EstimateLinePricingStatus | null;
};

export type MeasurementUnitAlias = {
  raw: string;
  token: string;
  unitCode: string | null;
  pricingStatus: EstimateLinePricingStatus | null;
};

export type UnitsSource = {
  version: number;
  units: ReadonlyArray<{
    code: string;
    label: string;
    symbol: string;
    dimension: string;
    sort_order: number;
    active: boolean;
    aliases: readonly string[];
  }>;
  statuses: ReadonlyArray<{
    pricing_status: string;
    label: string;
    aliases: readonly string[];
  }>;
};

export type UnitsReferential = {
  units: readonly MeasurementUnit[];
  aliases: readonly MeasurementUnitAlias[];
  statusLabels: Readonly<Record<EstimateLinePricingStatus, string>>;
};

const UNIT_CODE_PATTERN = /^[a-z][a-z0-9]*$/;
const MILLILITRE_TOKEN_PATTERN = /^millilit/;

/**
 * Jeton d'unité (D9), identique à private.unit_token :
 * NFKD, suppression des diacritiques, ² → 2 et ³ → 3, minuscules ASCII, suppression des
 * espaces, points et tirets. La mise en minuscules ne touche que A-Z : PostgreSQL l'applique
 * sous la collation "C", ce qui rend le résultat indépendant de la collation de la base.
 */
export function measurementUnitToken(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    .replace(/[ \t\n\r\f\v.-]/g, "");
}

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`);
}

function isPricingStatus(value: string): value is EstimateLinePricingStatus {
  return (ESTIMATE_LINE_PRICING_STATUSES as readonly string[]).includes(value);
}

function isDimension(value: string): value is MeasurementUnitDimension {
  return (MEASUREMENT_UNIT_DIMENSIONS as readonly string[]).includes(value);
}

/** Valide le JSON source et en dérive unités, alias (jetons calculés) et libellés de statut. */
export function buildUnitsReferential(source: UnitsSource): UnitsReferential {
  if (source.version !== 1) fail("UNITS_SOURCE_INVALID", `version ${source.version} inconnue`);

  const units: MeasurementUnit[] = [];
  const codes = new Set<string>();
  const sortOrders = new Set<number>();
  for (const unit of source.units) {
    if (!UNIT_CODE_PATTERN.test(unit.code) || unit.code.length > 16) {
      fail("UNITS_SOURCE_INVALID", `code « ${unit.code} » hors format`);
    }
    if (measurementUnitToken(unit.code) !== unit.code) {
      fail("UNITS_SOURCE_INVALID", `le code « ${unit.code} » n'est pas son propre jeton`);
    }
    if (codes.has(unit.code)) fail("UNITS_SOURCE_INVALID", `code « ${unit.code} » en double`);
    if (!isDimension(unit.dimension)) {
      fail("UNITS_SOURCE_INVALID", `dimension « ${unit.dimension} » inconnue`);
    }
    if (!Number.isInteger(unit.sort_order) || unit.sort_order < 0 || sortOrders.has(unit.sort_order)) {
      fail("UNITS_SOURCE_INVALID", `ordre ${unit.sort_order} invalide ou en double`);
    }
    if (unit.label.trim().length === 0 || unit.label.length > 80) {
      fail("UNITS_SOURCE_INVALID", `libellé de « ${unit.code} » invalide`);
    }
    if (unit.symbol.trim().length === 0 || unit.symbol.length > 16) {
      fail("UNITS_SOURCE_INVALID", `symbole de « ${unit.code} » invalide`);
    }
    if (typeof unit.active !== "boolean") {
      fail("UNITS_SOURCE_INVALID", `« ${unit.code} » : active n'est pas booléen`);
    }
    codes.add(unit.code);
    sortOrders.add(unit.sort_order);
    units.push({
      code: unit.code,
      label: unit.label,
      symbol: unit.symbol,
      dimension: unit.dimension,
      sortOrder: unit.sort_order,
      active: unit.active,
    });
  }
  units.sort((left, right) => left.sortOrder - right.sortOrder);

  const statusLabels = {} as Record<EstimateLinePricingStatus, string>;
  for (const status of source.statuses) {
    if (!isPricingStatus(status.pricing_status)) {
      fail("UNITS_SOURCE_INVALID", `statut « ${status.pricing_status} » inconnu`);
    }
    if (Object.hasOwn(statusLabels, status.pricing_status)) {
      fail("UNITS_SOURCE_INVALID", `statut « ${status.pricing_status} » en double`);
    }
    if (status.pricing_status === "priced" && status.aliases.length > 0) {
      fail("UNITS_SOURCE_INVALID", "aucun alias ne vise le statut « priced »");
    }
    statusLabels[status.pricing_status] = status.label;
  }
  for (const status of ESTIMATE_LINE_PRICING_STATUSES) {
    if (!Object.hasOwn(statusLabels, status)) {
      fail("UNITS_SOURCE_INVALID", `statut « ${status} » sans libellé`);
    }
  }

  const aliases: MeasurementUnitAlias[] = [];
  const raws = new Set<string>();
  const targets = new Map<string, string>();
  const addAlias = (
    raw: string,
    unitCode: string | null,
    pricingStatus: EstimateLinePricingStatus | null
  ) => {
    const token = measurementUnitToken(raw);
    const target = unitCode ?? `statut ${pricingStatus}`;
    if (token.length === 0 || token.length > 64) {
      fail("UNITS_SOURCE_INVALID", `alias « ${raw} » : jeton vide ou trop long`);
    }
    if (MILLILITRE_TOKEN_PATTERN.test(token)) {
      fail("UNITS_MILLILITRE_FORBIDDEN", `« ${raw} » : le millilitre n'est pas au référentiel (P-08)`);
    }
    const existing = targets.get(token);
    if (existing !== undefined && existing !== target) {
      fail("UNITS_ALIAS_CONFLICT", `« ${raw} » (${token}) vise ${existing} et ${target}`);
    }
    if (raws.has(raw)) fail("UNITS_ALIAS_DUPLICATE", `alias « ${raw} » en double`);
    raws.add(raw);
    targets.set(token, target);
    aliases.push({ raw, token, unitCode, pricingStatus });
  };
  for (const unit of units) {
    const sourceUnit = source.units.find((candidate) => candidate.code === unit.code);
    addAlias(unit.code, unit.code, null);
    for (const raw of sourceUnit?.aliases ?? []) addAlias(raw, unit.code, null);
  }
  for (const status of source.statuses) {
    for (const raw of status.aliases) {
      addAlias(raw, null, status.pricing_status as EstimateLinePricingStatus);
    }
  }

  return { units, aliases, statusLabels };
}

const REFERENTIAL = buildUnitsReferential(unitsSource);
const ACTIVE_UNIT_CODES = new Set(
  REFERENTIAL.units.filter((unit) => unit.active).map((unit) => unit.code)
);
const RESOLUTION_BY_TOKEN = new Map<string, MeasurementUnitResolution>();
for (const alias of REFERENTIAL.aliases) {
  if (alias.unitCode !== null && !ACTIVE_UNIT_CODES.has(alias.unitCode)) continue;
  RESOLUTION_BY_TOKEN.set(alias.token, {
    unitCode: alias.unitCode,
    pricingStatus: alias.pricingStatus,
  });
}

export const MEASUREMENT_UNITS: readonly MeasurementUnit[] = REFERENTIAL.units;
export const ESTIMATE_LINE_PRICING_STATUS_LABELS = REFERENTIAL.statusLabels;

/**
 * Résout une saisie d'unité (colonne « Unité » d'un DPGF, d'un classeur OPTIMA ou de l'éditeur)
 * en code d'unité active ou en statut de ligne ; identique à private.normalize_unit.
 * Une saisie nulle, vide ou inconnue ne donne ni unité ni statut : jamais d'unité par défaut.
 */
export function normalizeMeasurementUnit(
  raw: string | null | undefined
): MeasurementUnitResolution {
  if (typeof raw !== "string") return { unitCode: null, pricingStatus: null };
  const resolution = RESOLUTION_BY_TOKEN.get(measurementUnitToken(raw));
  return resolution ? { ...resolution } : { unitCode: null, pricingStatus: null };
}
