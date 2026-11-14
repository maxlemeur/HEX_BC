/** Current v3 supply projections use one K FO. Historical provision values are retained until an explicit edit. */
import { multiplyToStoredEstimateNumeric } from "@/lib/estimates/stored-item-numeric";
import {
  clearStaleFoPriceOrigin,
  readFoPriceOrigin,
  sameFoPriceOrigin,
  sameFoPriceSelection,
  isTransportSensitiveFoType,
  type FoPriceLine,
} from "@/lib/estimates/fo-price-origin";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import type { EstimateBatchOperationResult } from "@/lib/estimates/client";
import type { Database } from "@/types/database";

/** Provision d'une ligne v3 sans type FO (ou d'un type inconnu du locataire). */
export const DEFAULT_FO_PROVISION = 1.01;

/** Provisions par identifiant de type FO (uuid en minuscules, comme PostgreSQL le rend). */
export type FoProvisionValue =
  | number
  | {
      value: number;
      transportSensitive: boolean;
      unified?: boolean;
      user?: number;
      tube?: boolean;
    };
export type FoProvisionBySupplyTypeId = ReadonlyMap<string, FoProvisionValue>;

/** Nature d'une ligne, lue pour la seule règle POSE SEULE. */
type FoProvisionNature = { line_nature?: string | null };

/**
 * Une ligne POSE SEULE ne prend ni pertes ni transport, même quand elle porte une petite fourniture nécessaire à la
 * pose (réponse de Maxime du 11/11/2026) : sa provision vaut 1 tant qu'elle garde cette nature.
 */
export function deriveFoProvision(
  supplyTypeId: string | null | undefined,
  provisions: FoProvisionBySupplyTypeId,
  origin?: unknown,
  lineNature?: string | null,
): number {
  if (lineNature === "pose_only") return 1;
  const setting = supplyTypeId
    ? provisions.get(supplyTypeId.toLowerCase())
    : undefined;
  if (typeof setting === "object" && setting.unified) return 1;
  if (typeof setting === "object")
    return setting.transportSensitive &&
      readFoPriceOrigin(origin)?.transport_mode === "included"
      ? 1.01
      : setting.value;
  return setting ?? DEFAULT_FO_PROVISION;
}

/** A shared projection of the SQL K FO trigger; the owner is used in SQL and TS alike. */
export function unifiedKfoValue(
  supplyTypeId: string | null | undefined,
  provisions: FoProvisionBySupplyTypeId,
  origin?: unknown,
  lineNature?: string | null,
): number {
  // POSE SEULE may carry small supplies, but its automatic base stays neutral.
  if (lineNature === "pose_only") return 1;
  const setting = supplyTypeId
    ? provisions.get(supplyTypeId.toLowerCase())
    : undefined;
  if (typeof setting !== "object" || !setting.unified) return 1.02;
  if (setting.user !== undefined) return setting.user;
  return readFoPriceOrigin(origin)?.transport_mode === "included" &&
    setting.value === (setting.tube ? 1.13 : 1.02)
    ? setting.tube
      ? 1.1
      : 1
    : setting.value;
}

/** Explicit refresh only touches rows whose automatic mode is known. */
export function automaticKfoRefreshPatches(
  items: readonly { id: string; item_type: string; line_nature?: string | null; k_fo_manual?: boolean | null; supply_type_id?: string | null; fo_price_origin?: unknown }[],
  provisions: FoProvisionBySupplyTypeId,
) {
  return items.filter(item => item.item_type === "line" && item.k_fo_manual === false)
    .map(item => ({ id: item.id, patch: { k_fo: unifiedKfoValue(item.supply_type_id, provisions, item.fo_price_origin, item.line_nature), k_fo_manual: false } }));
}

/** The automatic rows whose stored K FO differs from the current settings: the only ones a refresh changes. */
export function staleAutomaticKfoPatches(
  items: readonly (Parameters<typeof automaticKfoRefreshPatches>[0][number] & { k_fo?: number | null })[],
  provisions: FoProvisionBySupplyTypeId,
) {
  const storedById = new Map(items.map(item => [item.id, item.k_fo]));
  return automaticKfoRefreshPatches(items, provisions).filter(({ id, patch }) => {
    const stored = storedById.get(id);
    return typeof stored !== "number" || Math.abs(stored - patch.k_fo) > 1e-9;
  });
}

export function projectUnifiedKfo<
  T extends {
    supply_type_id?: string | null;
    line_nature?: string | null;
    k_fo?: number | null;
    k_fo_manual?: boolean | null;
    fo_price_origin?: unknown;
  },
>(
  item: T,
  provisions: FoProvisionBySupplyTypeId,
  previous?: FoPriceLine & {
    supply_type_id?: string | null;
    line_nature?: string | null;
    k_fo?: number | null;
    k_fo_manual?: boolean | null;
    fo_provision?: number | null;
  },
): T & { k_fo: number; k_fo_manual: boolean | null; fo_provision: number } {
  if (
    previous &&
    item.k_fo === previous.k_fo &&
    item.k_fo_manual === previous.k_fo_manual &&
    (item.line_nature === "pose_only") === (previous.line_nature === "pose_only") &&
    !supplyTypeChanged(previous.supply_type_id, item.supply_type_id) &&
    sameFoPriceOrigin(previous.fo_price_origin, item.fo_price_origin) &&
    (item as FoPriceLine).unit_price_ht_cents ===
      previous.unit_price_ht_cents &&
    (item as FoPriceLine).product_id === previous.product_id &&
    (item as FoPriceLine).selected_supplier_price_id ===
      previous.selected_supplier_price_id
  ) {
    return {
      ...item,
      k_fo: previous.k_fo ?? 1,
      k_fo_manual: previous.k_fo_manual ?? null,
      fo_provision: previous.fo_provision ?? 1,
    };
  }
  if (previous && previous.k_fo_manual == null && item.k_fo_manual == null) {
    return {
      ...item,
      k_fo: multiplyToStoredEstimateNumeric(item.k_fo ?? 1, previous.fo_provision ?? 1, 6),
      k_fo_manual: true,
      fo_provision: 1,
    };
  }
  const changed = previous && item.k_fo !== previous.k_fo;
  const manual =
    item.k_fo === null
      ? false
      : (item.k_fo_manual ?? (changed ? true : (item.k_fo ?? 1) !== 1));
  return {
    ...item,
    k_fo_manual: manual,
    fo_provision: 1,
    k_fo: manual
      ? (item.k_fo ?? 1)
      : unifiedKfoValue(item.supply_type_id, provisions, item.fo_price_origin, item.line_nature),
  };
}

/** Un changement de type FO, au sens du déclencheur (uuid comparés sans la casse). */
export function supplyTypeChanged(
  previous: string | null | undefined,
  next: string | null | undefined,
): boolean {
  return (previous ?? null)?.toLowerCase() !== (next ?? null)?.toLowerCase();
}

/** Une ligne qui devient POSE SEULE ou qui cesse de l'être : sa provision se redérive, comme dans le déclencheur. */
export function poseOnlyChanged(previous: string | null | undefined, next: string | null | undefined): boolean {
  return (previous === "pose_only") !== (next === "pose_only");
}

/**
 * Miroir local du déclencheur pour une ligne v3 de l'éditeur : un correctif qui change le type FO redérive la
 * provision depuis le type, tout autre correctif garde la provision de la ligne en place (une ligne antérieure garde
 * 1,000), même quand il rétablit un état antérieur (annuler, rétablir) qui portait une autre provision.
 */
export function withRederivedFoProvision<
  T extends FoPriceLine & FoProvisionNature & {
    supply_type_id: string | null;
    fo_provision?: number | null;
    k_fo?: number | null;
    k_fo_manual?: boolean | null;
  },
>(
  previous:
    | (FoPriceLine & FoProvisionNature & {
        supply_type_id: string | null;
        fo_provision?: number | null;
        k_fo?: number | null;
        k_fo_manual?: boolean | null;
      })
    | undefined,
  next: T,
  provisions: FoProvisionBySupplyTypeId,
): T {
  if (!previous) return next;
  next = clearStaleFoPriceOrigin(previous, next);
  if ("k_fo_manual" in previous)
    return projectUnifiedKfo(next, provisions, previous);
  if (
    supplyTypeChanged(previous.supply_type_id, next.supply_type_id) ||
    !sameFoPriceOrigin(previous.fo_price_origin, next.fo_price_origin) ||
    poseOnlyChanged(previous.line_nature, next.line_nature)
  ) {
    return {
      ...next,
      fo_provision: deriveFoProvision(
        next.supply_type_id,
        provisions,
        next.fo_price_origin,
        next.line_nature,
      ),
    };
  }
  return previous.fo_provision === undefined ||
    previous.fo_provision === next.fo_provision
    ? next
    : { ...next, fo_provision: previous.fo_provision };
}

/**
 * Ligne serveur recouverte de ses saisies en attente (brouillon local, rechargement) : une ligne v3 dont elles changent
 * le type FO reprend la provision de ce type, comme l'écriture la redérivera ; toute autre ligne reste telle quelle.
 */
export function withBufferedFoProvision<
  T extends FoPriceLine & FoProvisionNature & { item_type: string; supply_type_id: string | null; fo_provision?: number | null },
>(source: T, merged: T, provisions: FoProvisionBySupplyTypeId, isV3: boolean): T {
  return isV3 && merged.item_type === "line" ? withRederivedFoProvision(source, merged, provisions) : merged;
}

/**
 * Après un lot validé, une ligne de l'éditeur reprend la provision FO que le serveur a stockée tant que son type FO
 * n'a pas changé depuis : la file fusionne les saisies d'une ligne, et un aller-retour de type (Tube → Raccord → Tube)
 * part au serveur sans changement de type, qui garde la provision stockée quand l'éditeur l'avait redérivée en chemin.
 * Rend `items` tel quel quand rien ne change.
 */
export function withServerFoProvisions<
  T extends FoPriceLine & {
    id: string;
    item_type: string;
    supply_type_id: string | null;
    fo_provision?: number | null;
    k_fo?: number | null;
    k_fo_manual?: boolean | null;
  },
>(
  items: T[],
  results: readonly EstimateBatchOperationResult[],
  confirmed = false,
): T[] {
  const stored = new Map(
    results.flatMap((result) => {
      const row = storedFoProvision(result);
      return row ? [[row.id, row] as const] : [];
    }),
  );
  if (stored.size === 0) return items;
  let changed = false;
  const next = items.map((item) => {
    const row = stored.get(item.id);
    const serverKfo =
      item.k_fo_manual === false && row?.k_fo_manual === false
        ? row.k_fo
        : undefined;
    if (
      !row ||
      item.item_type !== "line" ||
      ((serverKfo === undefined || item.k_fo === serverKfo) &&
        item.fo_provision === row.fo_provision &&
        sameFoPriceOrigin(item.fo_price_origin, row.fo_price_origin) &&
        (!confirmed ||
          !supplyTypeChanged(item.supply_type_id, row.supply_type_id))) ||
      (!confirmed &&
        (supplyTypeChanged(item.supply_type_id, row.supply_type_id) ||
          !sameFoPriceSelection(item, row)))
    )
      return item;
    changed = true;
    return {
      ...item,
      ...(serverKfo === undefined ? {} : { k_fo: serverKfo }),
      ...(confirmed ? { supply_type_id: row.supply_type_id } : {}),
      fo_provision: row.fo_provision,
      ...(row.fo_price_origin === undefined
        ? {}
        : { fo_price_origin: row.fo_price_origin }),
    };
  });
  return changed ? next : items;
}

type StoredFoProvision = {
  id: string;
  supply_type_id: string | null;
  fo_provision: number;
  fo_price_origin?: unknown;
  k_fo?: number;
  k_fo_manual?: boolean | null;
};

/** Ligne qu'une mise à jour validée rend (`data.item`, la ligne stockée), réduite à son type et sa provision FO. */
function storedFoProvision(
  result: EstimateBatchOperationResult,
): StoredFoProvision | null {
  if (result.status !== "ok" || result.op !== "update") return null;
  const row = (
    result.data as
      | { item?: Partial<Record<keyof StoredFoProvision, unknown>> | null }
      | undefined
  )?.item;
  const provision = Number(row?.fo_provision ?? (typeof row?.k_fo_manual === "boolean" ? 1 : undefined));
  return row &&
    typeof row.id === "string" &&
    (row.fo_provision != null || typeof row.k_fo_manual === "boolean") &&
    Number.isFinite(provision)
    ? {
        id: row.id,
        supply_type_id:
          typeof row.supply_type_id === "string" ? row.supply_type_id : null,
        fo_provision: provision,
        ...(typeof row.k_fo === "number" && Number.isFinite(row.k_fo)
          ? { k_fo: row.k_fo }
          : {}),
        ...(typeof row.k_fo_manual === "boolean"
          ? { k_fo_manual: row.k_fo_manual }
          : {}),
        fo_price_origin: row.fo_price_origin,
      }
    : null;
}

/** Provisions par type FO (identifiant en minuscules) des types chargés. */
export function foProvisionsBySupplyType(
  supplyTypes: Iterable<{
    id: string;
    default_fo_provision: number | string;
    code?: string | null;
    name?: string | null;
    user_fo_coefficient?: number | null;
  }>,
): Map<string, FoProvisionValue> {
  const provisions = new Map<string, FoProvisionValue>();
  for (const supplyType of supplyTypes)
    provisions.set(
      supplyType.id.toLowerCase(),
      supplyType.code === undefined && supplyType.name === undefined
        ? Number(supplyType.default_fo_provision)
        : {
            value: Number(supplyType.default_fo_provision),
            transportSensitive: isTransportSensitiveFoType(supplyType),
            unified: true,
            user: supplyType.user_fo_coefficient ?? undefined,
            tube: [supplyType.code, supplyType.name].some((value) =>
              /^tubes?$/i.test(value?.trim() ?? ""),
            ),
          },
    );
  return provisions;
}

/** Provisions des types FO cités, lues dans le locataire ; un type absent prend la valeur par défaut. */
export async function loadSupplyTypeFoProvisions(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  supplyTypeIds: Iterable<string | null | undefined>,
  ownerUserId?: string,
): Promise<{
  provisions: Map<string, FoProvisionValue>;
  error: PostgrestError | null;
}> {
  const ids = [
    ...new Set(
      [...supplyTypeIds].filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  ];
  const provisions = new Map<string, FoProvisionValue>();
  if (ids.length === 0) return { provisions, error: null };
  const { data, error } = await supabase
    .from("supply_types")
    .select("id, code, name, default_fo_provision")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (error) return { provisions, error };
  const preferences = ownerUserId
    ? await supabase
        .from("estimate_fo_preferences")
        .select("supply_type_id, coefficient")
        .eq("tenant_id", tenantId)
        .eq("user_id", ownerUserId)
    : { data: [], error: null };
  if (preferences.error) return { provisions, error: preferences.error };
  const user = new Map(
    (preferences.data ?? []).map((row) => [
      row.supply_type_id,
      row.coefficient,
    ]),
  );
  return {
    provisions: foProvisionsBySupplyType(
      (data ?? []).map((row) => ({
        ...row,
        user_fo_coefficient: user.get(row.id),
      })),
    ),
    error: null,
  };
}
