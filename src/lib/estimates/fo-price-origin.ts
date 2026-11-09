/** TI-534: snapshot of the selected supply price, independent of later catalogue changes. */
import { z } from "zod";

export const foPriceOriginSchema = z.object({
  selection_id: z.string().uuid(),
  kind: z.enum(["supplier", "reference"]),
  source_id: z.string().uuid(),
  transport_mode: z.enum(["included", "excluded"]).nullable(),
}).strict();
export type FoPriceOrigin = z.infer<typeof foPriceOriginSchema>;
export function readFoPriceOrigin(value: unknown): FoPriceOrigin | null {
  const result = foPriceOriginSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function sameFoPriceOrigin(left: unknown, right: unknown): boolean {
  return JSON.stringify(readFoPriceOrigin(left)) === JSON.stringify(readFoPriceOrigin(right));
}
export type FoPriceLine = {
  unit_price_ht_cents?: number | null;
  product_id?: string | null;
  selected_supplier_price_id?: string | null;
  fo_price_origin?: unknown;
};
export function sameFoPriceSelection(previous: FoPriceLine, next: FoPriceLine): boolean {
  return readFoPriceOrigin(previous.fo_price_origin)?.selection_id === readFoPriceOrigin(next.fo_price_origin)?.selection_id;
}
/** Manual/reused prices lose the old transport proof even when the product link remains. */
export function clearStaleFoPriceOrigin<T extends FoPriceLine>(previous: FoPriceLine, next: T): T {
  if (sameFoPriceSelection(previous, next) && readFoPriceOrigin(previous.fo_price_origin) &&
      (previous.unit_price_ht_cents !== next.unit_price_ht_cents ||
       previous.product_id !== next.product_id || previous.selected_supplier_price_id !== next.selected_supplier_price_id)) {
    return { ...next, fo_price_origin: null };
  }
  return next;
}

export const isTransportSensitiveFoType = (type: { code?: string | null; name?: string | null }) =>
  [type.code, type.name].some(value => /^(tube|tubes|calorifuge|calorifuges|isolant|isolants)$/.test(value?.trim().toLowerCase() ?? ""));

/** Family matching uses the product's declared type, independently of its material. */
export function catalogueFoTypeId(productType: string | null | undefined,
  types: Iterable<{ id: string; code?: string | null; name: string }>): string | null {
  const key = productType?.trim().toLowerCase().replace(/s$/, "");
  if (!key) return null;
  const all = [...types];
  const normalized = (value?: string | null) => value?.trim().toLowerCase().replace(/s$/, "");
  const exact = all.filter(type => [type.code, type.name].some(value => normalized(value) === key));
  if (exact.length) return exact.length === 1 ? exact[0].id : null;
  const fallback = key === "isolant" ? all.filter(type => [type.code, type.name].some(value => normalized(value) === "calorifuge")) : [];
  return fallback.length === 1 ? fallback[0].id : null;
}

/** Price selection token lets an explicit refresh of the same offer differ from manual price editing. */
export function selectedFoPriceOrigin(input: { price_source?: string; supplier_price_id?: string | null;
  product_id: string; transport_mode?: string | null }): FoPriceOrigin | null {
  const kind = input.supplier_price_id ? "supplier" : input.price_source === "reference" ? "reference" : null;
  return kind ? { selection_id: crypto.randomUUID(), kind,
    source_id: input.supplier_price_id ?? input.product_id,
    transport_mode: input.transport_mode === "included" || input.transport_mode === "excluded" ? input.transport_mode : null } : null;
}

/** Export the saved transport condition, never the current catalogue condition. */
export function foTransportLabel(origin: unknown): string {
  const mode = readFoPriceOrigin(origin)?.transport_mode;
  return mode === "included" ? "Inclus" : mode === "excluded" ? "Hors transport" : "";
}
