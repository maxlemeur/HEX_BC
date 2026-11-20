import { isKitSection } from "@/lib/estimates/kit-presentation";
import type { EstimateDocumentPreparedData, EstimateItem } from "@/lib/estimates/prepare-estimate-document-data";
import { parseClientContractSnapshot, type ClientContract1, type CommercialRow1 } from "@/lib/estimates/offer-contract";

export type CaptureInput = {
  version: ClientContract1["version"];
  project: ClientContract1["project"];
  issuer: ClientContract1["issuer"];
  company: ClientContract1["company"];
  sourceRows: readonly (Pick<EstimateItem, "id" | "parent_id" | "position" | "item_type" | "title" | "description" | "quantity"> & { source_metadata?: unknown })[];
  prepared: Pick<EstimateDocumentPreparedData, "layout" | "numberingById" | "sectionTotalsById" | "lineSplitsById" | "lineUnitPriceHtById">;
  /** IDs in the actual resolved breakdown, before preparer's zero placeholders. */
  sourceLineIds: ReadonlySet<string>;
  footer: { totalHtCents: number; actualVatCents: number; amountDueCents: number; roundingAdjustmentCents: number };
  exclusions: string | null;
};

export class OfferCaptureError extends Error {
  readonly code = "OFFER_CAPTURE_SOURCE_INVALID";

  constructor() {
    super("La préparation de la copie commerciale est incomplète.");
    this.name = "OfferCaptureError";
  }
}

export function incomplete(): never {
  throw new OfferCaptureError();
}

type OfferTreeRow = Pick<EstimateItem, "id" | "parent_id" | "position" | "item_type" | "title">;

/**
 * The rows of a commercial offer in the order its document prints them: a section before what it holds, siblings
 * by position (the document preparer's stable order, never an order by id), each with the fields every contract
 * version copies. Refuses a tree no contract can print: two rows with one id, a parent that is not a section,
 * a line the caller has no sale values for, a row nested too deep, a row the root does not reach.
 */
export function orderedOfferRows<Row extends OfferTreeRow>(sourceRows: readonly Row[], hasLineValues: (lineId: string) => boolean) {
  const byId = new Map(sourceRows.map((entry) => [entry.id, entry]));
  if (byId.size !== sourceRows.length) incomplete();
  const children = new Map<string | null, Row[]>();
  for (const entry of sourceRows) {
    if (entry.parent_id !== null && byId.get(entry.parent_id)?.item_type !== "section") incomplete();
    if (entry.item_type === "line" && !hasLineValues(entry.id)) incomplete();
    const siblings = children.get(entry.parent_id) ?? [];
    siblings.push(entry);
    children.set(entry.parent_id, siblings);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.position - right.position);
  const ordered: Array<{ entry: Row; common: { id: string; parentId: string | null; position: number; depth: number; title: string } }> = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number): void => {
    for (const entry of children.get(parentId) ?? []) {
      if (visited.has(entry.id) || depth > 7 || (entry.item_type === "section" && depth > 6)) incomplete();
      visited.add(entry.id);
      ordered.push({ entry, common: { id: entry.id, parentId: entry.parent_id, position: entry.position, depth,
        title: entry.title?.trim() || "Sans titre" } });
      if (entry.item_type === "section") walk(entry.id, depth + 1);
    }
  };
  walk(null, 0);
  if (visited.size !== sourceRows.length) incomplete();
  return ordered;
}

/** Capture existing rendered sale values once; never run a pricing engine here. */
export function captureOfferClientContract(input: CaptureInput): ClientContract1 {
  const showPortions = input.prepared.layout.priceMode === "fo_mo_and_total";
  const rows: CommercialRow1[] = orderedOfferRows(input.sourceRows, (lineId) => input.sourceLineIds.has(lineId)).map(({ entry, common }) => {
    if (entry.item_type === "section") {
      if (!Object.hasOwn(input.prepared.sectionTotalsById, entry.id) || !Object.hasOwn(input.prepared.numberingById, entry.id)) incomplete();
      const sale = input.prepared.sectionTotalsById[entry.id];
      return { kind: "section", ...common, number: input.prepared.numberingById[entry.id], ...(isKitSection(entry) ? { kitMetier: true as const } : {}), saleHtCents: sale.totalHtCents,
        ...(showPortions ? { foSaleHtCents: sale.foTotalCents, moSaleHtCents: sale.moTotalCents } : {}) };
    }
    if (!Object.hasOwn(input.prepared.lineSplitsById, entry.id) || !Object.hasOwn(input.prepared.lineUnitPriceHtById, entry.id)) incomplete();
    const sale = input.prepared.lineSplitsById[entry.id];
    if (entry.quantity === null) incomplete();
    return { kind: "line", ...common, quantity: entry.quantity, unit: entry.description?.trim() || "-",
      unitSaleHtCents: input.prepared.lineUnitPriceHtById[entry.id], saleHtCents: sale.totalHtCents,
      ...(showPortions ? { foSaleHtCents: sale.foTotalCents, moSaleHtCents: sale.moTotalCents } : {}) };
  });
  return parseClientContractSnapshot({
    schemaVersion: 1, version: { ...input.version },
    project: input.project,
    issuer: input.issuer,
    company: input.company, rows,
    totals: { saleHtCents: input.footer.totalHtCents, taxCents: input.footer.actualVatCents,
      calculatedTtcCents: input.footer.amountDueCents - input.footer.roundingAdjustmentCents,
      payableTtcCents: input.footer.amountDueCents, roundingAdjustmentCents: input.footer.roundingAdjustmentCents },
    exclusions: input.exclusions,
  });
}
