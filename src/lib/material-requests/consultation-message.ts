import { formatDecimalInput } from "@/lib/numeric-input/parsers";

import type { MaterialRequest, MaterialRequestDeliveryPlace, MaterialRequestLine } from "./contracts";

/**
 * The message the office copies into WhatsApp to ask a supplier for a price (TI-691, lot 2 « l'achat »,
 * delivery 2 « consultation »). MergeOne sends nothing. Two variants, owner's decision:
 *  - with references, for the supplier the lines are bought from: its own reference for the article, so it
 *    finds it at once (the full designation when it is unknown);
 *  - without references, to put other suppliers in competition: the full designation only. No reference of any
 *    kind is written there, neither that supplier's nor our internal one nor the technician's.
 * Short and plain, no empty field. Pure: no network, no clock.
 */

export type ConsultationLine = {
  quantity: number | null;
  unit: string | null;
  /** The line's type words (filled from its article when it has one). */
  designation: string | null;
  dimension: string | null;
  material: string | null;
  /** Precision or standard (EPDM, PN16...). */
  precision: string | null;
  /** The technician's own words: what the line is called when it has no type words. */
  originalText: string | null;
  /** The article's reference at the supplier the message is for. Never written without references. */
  supplierSku: string | null;
};

const DELIVERY: Record<MaterialRequestDeliveryPlace, string> = {
  site: "Livraison : chantier",
  office: "Livraison : bureau",
  counter: "Retrait au comptoir",
};

function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Case, accents and spacing aside: « Coude inox 316L » already says « Inox 316L ». */
function comparable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function name(line: ConsultationLine): string {
  return text(line.designation) ?? text(line.originalText) ?? "Sans désignation";
}

/** The name, then the size, material and precision it does not already say. */
function fullDesignation(line: ConsultationLine): string {
  const head = name(line);
  const said = comparable(head);
  const extras = [line.dimension, line.material, line.precision]
    .map(text)
    .filter((part): part is string => part !== null && !said.includes(comparable(part)));
  return [head, ...extras].join(", ");
}

function quantityOf(line: ConsultationLine): string | null {
  const quantity = line.quantity !== null && line.quantity > 0 ? formatDecimalInput(line.quantity) : null;
  return [quantity, text(line.unit)].filter(Boolean).join(" ") || null;
}

function itemOf(line: ConsultationLine, withReferences: boolean): string {
  const sku = withReferences ? text(line.supplierSku) : null;
  const what = sku ? `${name(line)} — réf. ${sku}` : fullDesignation(line);
  return `- ${[quantityOf(line), what].filter(Boolean).join(" ")}`;
}

/** The lines are written in the order given: the caller passes them in the request's order. */
export function buildConsultationMessage(input: {
  affaireName: string;
  lines: readonly ConsultationLine[];
  withReferences: boolean;
  deliveryPlace: MaterialRequestDeliveryPlace | null;
}): string {
  const affaire = text(input.affaireName);
  const opening = affaire
    ? `Bonjour, pouvez-vous me faire un prix pour l’affaire ${affaire} :`
    : "Bonjour, pouvez-vous me faire un prix :";
  return [
    opening,
    ...input.lines.map((line) => itemOf(line, input.withReferences)),
    ...(input.deliveryPlace ? [DELIVERY[input.deliveryPlace]] : []),
    "Merci !",
  ].join("\n");
}

/**
 * What a request line says to a supplier. Its material is its own, else the sheet's once the office confirmed
 * it, and never for overhead (as the lines table shows it). The reference the technician wrote and the
 * article's internal one are not carried: only the supplier's own reference may be written.
 */
export function consultationLineOf(
  line: MaterialRequestLine,
  context: {
    request: Pick<MaterialRequest, "presumed_material" | "material_confirmed">;
    supplierSku: string | null;
  },
): ConsultationLine {
  const own = text(line.material);
  const presumed =
    line.imputation === "project" && context.request.material_confirmed ? text(context.request.presumed_material) : null;
  return {
    quantity: line.quantity,
    unit: text(line.unit),
    designation: text(line.product_type),
    dimension: text(line.dimension),
    material: own ?? presumed,
    precision: text(line.material_precision),
    originalText: text(line.original_text),
    supplierSku: text(context.supplierSku),
  };
}
