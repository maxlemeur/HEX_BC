import { formatDecimalInput } from "@/lib/numeric-input/parsers";

import type { MaterialRequest, MaterialRequestDeliveryPlace, MaterialRequestLine } from "./contracts";

/**
 * The message the office copies into WhatsApp to ask a supplier for a price (TI-691, lot 2 « l'achat »,
 * delivery 2 « consultation »). MergeOne sends nothing. Two variants, owner's decision:
 *  - with references, for the supplier the lines are bought from: its own reference for the article, so it
 *    finds it at once (the full designation when it is unknown);
 *  - without references, to put other suppliers in competition: the full designation only. No reference of any
 *    kind is written there, neither that supplier's nor our internal one nor the technician's, not even inside the
 *    technician's own words (« réf NA-4471 x4 »): a line left with nothing that names an article is written
 *    « Article à préciser (ligne N) », and the screen asks for its type first.
 * Short and plain, no empty field. Pure: no network, no clock.
 */

export type ConsultationLine = {
  /** The line's number in the request, to name a line that needs a type. */
  position: number;
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
  /** The reference the technician wrote: taken out of every word of a competition message. */
  reference: string | null;
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

/**
 * A word for a reference (« réf », « ref. », « Référence : »), and the code after it when it holds a digit
 * (« réf vanne » keeps « vanne »). Not inside another word (« préfabriqué », « réfrigérant »).
 */
const REFERENCE_WORD =
  /(?<![\p{L}\p{N}])r[ée]f(?:[ée]rences?|s)?(?![\p{L}\p{N}])\.?(?:\s*(?:[:=#]|n°))*(?:\s*(?=[\p{L}\p{N}./_-]*\d)[\p{L}\p{N}][\p{L}\p{N}./_-]*)?/giu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The words without any reference: the reference words and their code, and the line's own reference wherever it is. */
function withoutReferences(value: string | null, reference: string | null): string | null {
  let cleaned = text(value);
  if (!cleaned) return null;
  const own = text(reference);
  if (own) {
    cleaned = cleaned.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(own)}(?![\\p{L}\\p{N}])`, "giu"), " ");
  }
  cleaned = cleaned.replace(REFERENCE_WORD, " ").replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "");
  return text(cleaned);
}

/** Something that names an article: a word of two letters at least (« té 50 », not « x4 »). */
const NAMES_SOMETHING = /\p{L}{2,}/u;

/**
 * What a competition message calls the line: its type words, else the technician's words, both without any
 * reference; null when nothing that names an article is left.
 */
function competitionName(line: ConsultationLine): string | null {
  const designation = withoutReferences(line.designation, line.reference);
  if (designation) return designation;
  const words = withoutReferences(line.originalText, line.reference);
  return words && NAMES_SOMETHING.test(words) ? words : null;
}

/** The line cannot be put in competition as it is: it needs type words first. */
export function competitionNeedsType(line: ConsultationLine): boolean {
  return competitionName(line) === null;
}

function competitionDesignation(line: ConsultationLine): string {
  const head = competitionName(line);
  if (!head) return `Article à préciser (ligne ${line.position})`;
  const said = comparable(head);
  const extras = [line.dimension, line.material, line.precision]
    .map((part) => withoutReferences(part, line.reference))
    .filter((part): part is string => part !== null && !said.includes(comparable(part)));
  return [head, ...extras].join(", ");
}

function itemOf(line: ConsultationLine, withReferences: boolean): string {
  const sku = withReferences ? text(line.supplierSku) : null;
  const what = !withReferences
    ? competitionDesignation(line)
    : sku
      ? `${name(line)} — réf. ${sku}`
      : fullDesignation(line);
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
 * it, and never for overhead (as the lines table shows it). The article's internal reference is not carried; the
 * one the technician wrote is, only to be taken out of a competition message.
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
    position: line.position,
    quantity: line.quantity,
    unit: text(line.unit),
    designation: text(line.product_type),
    dimension: text(line.dimension),
    material: own ?? presumed,
    precision: text(line.material_precision),
    originalText: text(line.original_text),
    reference: text(line.reference),
    supplierSku: text(context.supplierSku),
  };
}
