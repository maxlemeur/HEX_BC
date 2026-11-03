import "server-only";

import { getOpenAiDecisionsCapability, type OpenAiDecisionsCapability } from "@/lib/ai/decisions";

/**
 * Product opt-in for the takeoff uses of OpenAI Decisions (page triage L4,
 * vector group classes L3). `MERGEONE_TAKEOFF_DECISIONS=1` is required on top
 * of `MERGEONE_OPENAI_DECISIONS=1` and the API key, like
 * `MERGEONE_INTAKE_DECISIONS`: a key configured for another feature never
 * starts new paid takeoff calls. No tenant flag (that would need a migration);
 * each feature keeps its own named token ceiling per run.
 */
export function isTakeoffDecisionsSelected() {
  return process.env.MERGEONE_TAKEOFF_DECISIONS === "1";
}

export function getTakeoffDecisionsCapability(): OpenAiDecisionsCapability {
  const capability = getOpenAiDecisionsCapability();
  return isTakeoffDecisionsSelected()
    ? capability
    : {
        ...capability,
        status: "disabled",
        message: "Decisions n’est pas activé pour le métré. La sélection manuelle des pages reste disponible.",
      };
}
