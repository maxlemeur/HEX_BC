import { describe, expect, it } from "vitest";

import { mapApplyTakeoffRpcError } from "@/lib/takeoff/apply-errors";
import { TakeoffErrorCode } from "@/lib/takeoff/errors";

// TI-682 lot B (D11): the refusal of private.assert_takeoff_single_quantity_source, as the route answers it. Ways it
// fails: the page conflict answers a server error, or a message that names no page; a detail the guard did not write
// (an older database, an unreadable text) breaks the answer instead of keeping the paired message.

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const conflict = (details: string | null) => mapApplyTakeoffRpcError(
  { code: "23514", message: "TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT", details, hint: null }, { jobId: JOB_ID });

describe("mapApplyTakeoffRpcError, alternative sources", () => {
  it("refuses both readings of one page with a 422 that names the page and what may stay beside a measure", () => {
    const error = conflict('{"scope": "page", "dimension": "length", "source_page": 3, "source_file_name": "plan-fictif.pdf"}');
    expect(error).toMatchObject({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false, jobId: JOB_ID });
    expect(error.message).toBe("Une mesure vectorielle et une ligne lue sur le plan de la page 3 de « plan-fictif.pdf » sont retenues ensemble. "
      + "Conservez une seule lecture par page : excluez l’une des deux dans la revue. "
      + "Seuls un comptage ou une mesure d’une autre nature, dans une unité connue, restent à côté d’une mesure.");
    expect(error.details).toMatchObject({ guard: "quantity_sources", scope: "page", dimension: "length", source_page: 3,
      source_file_name: "plan-fictif.pdf" });
  });

  it("names what the guard named, and nothing more", () => {
    expect(conflict('{"scope": "page", "source_page": null, "source_file_name": null}').message)
      .toContain("une ligne lue sur le plan d’une même page sont retenues ensemble");
  });

  it.each([
    ["two readings the worker paired", '{"scope": "group"}'],
    ["a guard that says nothing", null],
    ["a detail that is no JSON", "conflit"],
    ["a scope it does not know", '{"scope": "level"}'],
  ])("keeps the paired message for %s", (_label, details) => {
    const error = conflict(details);
    expect(error).toMatchObject({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED });
    expect(error.message).toBe("Deux lectures alternatives sont retenues pour la même quantité. Conservez une seule source par poste ou zone.");
    expect(error.details).toMatchObject({ guard: "quantity_sources" });
  });
});

// TI-682 lot D, PR 2: a page another takeoff already brought enters only by a decision (private.assert_takeoff_pages_once
// and the decisions the step records). Each refusal names the page and says what to do; a stale decision is read again.
describe("mapApplyTakeoffRpcError, a page already in the estimate", () => {
  const page = (code: string, state: string, details: string | null) =>
    mapApplyTakeoffRpcError({ code: state, message: code, details, hint: null }, { jobId: JOB_ID });
  const named = '{"scope": "page", "reason": "page_already_applied", "source_page": 2, "source_file_name": "plan-fictif.pdf",'
    + ' "earlier_job_ids": ["11111111-1111-4111-8111-111111111111"], "line_count": 3}';

  it("refuses a page applied again without a decision with a 422 that names it and the step to decide in", () => {
    const error = page("TAKEOFF_PAGE_ALREADY_APPLIED", "23514", named);
    expect(error).toMatchObject({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false });
    expect(error.message).toBe("La page 2 de « plan-fictif.pdf » est déjà au devis par un autre métré (3 lignes). "
      + "Choisissez à l’étape « Pages déjà au devis » de remplacer sa mesure ou de garder les deux.");
    expect(error.details).toMatchObject({ guard: "page_already_applied", source_page: 2, line_count: 3,
      earlier_job_ids: ["11111111-1111-4111-8111-111111111111"] });
  });

  it("asks to read the pages again when the estimate changed since the decision (409, retryable)", () => {
    for (const code of ["TAKEOFF_PAGE_DECISION_STALE"]) {
      const error = page(code, "40001", '{"scope": "page", "reason": "line_changed", "source_page": 1, "source_file_name": "plan.pdf"}');
      expect(error).toMatchObject({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: true });
      expect(error.details).toMatchObject({ guard: "page_decision" });
      expect(error.message).toContain("Le devis a changé depuis la proposition");
    }
  });

  it("says « Fusionner » sends a line elsewhere than its pair: a choice, not a change to read again", () => {
    const error = page("TAKEOFF_PAGE_REPLACE_CONFLICT", "40001", '{"scope": "page", "estimate_item_id": "x"}');
    expect(error).toMatchObject({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false });
    expect(error.message).toContain("« Fusionner » rattache une ligne du nouveau métré à une autre ligne que celle choisie");
  });

  it.each([
    ["remove_other_pages", "porte aussi d’autres pages"],
    ["assembly_line", "ouvrage"],
    ["nothing_replaced", "Rien n’est remplacé"],
    ["dpgf_not_replaced", "n’est pas alimentée par ce métré"],
    ["take_required", "Une quantité de ligne a été modifiée à la main"],
    ["dpgf_keep_both", "Garder les deux mesures n’est pas possible sur une page qui alimente une ligne DPGF"],
    ["ambiguous_document", "deux plans de même nom"],
    ["unit_mismatch", "même unité"],
    ["strategy_replace", "« Remplacer la section »"],
    ["shape", "Les choix des pages déjà au devis sont incomplets"],
  ])("says why a decision is invalid: %s", (reason, text) => {
    const error = page("TAKEOFF_PAGE_DECISION_INVALID", "22023", JSON.stringify({ scope: "page", reason }));
    expect(error).toMatchObject({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false });
    expect(error.details).toMatchObject({ guard: "page_decision", reason });
    expect(error.message).toContain(text);
  });

  it("says a decision of an applied takeoff is frozen", () => {
    expect(page("TAKEOFF_PAGE_DECISIONS_FROZEN", "55000", null)).toMatchObject({ status: 409, code: TakeoffErrorCode.CONFLICT });
  });
});
