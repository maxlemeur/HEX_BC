/** Stable public entry point for the email workflow and its recovery commands. */
export type { EstimateEmailDispatch, EstimateEmailDispatchStatus } from "@/lib/email/estimate-email-dispatch-contracts";
export { sha256, canonicalJsonHash } from "@/lib/email/estimate-email-hash";
export {
  findActiveEstimateEmailDispatch,
  findEstimateEmailDispatchByRequest,
  reserveEstimateEmailDispatch,
  prepareEstimateEmailDispatch,
  claimEstimateEmailDispatch,
  completeEstimateEmailDispatch,
  failEstimateEmailDispatch,
  deferEstimateEmailDispatch,
  markEstimateEmailDispatchUnknown,
  reconcileEstimateEmailDispatch,
  listProblematicEstimateEmailDispatches,
  getEstimateEmailDispatchForReconciliation,
} from "@/lib/email/estimate-email-dispatch-repository";
export {
  classifyResendFailure,
  deliverEstimateEmailDispatch,
  downloadFrozenEstimatePdf,
} from "@/lib/email/estimate-email-delivery";
export {
  MAX_ESTIMATE_EMAIL_OUTBOX_ATTEMPTS,
  drainEstimateEmailOutbox,
  type EmailOutboxDrainResult,
} from "@/lib/email/estimate-email-recovery";
