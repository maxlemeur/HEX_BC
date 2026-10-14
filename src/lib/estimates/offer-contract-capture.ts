import type { EstimateDocumentPreparedData, EstimateItem } from "@/components/estimate-document/prepare-estimate-document-data";
import { parseClientContractSnapshot, type ClientContract1, type CommercialRow1 } from "@/lib/estimates/offer-contract";

export type CaptureInput = {
  version: ClientContract1["version"];
  project: ClientContract1["project"];
  issuer: ClientContract1["issuer"];
  company: ClientContract1["company"];
  sourceRows: readonly Pick<EstimateItem, "id" | "parent_id" | "position" | "item_type" | "title" | "description" | "quantity">[];
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

function incomplete(): never {
  throw new OfferCaptureError();
}

/** Capture existing rendered sale values once; never run a pricing engine here. */
export function captureOfferClientContract(input: CaptureInput): ClientContract1 {
  const byId = new Map(input.sourceRows.map((entry) => [entry.id, entry]));
  if (byId.size !== input.sourceRows.length) incomplete();
  const children = new Map<string | null, CaptureInput["sourceRows"][number][]>();
  for (const entry of input.sourceRows) {
    if (entry.parent_id !== null && byId.get(entry.parent_id)?.item_type !== "section") incomplete();
    if (entry.item_type === "line" && !input.sourceLineIds.has(entry.id)) incomplete();
    const siblings = children.get(entry.parent_id) ?? [];
    siblings.push(entry);
    children.set(entry.parent_id, siblings);
  }
  // Match the actual preparer's stable sibling order, not a new id-based order.
  for (const siblings of children.values()) siblings.sort((left, right) => left.position - right.position);
  const rows: CommercialRow1[] = [];
  const visited = new Set<string>();
  const showPortions = input.prepared.layout.priceMode === "fo_mo_and_total";
  const walk = (parentId: string | null, depth: number): void => {
    for (const entry of children.get(parentId) ?? []) {
      if (visited.has(entry.id) || depth > 4 || (entry.item_type === "section" && depth > 3)) incomplete();
      visited.add(entry.id);
      const common = { id: entry.id, parentId: entry.parent_id, position: entry.position, depth,
        title: entry.title?.trim() || "Sans titre" };
      if (entry.item_type === "section") {
        if (!Object.hasOwn(input.prepared.sectionTotalsById, entry.id) || !Object.hasOwn(input.prepared.numberingById, entry.id)) incomplete();
        const sale = input.prepared.sectionTotalsById[entry.id];
        rows.push({ kind: "section", ...common, number: input.prepared.numberingById[entry.id], saleHtCents: sale.totalHtCents,
          ...(showPortions ? { foSaleHtCents: sale.foTotalCents, moSaleHtCents: sale.moTotalCents } : {}) });
        walk(entry.id, depth + 1);
      } else {
        if (!Object.hasOwn(input.prepared.lineSplitsById, entry.id) || !Object.hasOwn(input.prepared.lineUnitPriceHtById, entry.id)) incomplete();
        const sale = input.prepared.lineSplitsById[entry.id];
        if (entry.quantity === null) incomplete();
        rows.push({ kind: "line", ...common, quantity: entry.quantity, unit: entry.description?.trim() || "-",
          unitSaleHtCents: input.prepared.lineUnitPriceHtById[entry.id], saleHtCents: sale.totalHtCents,
          ...(showPortions ? { foSaleHtCents: sale.foTotalCents, moSaleHtCents: sale.moTotalCents } : {}) });
      }
    }
  };
  walk(null, 0);
  if (visited.size !== input.sourceRows.length) incomplete();
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
