import { formatDecimalInput } from "@/lib/numeric-input/parsers";
import { foldText } from "@/lib/text/fold";

import type { MaterialRequest, MaterialRequestDeliveryPlace, MaterialRequestLine } from "./contracts";
import type { MaterialRequestUsualPackaging } from "./usual-packaging";

/**
 * The message the office copies into WhatsApp to ask a supplier for a price (TI-691, lot 2 « l'achat »,
 * delivery 2 « consultation »). MergeOne sends nothing. Two variants, owner's decision:
 *  - with references, for the supplier the lines are bought from: the full designation and its own reference
 *    for the article when known;
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
  /** The reference the technician wrote: removed from fallback wording and from competition messages. */
  reference: string | null;
  /** The article's reference at the supplier the message is for. Never written without references. */
  supplierSku: string | null;
  /**
   * The usual packaging of the line's article (TI-690), whatever its unit: only a template's {conditionnement} reads
   * it (usual-packaging.ts decides whether it applies). Today's message never writes it.
   */
  usualPackaging?: MaterialRequestUsualPackaging | null;
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

function supplierDesignationName(line: ConsultationLine): string | null {
  const designation = text(line.designation);
  if (designation) return designation;
  const original = text(line.originalText);
  if (!text(line.reference)) return original;
  const words = withoutReferences(original, line.reference);
  return words && (words === original || NAMES_SOMETHING.test(words)) ? words : null;
}

function designationParts(line: ConsultationLine, withReferences: boolean) {
  return {
    head: withReferences ? supplierDesignationName(line) : competitionName(line),
    details: [line.dimension, line.material, line.precision]
      .map((part) => withReferences ? text(part) : withoutReferences(part, line.reference)),
  };
}

/** The name, then the size, material and precision it does not already say. */
function fullDesignation(line: ConsultationLine, withReferences: boolean): string {
  const { head, details } = designationParts(line, withReferences);
  if (!head && !withReferences) return `Article à préciser (ligne ${line.position})`;
  const said = foldText(head ?? "");
  const extras = details.filter((part): part is string => part !== null && !said.includes(foldText(part)));
  return [head ?? "Sans désignation", ...extras].join(", ");
}

function supplierSkuOf(line: ConsultationLine, withReferences: boolean): string | null {
  return withReferences ? text(line.supplierSku) : null;
}

function sharedPackaging(
  first: MaterialRequestUsualPackaging | null | undefined,
  next: MaterialRequestUsualPackaging | null | undefined,
): MaterialRequestUsualPackaging | null {
  return first && next && first.label === next.label && first.quantity === next.quantity && first.unit === next.unit
    ? first
    : null;
}

/** Consolidate the message only. Each item keeps its first line's place and spelling. */
export function sumConsultationLines(lines: readonly ConsultationLine[], withReferences: boolean): ConsultationLine[] {
  const items: ConsultationLine[] = [];
  const byDesignation = new Map<string, number>();
  for (const line of lines) {
    const { head, details } = designationParts(line, withReferences);
    if (!head) {
      items.push(line);
      continue;
    }
    const key = JSON.stringify([
      foldText(head),
      ...details.map((part) => part === null ? null : foldText(part)),
      text(line.unit),
      supplierSkuOf(line, withReferences),
    ]);
    const index = byDesignation.get(key);
    if (index === undefined) {
      byDesignation.set(key, items.length);
      items.push(line);
      continue;
    }
    const first = items[index];
    // Sum exact thousandths. A missing quantity makes the total unknown.
    const quantity = first.quantity === null || line.quantity === null
      ? null
      : (Math.round(first.quantity * 1000) + Math.round(line.quantity * 1000)) / 1000;
    items[index] = { ...first, quantity, usualPackaging: sharedPackaging(first.usualPackaging, line.usualPackaging) };
  }
  return items;
}

/** What a delivery place says in the message, or null when it is unknown. */
export function consultationDeliveryText(place: MaterialRequestDeliveryPlace | null): string | null {
  return place ? DELIVERY[place] : null;
}

/** A name as the message writes it: spaces folded, null when blank. */
export function consultationText(value: string | null | undefined): string | null {
  return text(value);
}

/** The fields available to the default message and to templates. Competition fields have no reference. */
export function consultationLineParts(
  line: ConsultationLine,
  withReferences: boolean,
): { quantity: string | null; designation: string; reference: string | null } {
  return {
    quantity: quantityOf(line),
    designation: fullDesignation(line, withReferences),
    reference: supplierSkuOf(line, withReferences),
  };
}

function itemOf(line: ConsultationLine, withReferences: boolean): string {
  const { quantity, designation, reference } = consultationLineParts(line, withReferences);
  return `- ${[quantity, designation, reference && `(réf. ${reference})`].filter(Boolean).join(" ")}`;
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
    ...sumConsultationLines(input.lines, input.withReferences).map((line) => itemOf(line, input.withReferences)),
    ...(input.deliveryPlace ? [DELIVERY[input.deliveryPlace]] : []),
    "Merci !",
  ].join("\n").replaceAll("—", "–");
}

/**
 * What a request line says to a supplier. Its material is its own, else the sheet's once the office confirmed
 * it, and never for overhead (as the lines table shows it). The article's internal reference is not carried; the
 * one the technician wrote is carried for reference stripping.
 */
export function consultationLineOf(
  line: MaterialRequestLine,
  context: {
    request: Pick<MaterialRequest, "presumed_material" | "material_confirmed">;
    supplierSku: string | null;
    /** The usual packaging of the line's article, when it has one. */
    usualPackaging?: MaterialRequestUsualPackaging | null;
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
    supplierSku: line.product_id ? text(context.supplierSku) : null,
    ...(context.usualPackaging ? { usualPackaging: context.usualPackaging } : {}),
  };
}
