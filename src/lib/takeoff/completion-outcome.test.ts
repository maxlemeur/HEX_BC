import { expect, it } from "vitest";

import { TAKEOFF_PUBLIC_FAILURE_CODES } from "@/lib/takeoff/completion-outcome";
import { getTakeoffFailureReasonLabel, takeoffCompletionFailureReason } from "@/lib/takeoff/visible-status";

// The database publishes a failure's code to readers who cannot read the job only if it is in this list
// (private.takeoff_public_failure_codes, takeoff-completion-activation-readiness.test.sql asserts the same list).
it("labels in French every code the end of an analysis may publish", () => {
  for (const code of TAKEOFF_PUBLIC_FAILURE_CODES) {
    expect(getTakeoffFailureReasonLabel({ errorCode: code }), code).toEqual(expect.any(String));
  }
});

it("tells the member when the authorised Mac never reported before the ceiling", () => {
  expect(takeoffCompletionFailureReason("TAKEOFF_WORKER_HOST_SILENT")).toBe(
    "L’analyse n’a pas démarré : le poste autorisé ne s’est pas manifesté avant la fin du délai d’attente maximal. "
      + "Vérifiez qu’il est allumé, connecté et que l’application y est ouverte avant de préparer une nouvelle analyse.",
  );
});
