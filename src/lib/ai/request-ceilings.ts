/** Personal API key ceilings. Each caller enforces its category's bound before dispatch. */
export const AI_REQUEST_CEILINGS_NANO_USD = {
  shortQuestion: 100_000_000,
  generationOrDocument: 1_000_000_000,
  assistantMessage: 500_000_000,
  documentBatch: 2_000_000_000,
} as const;
