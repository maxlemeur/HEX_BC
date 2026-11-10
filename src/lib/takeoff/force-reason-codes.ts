// TI-686 D10: the coded reasons of an administrator's override, alone. The request schema (schemas.ts, which reaches the
// browser on every takeoff page) needs only them; their labels are in force-reason-labels.ts and the checks in
// force-reasons.ts, which only the apply wizard and the apply route load.

/** The coded reasons of an override, in the guard panel's order (provisional list, pending the business owner's agreement). */
export const FORCE_REASON_CODES = [
  "rule_false_positive",
  "additional_evidence",
  "engineer_or_client_confirmation",
  "controlled_correction",
  "duplicate_resolved",
  "priced_hypothesis",
] as const;

export type ForceReason = (typeof FORCE_REASON_CODES)[number];
