import { z } from "zod";

import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";

// Coded reasons to accept (V) a failure that V alone does not settle (TI-685 for the network, TI-686 D9 for the scale
// and the printed area). The justification is additive: the flat network part ({reason_code, system_reference}),
// then one key per other rule. The database trigger validate_takeoff_rule_acceptance (migration
// 20261110094500_takeoff_acceptance_reasons.sql) refuses the same values; the route refuses them first, with a message
// the review shows, since a refusal of the database reaches the user as a generic error.
// The reason lists are provisional (H2, pending the owner's agreement): data kept equal to the trigger's lists.

export const VERIFICATION_REASONS = {
  system_documented: "Système et conditions d’emploi documentés",
  gas_pe_buried_outside: "PE gaz enterré à l’extérieur, hors emprise du bâtiment",
  gas_pe_facade_transition: "PE gaz en remontée de façade jusqu’au raccord métal/plastique",
} as const;

const GAS_PE_REASONS: ReadonlySet<string> = new Set(["gas_pe_buried_outside", "gas_pe_facade_transition"]);

export const SCALE_DIMENSION_REASONS = {
  scale_confirmed_by_other_dimensions: "Échelle confirmée par d’autres cotes concordantes de la page",
  dimension_not_to_scale: "Cote contradictoire hors échelle (tronçon interrompu, mention non à l’échelle)",
  quantity_from_dimensions: "Quantité établie d’après les cotes, sans mesure graphique",
  scale_confirmed_by_issuer: "Échelle confirmée par l’émetteur du plan",
} as const;

export const AREA_PRINTED_REASONS = {
  printed_area_basis_identified: "Base de la surface écrite identifiée (légende, cartouche, tableau des surfaces)",
  measured_outline_retained: "Contour mesuré retenu : la surface écrite ne couvre pas le même périmètre",
  confirmed_by_other_document: "Base et surface confirmées par un autre document (CCTP, DPGF, notice)",
  deviation_explained: "Écart expliqué (gaines, trémies, arrondi de l’étiquette)",
} as const;

/** The basis the user recognizes to the printed surface (never the line's own basis, read from its designation). */
export const RETAINED_SURFACE_BASES = {
  net_floor: "Sol net",
  shab: "SHAB",
  other: "Autre base (à préciser dans la note)",
} as const;

export const ACCEPTANCE_NOTE = { min: 10, max: 500 } as const;

const NOTE_BLANKS = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

/**
 * A note as stored and measured: without the ASCII blanks at its ends, the class the trigger removes
 * (regexp_replace '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$'). Not String.prototype.trim, which also removes Unicode blanks.
 */
export function noteText(text: string) {
  return text.replace(NOTE_BLANKS, "");
}

/** Its length in code points, as char_length counts it (not in UTF-16 units). */
export function noteLength(text: string) {
  return [...noteText(text)].length;
}

function validNote(text: string) {
  const length = noteLength(text);
  return length >= ACCEPTANCE_NOTE.min && length <= ACCEPTANCE_NOTE.max;
}

const noteSchema = z.string().overwrite(noteText)
  .refine(validNote, `De ${ACCEPTANCE_NOTE.min} à ${ACCEPTANCE_NOTE.max} caractères.`)
  .meta({ minLength: ACCEPTANCE_NOTE.min, maxLength: ACCEPTANCE_NOTE.max });

const codes = <T extends Record<string, string>>(labels: T) => Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]];

export const networkJustificationSchema = z.object({
  reason_code: z.enum(codes(VERIFICATION_REASONS)),
  system_reference: noteSchema,
}).strict();

export const scaleDimensionJustificationSchema = z.object({
  reason_code: z.enum(codes(SCALE_DIMENSION_REASONS)),
  note: noteSchema,
}).strict();

export const areaPrintedJustificationSchema = z.object({
  reason_code: z.enum(codes(AREA_PRINTED_REASONS)),
  retained_basis: z.enum(codes(RETAINED_SURFACE_BASES)),
  note: noteSchema,
}).strict();

/** What a client writes: each part strict, the network part whole or absent. */
export const verificationJustificationSchema = z.object({
  reason_code: networkJustificationSchema.shape.reason_code.optional(),
  system_reference: noteSchema.optional(),
  scale_dimension: scaleDimensionJustificationSchema.optional(),
  area_printed: areaPrintedJustificationSchema.optional(),
}).strict().refine((value) => (value.reason_code === undefined) === (value.system_reference === undefined), {
  message: "Le motif réseau et la référence du système vont ensemble.",
});

export type VerificationJustification = z.infer<typeof verificationJustificationSchema>;

/**
 * What a read accepts: the known keys, each optional, their texts unbounded. A value the Data API stored beyond the
 * write bounds (a note of 2,000 characters) never makes a job unreadable.
 */
export const verificationJustificationReadSchema = z.object({
  reason_code: z.string().optional(),
  system_reference: z.string().optional(),
  scale_dimension: z.object({ reason_code: z.string().optional(), note: z.string().optional() }).optional(),
  area_printed: z.object({ reason_code: z.string().optional(), retained_basis: z.string().optional(),
    note: z.string().optional() }).optional(),
});

export type VerificationJustificationRead = z.infer<typeof verificationJustificationReadSchema>;

/** The rules whose failure V settles only with a coded reason, in the order the dialog shows them. */
export const ACCEPTANCE_REASON_RULES = ["dn_network", "scale_dimension", "area_printed"] as const;
export type AcceptanceReasonRule = (typeof ACCEPTANCE_REASON_RULES)[number];

function failures(results: readonly TakeoffRuleResult[] | undefined) {
  return (results ?? []).filter((entry) => entry.status === "fail");
}

/**
 * The rule whose reason a failure asks for, or null when V settles it alone. What asks for a reason is the failure's
 * rule or code (never its cause, which the last storage bound drops).
 */
export function acceptanceReasonRule(failure: Pick<TakeoffRuleResult, "rule" | "code">): AcceptanceReasonRule | null {
  if (failure.rule === "dn_network") return "dn_network";
  if (failure.code === "SCALE_DIMENSION_MISMATCH") return "scale_dimension";
  if (failure.code === "AREA_PRINTED_MISMATCH") return "area_printed";
  return null;
}

export function requiredAcceptanceReasons(results: readonly TakeoffRuleResult[] | undefined): AcceptanceReasonRule[] {
  const required = new Set(failures(results).map(acceptanceReasonRule));
  return ACCEPTANCE_REASON_RULES.filter((rule) => required.has(rule));
}

export function requiresAcceptanceReason(results: readonly TakeoffRuleResult[] | undefined) {
  return requiredAcceptanceReasons(results).length > 0;
}

export function requiresGasPeReason(results: readonly TakeoffRuleResult[] | undefined) {
  return failures(results).some((entry) => entry.code === "DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION");
}

/**
 * The printed surface of a printed-area failure and the basis the price line expects (null when unknown). With the
 * same declared basis both surfaces compare, and the higher is retained (D17).
 */
export function printedAreaComparison(results: readonly TakeoffRuleResult[] | undefined) {
  const area = failures(results).find((entry) => entry.code === "AREA_PRINTED_MISMATCH");
  const printed = area?.details?.printed_m2;
  if (!area || typeof printed !== "number" || !Number.isFinite(printed)) return null;
  const expected = area.details?.expected_basis;
  return { printed_m2: printed, expected_basis: expected === "net_floor" || expected === "shab" ? expected : null };
}

/** Whether a quantity is below the printed surface, to the thousandth (quantities are numeric(12,3)). */
export function belowPrintedArea(quantity: number, printed: number) {
  return quantity < printed - 0.0005;
}

const squareMetres = (value: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(value)} m²`;

export const ACCEPTANCE_MESSAGES = {
  stale: "Recalculez les règles avant d’accepter la ligne.",
  notAcceptable: "Cette ligne ne s’accepte pas en relecture. Corrigez-la ou demandez un forçage administrateur.",
  network: "Un motif codé et la référence du système (gamme, fabricant, certificat et conditions d’emploi) sont obligatoires.",
  gasPeRequired: "Le PE gaz exige un motif de pose extérieure hors emprise ou de remontée en façade jusqu’au raccord métal/plastique.",
  gasPeNotApplicable: "Ce motif ne vaut que pour une conduite de gaz en PE.",
  scale: "Une cote de la page contredit l’échelle : un motif codé et ce qui a été vérifié (10 à 500 caractères) sont obligatoires.",
  area: "Une surface écrite s’accepte avec un motif codé, la base de la surface écrite et une note (10 à 500 caractères).",
  belowPrinted: (printed: number) => "Même base que la prestation : les deux surfaces se comparent et la plus élevée est retenue. "
    + `Retenez ${squareMetres(printed)} avant d’accepter.`,
} as const;

/**
 * Same requirements, in the same order, as validate_takeoff_rule_acceptance on a written justification; `quantity` is
 * the line's quantity as stored when V is saved (a quantity raised to the printed surface is saved first).
 */
export function verificationError(results: readonly TakeoffRuleResult[] | undefined, stale: boolean | undefined,
  justification: unknown, quantity: number): string | null {
  if (stale) return ACCEPTANCE_MESSAGES.stale;
  if (results?.some((entry) => entry.status === "fail" && !entry.acceptable)) return ACCEPTANCE_MESSAGES.notAcceptable;
  const required = requiredAcceptanceReasons(results);
  if (required.length === 0) return null;
  const value = (typeof justification === "object" && justification !== null ? justification : {}) as Record<string, unknown>;
  if (required.includes("dn_network")) {
    const network = networkJustificationSchema.safeParse({ reason_code: value.reason_code, system_reference: value.system_reference });
    if (!network.success) return ACCEPTANCE_MESSAGES.network;
    const gasPe = requiresGasPeReason(results);
    if (gasPe && !GAS_PE_REASONS.has(network.data.reason_code)) return ACCEPTANCE_MESSAGES.gasPeRequired;
    if (!gasPe && GAS_PE_REASONS.has(network.data.reason_code)) return ACCEPTANCE_MESSAGES.gasPeNotApplicable;
  }
  if (required.includes("scale_dimension") && !scaleDimensionJustificationSchema.safeParse(value.scale_dimension).success) {
    return ACCEPTANCE_MESSAGES.scale;
  }
  if (required.includes("area_printed")) {
    const area = areaPrintedJustificationSchema.safeParse(value.area_printed);
    if (!area.success) return ACCEPTANCE_MESSAGES.area;
    const comparison = printedAreaComparison(results);
    if (comparison && comparison.expected_basis === area.data.retained_basis && belowPrintedArea(quantity, comparison.printed_m2)) {
      return ACCEPTANCE_MESSAGES.belowPrinted(comparison.printed_m2);
    }
  }
  return null;
}

/** The justification the server stores with V: the reasons of the failures the line has, none other (null: none). */
export function pruneJustification(results: readonly TakeoffRuleResult[] | undefined,
  justification: VerificationJustification | null | undefined): VerificationJustification | null {
  const required = requiredAcceptanceReasons(results);
  if (required.length === 0 || !justification) return null;
  const { reason_code, system_reference, scale_dimension, area_printed } = justification;
  return {
    ...(required.includes("dn_network") && reason_code !== undefined ? { reason_code, system_reference } : {}),
    ...(required.includes("scale_dimension") && scale_dimension ? { scale_dimension } : {}),
    ...(required.includes("area_printed") && area_printed ? { area_printed } : {}),
  };
}
