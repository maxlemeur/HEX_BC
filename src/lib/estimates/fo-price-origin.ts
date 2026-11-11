/** TI-534: snapshot of the selected supply price, independent of later catalogue changes. */
import { z } from "zod";

const selectionId = z.string().uuid();
const sourceShape = {
  source_id: z.string().uuid(),
  transport_mode: z.enum(["included", "excluded"]).nullable(),
};
/** Free text of a site cost source, as its SQL check reads it: no control character, no space at either end, counted in characters. */
const siteText = (max: number) => z.string().regex(/^[^\x00-\x1f ](?:[^\x00-\x1f]*[^\x00-\x1f ])?$/u)
  .refine(value => [...value].length <= max);
export const SITE_COST_SUPPLIER_MAX = 120;
export const SITE_COST_REFERENCE_MAX = 120;
export const SITE_COST_DOCUMENT_MAX = 200;
/** TI-541: where a supply cost typed for this quote alone comes from. Nothing of it reaches the catalogue. */
export const siteCostSourceSchema = z.object({
  supplier: siteText(SITE_COST_SUPPLIER_MAX),
  offer_reference: siteText(SITE_COST_REFERENCE_MAX).nullable(),
  offer_date: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/),
  document: siteText(SITE_COST_DOCUMENT_MAX).nullable(),
}).strict();
export type SiteCostSource = z.infer<typeof siteCostSourceSchema>;
// Key order is a contract: a parsed origin is written back in the order of its shape, and the browser compares
// the receipt of a save with what it sent as text. Keep `selection_id, kind, source_id, transport_mode[, site]`,
// the order `selectedFoPriceOrigin` and `siteFoPriceOrigin` write.
export const foPriceOriginSchema = z.discriminatedUnion("kind", [
  z.object({ selection_id: selectionId, kind: z.enum(["supplier", "reference"]), ...sourceShape }).strict(),
  // A site cost has no catalogue source: its source id is its own selection.
  z.object({ selection_id: selectionId, kind: z.literal("site"), ...sourceShape, site: siteCostSourceSchema }).strict()
    .refine(origin => origin.source_id === origin.selection_id),
]);
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
/**
 * Manual/reused prices lose the old transport proof even when the product link remains. A site cost (TI-541) is
 * proven by its offer, not by the catalogue: it only falls with its price, and survives a detached or deleted article.
 */
export function clearStaleFoPriceOrigin<T extends FoPriceLine>(previous: FoPriceLine, next: T): T {
  const saved = readFoPriceOrigin(previous.fo_price_origin);
  if (sameFoPriceSelection(previous, next) && saved &&
      (previous.unit_price_ht_cents !== next.unit_price_ht_cents || saved.kind !== "site" &&
       (previous.product_id !== next.product_id || previous.selected_supplier_price_id !== next.selected_supplier_price_id))) {
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

/** TI-541: a supply cost of this quote alone, with its source. The catalogue and its reference price never see it. */
export function siteFoPriceOrigin(input: { supplier: string; offerReference?: string | null; offerDate: string;
  document?: string | null; transportIncluded: boolean | null }): FoPriceOrigin | null {
  const id = crypto.randomUUID();
  const text = (value?: string | null) => value?.trim() || null;
  return readFoPriceOrigin({ selection_id: id, kind: "site", source_id: id,
    transport_mode: input.transportIncluded === null ? null : input.transportIncluded ? "included" : "excluded",
    site: { supplier: input.supplier.trim(), offer_reference: text(input.offerReference), offer_date: input.offerDate,
      document: text(input.document) } });
}
export function readSiteCostSource(origin: unknown): SiteCostSource | null {
  const read = readFoPriceOrigin(origin);
  return read?.kind === "site" ? read.site : null;
}
const frenchDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** « Fournisseur · offre n° · date · pièce », as saved on the line. */
export function siteCostSourceText(origin: unknown): string {
  const site = readSiteCostSource(origin);
  return site ? [site.supplier, site.offer_reference ? `offre ${site.offer_reference}` : null, frenchDate(site.offer_date), site.document]
    .filter(Boolean).join(" · ") : "";
}
/** The base a line's supply cost comes from, in the words shown on the line. */
export function foCostBaseLabel(line: FoPriceLine): "Coût chantier" | "Offre fournisseur" | "Catalogue" | "Saisie manuelle" {
  const kind = readFoPriceOrigin(line.fo_price_origin)?.kind;
  return kind === "site" ? "Coût chantier" : kind === "supplier" || line.selected_supplier_price_id ? "Offre fournisseur"
    : kind === "reference" ? "Catalogue" : "Saisie manuelle";
}
