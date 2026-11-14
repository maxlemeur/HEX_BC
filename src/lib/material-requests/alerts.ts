import { foldText } from "@/lib/text/fold";

import type { MaterialRequest, MaterialRequestLine } from "./contracts";

/**
 * What stands between a line and its validation (TI-690). The office rewrites a technician's request by
 * hand; these rules say, line by line, what is still missing or doubtful. A line with a blocking alert
 * cannot be validated, and it blocks alone: the rest of the request goes on.
 *
 * Nothing here decides for the operator. A material presumed for the whole sheet is a proposal until it
 * is confirmed; a line that names another material keeps it; a possible duplicate is shown, never merged.
 * The server applies the same function before it validates a line.
 */

export type MaterialRequestLineAlertCode =
  | "quantity_missing"
  | "quantity_doubtful"
  | "unit_missing"
  | "type_missing"
  | "dimension_missing"
  | "material_missing"
  | "material_unconfirmed"
  | "material_conflict"
  | "possible_duplicate";

export type MaterialRequestLineAlert = {
  code: MaterialRequestLineAlertCode;
  /** The column to highlight. */
  field: "quantity" | "unit" | "product_type" | "dimension" | "material" | null;
  blocking: boolean;
  message: string;
};

export type AlertContext = {
  request: Pick<MaterialRequest, "presumed_material" | "material_confirmed">;
  /** Every line of the request, the examined one included. */
  lines: readonly MaterialRequestLine[];
};

function text(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function comparable(value: string | null | undefined): string {
  return foldText(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The material a line is ordered in: its own, else the sheet's once the operator has confirmed it.
 * An unconfirmed presumption is not a material.
 */
export function effectiveLineMaterial(
  line: Pick<MaterialRequestLine, "material">,
  request: AlertContext["request"],
): { material: string | null; source: "line" | "presumed" | null } {
  const own = text(line.material);
  if (own) return { material: own, source: "line" };
  const presumed = text(request.presumed_material);
  if (presumed && request.material_confirmed) return { material: presumed, source: "presumed" };
  return { material: null, source: null };
}

/** Same piece, same size, same material, same zone, same imputation: probably written twice. */
function duplicateKey(line: MaterialRequestLine, request: AlertContext["request"]): string | null {
  const type = comparable(line.product_type);
  if (!type) return null;
  return [
    type,
    comparable(line.dimension).replace(/ /g, ""),
    comparable(text(line.material) ?? request.presumed_material),
    comparable(line.zone),
    line.imputation,
  ].join("|");
}

export function materialRequestLineAlerts(
  line: MaterialRequestLine,
  context: AlertContext,
): MaterialRequestLineAlert[] {
  const alerts: MaterialRequestLineAlert[] = [];
  const block = (
    code: MaterialRequestLineAlertCode,
    field: MaterialRequestLineAlert["field"],
    message: string,
  ) => alerts.push({ code, field, blocking: true, message });

  if (line.quantity === null) {
    block("quantity_missing", "quantity", "Quantité à renseigner.");
  } else if (line.quantity_doubtful) {
    block("quantity_doubtful", "quantity", "Quantité à vérifier sur l’original.");
  }
  if (!text(line.unit)) block("unit_missing", "unit", "Unité à renseigner.");
  if (!text(line.product_type)) block("type_missing", "product_type", "Type à renseigner.");
  // A link to an article without size writes « sans dimension » itself (articles-server.ts): a size cleared later is
  // asked again, linked or not.
  if (!text(line.dimension) && !line.no_dimension) {
    block("dimension_missing", "dimension", "Dimension à renseigner, ou indiquer « sans dimension ».");
  }

  // Overhead (PPE, small tooling) is not ordered in the sheet's material.
  if (line.imputation === "project") {
    const own = text(line.material);
    const presumed = text(context.request.presumed_material);
    if (!own && !presumed) {
      block("material_missing", "material", "Matière à renseigner.");
    } else if (!own && presumed && !context.request.material_confirmed) {
      block("material_unconfirmed", "material", `Matière présumée « ${presumed} » à confirmer.`);
    } else if (own && presumed && comparable(own) !== comparable(presumed)) {
      alerts.push({
        code: "material_conflict",
        field: "material",
        blocking: false,
        message: `Diffère de la matière de la demande (« ${presumed} »).`,
      });
    }
  }

  if (!line.duplicate_acknowledged) {
    const key = duplicateKey(line, context.request);
    if (
      key !== null &&
      context.lines.some((other) => other.id !== line.id && duplicateKey(other, context.request) === key)
    ) {
      block("possible_duplicate", null, "Doublon possible : même pièce, même dimension, même zone.");
    }
  }

  return alerts;
}

export function blockingAlertCodes(
  line: MaterialRequestLine,
  context: AlertContext,
): MaterialRequestLineAlertCode[] {
  return materialRequestLineAlerts(line, context)
    .filter((alert) => alert.blocking)
    .map((alert) => alert.code);
}

function formatQuantity(quantity: number): string {
  return String(quantity).replace(".", ",");
}

function lineLabel(line: MaterialRequestLine): string {
  return [text(line.product_type), text(line.dimension)].filter(Boolean).join(" ");
}

/**
 * Only what the technician alone can answer; the office settles unit, type, duplicates and confirmations.
 * A line the office has not named yet is not asked about: a pasted message also yields greetings and notes
 * ("Tous les raccords en inox"), and "combien ?" about those would be nonsense. The office says what the
 * line is, or deletes it, first.
 */
function questionsFor(line: MaterialRequestLine, context: AlertContext): string[] {
  const questions: string[] = [];
  if (!text(line.product_type)) return questions;
  for (const alert of materialRequestLineAlerts(line, context)) {
    if (alert.code === "quantity_missing") questions.push("combien ?");
    if (alert.code === "quantity_doubtful" && line.quantity !== null) {
      questions.push(`c’est bien ${formatQuantity(line.quantity)} ?`);
    }
    if (alert.code === "dimension_missing") questions.push("quelle dimension ?");
    if (alert.code === "material_missing") questions.push("en quelle matière ?");
  }
  return questions;
}

/**
 * The short message the office copies to the technician: human, direct, one line per article.
 * Returns null when there is nothing to ask.
 */
export function buildClarificationMessage(input: {
  technicianName: string | null;
  lines: readonly MaterialRequestLine[];
  context: AlertContext;
}): string | null {
  const asked = [...input.lines]
    .sort((left, right) => left.position - right.position)
    .map((line) => ({ line, questions: questionsFor(line, input.context) }))
    .filter((entry) => entry.questions.length > 0);
  if (asked.length === 0) return null;

  const name = text(input.technicianName);
  const greeting = name ? `Bonjour ${name},` : "Bonjour,";
  const what = asked.length === 1 ? "une précision" : "quelques précisions";
  const body = asked.map(({ line, questions }) => {
    const [first, ...rest] = questions;
    const sentence = [first, ...rest.map((question) => `Et ${question}`)].join(" ");
    return `- ${lineLabel(line)} : ${sentence}`;
  });

  return [`${greeting} il me manque ${what} pour ta demande :`, ...body, "Merci !"].join("\n");
}
