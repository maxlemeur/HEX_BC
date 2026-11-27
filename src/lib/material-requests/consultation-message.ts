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
  /** The linked catalogue article, used to keep distinct articles separate in competition. */
  productId?: string;
  /** The line's type words (filled from its article when it has one). */
  designation: string | null;
  dimension: string | null;
  material: string | null;
  /** Precision or standard (EPDM, PN16...). */
  precision: string | null;
  /** The technician's own words: what the line is called when it has no type words. */
  originalText: string | null;
  /** The reference the technician wrote: stripped from competition messages. */
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

/** The name, then the size, material and precision it does not already say. */
function fullDesignation(line: ConsultationLine, withReferences: boolean) {
  const head = withReferences ? text(line.designation) ?? text(line.originalText) : competitionName(line);
  if (!head && !withReferences) return { head, designation: `Article à préciser (ligne ${line.position})` };
  const said = foldText(head ?? "");
  const details = [line.dimension, line.material, line.precision]
    .map((part) => withReferences ? text(part) : withoutReferences(part, line.reference))
    .filter((part): part is string => part !== null && !said.includes(foldText(part)));
  return { head, designation: [head ?? "Sans désignation", ...details].join(", ") };
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

type ConsultationLineGroup = {
  firstIndex: number;
  count: number;
  quantityThousandths: number;
  usualPackaging: ConsultationLine["usualPackaging"];
};

// The quote comparison accepts requested quantities up to 1,000,000.
const MAX_SUMMED_QUANTITY_THOUSANDTHS = 1_000_000 * 1000;

/** Consolidate the message only. Each item keeps its first line's place and spelling. */
export function sumConsultationLines(lines: readonly ConsultationLine[], withReferences: boolean): ConsultationLine[] {
  const groups = new Map<string, ConsultationLineGroup>();
  const groupOfLine = lines.map((line, index) => {
    if (line.quantity === null) return null;
    const { head, designation } = fullDesignation(line, withReferences);
    if (!head) return null;

    // Stripping references can make different articles look identical.
    const competitionIdentity = withReferences
      ? null
      : line.productId ?? [foldText(fullDesignation(line, true).designation), text(line.reference)];
    const key = JSON.stringify([
      foldText(designation),
      text(line.unit),
      supplierSkuOf(line, withReferences),
      competitionIdentity,
    ]);
    const quantityThousandths = Math.round(line.quantity * 1000);
    const group = groups.get(key);
    if (group) {
      group.count++;
      group.quantityThousandths += quantityThousandths;
      group.usualPackaging = sharedPackaging(group.usualPackaging, line.usualPackaging);
      return group;
    }

    const first = { firstIndex: index, count: 1, quantityThousandths, usualPackaging: line.usualPackaging };
    groups.set(key, first);
    return first;
  });

  return lines.flatMap((line, index) => {
    const group = groupOfLine[index];
    if (!group || group.count === 1 || group.quantityThousandths > MAX_SUMMED_QUANTITY_THOUSANDTHS) return [line];
    if (group.firstIndex !== index) return [];
    return [{ ...line, quantity: group.quantityThousandths / 1000, usualPackaging: group.usualPackaging }];
  });
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
) {
  const quantityNumber = line.quantity !== null && line.quantity > 0 ? formatDecimalInput(line.quantity) : "";
  return {
    quantity: [quantityNumber, text(line.unit)].filter(Boolean).join(" ") || null,
    hasQuantityNumber: quantityNumber !== "",
    designation: fullDesignation(line, withReferences).designation,
    reference: supplierSkuOf(line, withReferences),
  };
}

function itemOf(line: ConsultationLine, withReferences: boolean): string {
  const { quantity, hasQuantityNumber, designation, reference } = consultationLineParts(line, withReferences);
  return `- ${[quantity, hasQuantityNumber && "x", designation, reference && `(réf. ${reference})`].filter(Boolean).join(" ")}`;
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
  ].join("\n");
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
    ...(line.product_id ? { productId: line.product_id } : {}),
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
