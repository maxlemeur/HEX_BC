// How scripts/run-tester-army-ci.ts reports a failed journey phase (TI-672).
// Its catch used to retain the phase's evidence first: a phase stopped before
// its journeys (a busy port) has none, and that retention error replaced the
// phase's own ("The current phase must retain a fresh manifest…").

/** Journeys that passed but whose evidence could not be retained: the next phase would overwrite it. */
export class EvidenceRetentionError extends Error {
  override name = "EvidenceRetentionError";
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The message of a failed phase and whether the next phase must not run. The
 * phase's own error comes first; a retention failure follows it and stops the
 * campaign, since the next phase would overwrite the unretained output. A
 * phase that never launched its journeys has nothing to retain.
 */
export function failedPhase(input: { error: unknown; launched: boolean; retain: () => void; redact: (text: string) => string }) {
  const own = input.redact(message(input.error));
  if (input.error instanceof EvidenceRetentionError) return { message: own, stop: true };
  if (!input.launched) return { message: own, stop: false };
  try {
    input.retain();
    return { message: own, stop: false };
  } catch (error) {
    return { message: `${own}; its evidence was not retained: ${input.redact(message(error))}`, stop: true };
  }
}

/** The manifest error once the final evidence retention failed: the run's own error, when it had one, stays first. */
export function keepRunError(manifest: { status?: unknown; error?: unknown }, retention: string) {
  return manifest.status === "failed" && typeof manifest.error === "string" && manifest.error
    ? `${manifest.error}; its evidence was not retained: ${retention}`
    : retention;
}
