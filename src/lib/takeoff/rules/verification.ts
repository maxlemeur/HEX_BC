import { z } from "zod";

import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";

export const VERIFICATION_REASONS = {
  system_documented: "Système et conditions d’emploi documentés",
  gas_pe_buried_outside: "PE gaz enterré à l’extérieur, hors emprise du bâtiment",
  gas_pe_facade_transition: "PE gaz en remontée de façade jusqu’au raccord métal/plastique",
} as const;

export const verificationJustificationSchema = z.object({
  reason_code: z.enum(["system_documented", "gas_pe_buried_outside", "gas_pe_facade_transition"]),
  system_reference: z.string().trim().min(10).max(500),
}).strict();

export type VerificationJustification = z.infer<typeof verificationJustificationSchema>;

export function requiresTechnicalJustification(results: readonly TakeoffRuleResult[] | undefined) {
  return (results ?? []).some((entry) => entry.status === "fail" && entry.rule === "dn_network");
}

export function requiresGasPeReason(results: readonly TakeoffRuleResult[] | undefined) {
  return (results ?? []).some((entry) => entry.status === "fail" && entry.code === "DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION");
}

/** Same requirements enforced on raw Data API writes by validate_takeoff_rule_acceptance. */
export function verificationError(results: readonly TakeoffRuleResult[] | undefined, stale: boolean | undefined,
  justification: VerificationJustification | null | undefined): string | null {
  if (stale) return "Recalculez les règles avant d’accepter la ligne.";
  if (results?.some((entry) => entry.status === "fail" && !entry.acceptable)) return "Cette ligne ne s’accepte pas en relecture. Corrigez-la ou demandez un forçage administrateur.";
  if (!requiresTechnicalJustification(results)) return null;
  if (!verificationJustificationSchema.safeParse(justification).success) return "Un motif codé et la référence du système (gamme, fabricant, certificat et conditions d’emploi) sont obligatoires.";
  if (requiresGasPeReason(results) && justification?.reason_code === "system_documented") return "Le PE gaz exige un motif de pose extérieure hors emprise ou de remontée en façade jusqu’au raccord métal/plastique.";
  return null;
}
