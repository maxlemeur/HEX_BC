import type { ForceReason } from "@/lib/takeoff/force-reason-codes";

// TI-686 D10: the labels of the override's coded reasons. The guard panel offers them and the estimate's line truth
// names a forced line's reason with them; the estimate editor loads nothing else of the override.

/** Labels pending the business owner's agreement. */
export const FORCE_REASONS = {
  rule_false_positive: "Faux positif de règle",
  additional_evidence: "Preuve complémentaire",
  engineer_or_client_confirmation: "Confirmation BET ou client",
  controlled_correction: "Correction contrôlée",
  duplicate_resolved: "Doublon résolu",
  priced_hypothesis: "Hypothèse chiffrée",
} as const satisfies Record<ForceReason, string>;
