import { describe, expect, it } from "vitest";

import { takeoffApplyReadiness, type TakeoffApplyReadinessInput } from "@/lib/takeoff/apply-readiness";

// The review's panels and readiness bar read one readiness: whether the send dialog may open, whether the admin may
// force guard-blocked lines, and what the review says next. Each case pins what the review showed before this function
// gathered the computation that the page and its panels spread between them.

const READY: TakeoffApplyReadinessInput = {
  jobStatus: "completed",
  includedCount: 3,
  hasDirtyOrSaving: false,
  hasSaveErrors: false,
  hasBlockingAnomalies: false,
  dpgfPending: false,
  dpgfError: false,
  dpgfExceptions: false,
  guardBlockedCount: 0,
  isAdmin: false,
};

describe("takeoffApplyReadiness", () => {
  it("is ready when every condition is met and the guard passes", () => {
    expect(takeoffApplyReadiness(READY)).toEqual({
      state: "ready",
      canOpen: true,
      blockers: [],
      message: "Prêt pour l'envoi au tableau de chiffrage : vérifiez l'aperçu d'impact avant de confirmer.",
      guidance: null,
    });
  });

  it("names the first blocker in the review's order and lists them all", () => {
    const readiness = takeoffApplyReadiness({
      ...READY,
      hasSaveErrors: true,
      dpgfExceptions: true,
      hasDirtyOrSaving: true,
    });
    expect(readiness.state).toBe("blocked");
    expect(readiness.canOpen).toBe(false);
    expect(readiness.blockers).toEqual(["saving", "save_errors", "dpgf_exceptions"]);
    expect(readiness.message).toBe("Attendez la fin des sauvegardes avant l'envoi au tableau de chiffrage.");
  });

  it.each([
    [{ jobStatus: "applied" }, "Ce métré a déjà été appliqué au chiffrage."],
    [{ includedCount: 0 }, "Aucune ligne retenue. Réintégrez au moins une ligne avant l'envoi au tableau de chiffrage."],
    [{ hasSaveErrors: true }, "Corrigez les lignes en erreur avant l'envoi au tableau de chiffrage."],
    [{ hasBlockingAnomalies: true }, "Corrigez les anomalies bloquantes avant l'envoi au tableau de chiffrage."],
    [{ dpgfPending: true }, "Attendez le chargement du rapprochement DPGF avant l'envoi au tableau de chiffrage."],
    [
      { dpgfError: true },
      "Impossible de valider le rapprochement DPGF. Rechargez cette revue avant l'envoi au tableau de chiffrage.",
    ],
    [
      { dpgfExceptions: true },
      "Des rapprochements DPGF restent à trancher. Ouvrez la revue détaillée pour finaliser les liens manuels.",
    ],
  ] satisfies Array<[Partial<TakeoffApplyReadinessInput>, string]>)("blocks %o with its message", (change, message) => {
    const readiness = takeoffApplyReadiness({ ...READY, ...change });
    expect(readiness.state).toBe("blocked");
    expect(readiness.canOpen).toBe(false);
    expect(readiness.message).toBe(message);
  });

  it("blocks a takeoff that is not completed without a message of its own", () => {
    const readiness = takeoffApplyReadiness({ ...READY, jobStatus: "running" });
    expect(readiness).toMatchObject({ state: "blocked", canOpen: false, blockers: [] });
    expect(readiness.message).toBe(takeoffApplyReadiness(READY).message);
  });

  it("keeps the dialog closed to a non-admin while the guard blocks lines", () => {
    expect(takeoffApplyReadiness({ ...READY, guardBlockedCount: 2 })).toEqual({
      state: "blocked",
      canOpen: false,
      blockers: [],
      message:
        "Le contrôle de 2 ligne(s) reste incomplet : complétez les preuves localisées, tranchez les règles en échec ou validez les lignes avant l'application.",
      guidance: null,
    });
  });

  it("lets an admin open the dialog to justify the guard-blocked lines", () => {
    const one = takeoffApplyReadiness({ ...READY, guardBlockedCount: 1, isAdmin: true });
    expect(one).toEqual({
      state: "admin_may_force",
      canOpen: true,
      blockers: [],
      message: "1 ligne reste à trancher. Vous pouvez la traiter dans la revue ciblée ou la justifier à l’envoi.",
      guidance: "1 ligne reste à trancher. Vous pouvez la traiter dans la revue ciblée ou la justifier à l’envoi.",
    });
    expect(takeoffApplyReadiness({ ...READY, guardBlockedCount: 3, isAdmin: true }).guidance).toBe(
      "3 lignes restent à trancher. Vous pouvez les traiter dans la revue ciblée ou les justifier une par une à l’envoi."
    );
  });

  it("keeps the admin's guidance while another blocker keeps the dialog closed", () => {
    const readiness = takeoffApplyReadiness({ ...READY, guardBlockedCount: 2, isAdmin: true, hasDirtyOrSaving: true });
    expect(readiness.state).toBe("admin_may_force");
    expect(readiness.canOpen).toBe(false);
    expect(readiness.message).toBe("Attendez la fin des sauvegardes avant l'envoi au tableau de chiffrage.");
    expect(readiness.guidance).toBe(
      "2 lignes restent à trancher. Vous pouvez les traiter dans la revue ciblée ou les justifier une par une à l’envoi."
    );
  });
});
