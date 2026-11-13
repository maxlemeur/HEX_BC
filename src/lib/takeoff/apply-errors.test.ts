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

  // Codex review of c06cbb1b: on a DPGF version « Fusionner » is required, so « choose Ajouter » was no way out. The
  // refusal names the new line and where the merge put it, and the step reads its proposal again (guard page_decision).
  it("says where « Fusionner » put the new line, and that the proposal is read again", () => {
    const error = page("TAKEOFF_PAGE_REPLACE_CONFLICT", "40001", JSON.stringify({ scope: "page", reason: "merge_elsewhere",
      takeoff_item_id: "00000000-0000-4000-8000-000000000101", estimate_item_id: "00000000-0000-4000-8000-000000000201",
      paired_estimate_item_id: "00000000-0000-4000-8000-000000000202" }));
    expect(error).toMatchObject({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false });
    expect(error.details).toMatchObject({ guard: "page_decision", reason: "merge_elsewhere",
      takeoff_item_id: "00000000-0000-4000-8000-000000000101", estimate_item_id: "00000000-0000-4000-8000-000000000201" });
    expect(error.message).toBe("La fusion rattache une ligne du nouveau métré à une autre ligne de la page que celle choisie. "
      + "La proposition est relue avec le rattachement de la fusion : vérifiez-le puis confirmez. Hors DPGF, « Ajouter » évite la fusion.");
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

// TI-716: a page whose DPGF part cannot be cut (a policy applied before D4, its part per page unknown) is refused
// (dpgf_part_unknown): a quantity nobody can attribute is never removed. The refusal named nothing (it fell back on « Les
// choix des pages déjà au devis sont incomplets »): it now names the DPGF line, the pages its part mixes, the way out
// recommended (those pages read again and replaced together, so that the part leaves whole) and the other (both kept on
// the page, which then counts twice, to correct by hand). Never « reset the line »: it would remove the measures of the
// other pages unseen.
describe("mapApplyTakeoffRpcError, a DPGF part whose share per page is unknown (TI-716)", () => {
  const LINE_ID = "00000000-0000-4000-8000-000000000301";
  const EARLIER = "00000000-0000-4000-8000-000000000901";
  const refusal = (detail: Record<string, unknown>) => mapApplyTakeoffRpcError({ code: "22023", message: "TAKEOFF_PAGE_DECISION_INVALID",
    details: JSON.stringify({ scope: "page", reason: "dpgf_part_unknown", estimate_item_id: LINE_ID, ...detail }), hint: null }, { jobId: JOB_ID });
  const named = { designation: "EF cuivre DN 22", unit: "ml", quantity: 16, fed: true, earlier_job_id: EARLIER };
  const page = (number: number | null, decision: "replace" | "keep_both" | null, file: string | null = "plan-fictif.pdf", fedAgain = decision === "replace") =>
    ({ source_file_name: file, source_page: number, decision, fed_again: fedAgain });

  it("names the line, the pages its part mixes, and recommends reading the other page again to replace them together", () => {
    const error = refusal({ ...named, pages: [page(1, "replace"), page(2, null)] });
    expect(error).toMatchObject({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false, jobId: JOB_ID });
    expect(error.details).toMatchObject({ guard: "page_decision", reason: "dpgf_part_unknown", estimate_item_id: LINE_ID,
      designation: "EF cuivre DN 22", quantity: 16, earlier_job_id: EARLIER });
    expect(error.message).toBe("La ligne DPGF « EF cuivre DN 22 » (16 ml) tient la mesure d’un métré appliqué avant le cumul, "
      + "qui mêle les pages 1 et 2 de « plan-fictif.pdf » sans la part de chacune : elle ne sort pas avec la page 1 de « plan-fictif.pdf » seule. "
      + "Rien n’est appliqué. Recommandé : relancez le métré en lisant aussi la page 2 de « plan-fictif.pdf », puis remplacez ces pages "
      + "ensemble : la mesure précédente sort alors entière. Sinon, gardez les deux mesures de la page 1 de « plan-fictif.pdf » : la page "
      + "comptera deux fois sur cette ligne, à corriger à la main.");
  });

  it("asks to replace a page this takeoff already reads again, and lists every file", () => {
    const error = refusal({ ...named, quantity: 22.6, pages: [page(1, "replace"), page(2, "keep_both"), page(4, null, "plan-b.pdf")] });
    expect(error.message).toContain("(22,6 ml)");
    expect(error.message).toContain("qui mêle les pages 1 et 2 de « plan-fictif.pdf » et la page 4 de « plan-b.pdf » sans la part de chacune");
    expect(error.message).toContain("Recommandé : relancez le métré en lisant aussi la page 4 de « plan-b.pdf », remplacez aussi la page 2 "
      + "de « plan-fictif.pdf », puis remplacez ces pages ensemble");
    const read = refusal({ ...named, pages: [page(1, "replace"), page(2, "keep_both")] });
    expect(read.message).toContain("Recommandé : remplacez aussi la page 2 de « plan-fictif.pdf », puis remplacez ces pages ensemble");
    expect(read.message).not.toContain("relancez");
  });

  it("says where the page's new measure goes when this takeoff does not feed the line, and names several pages replaced", () => {
    const error = refusal({ ...named, fed: false, unit: null, pages: [page(1, "replace", "plan-fictif.pdf", false),
      page(2, "replace", "plan-fictif.pdf", false), page(3, null)] });
    expect(error.message).toContain("(16)");
    expect(error.message).toContain("elle ne sort pas avec les pages 1 et 2 de « plan-fictif.pdf » seules");
    expect(error.message).toContain("Sinon, gardez les deux mesures des pages 1 et 2 de « plan-fictif.pdf » : la ligne garde la mesure "
      + "précédente et leur nouvelle mesure entre ailleurs, ces pages compteront deux fois au devis, à corriger à la main.");
    // Review of the TI-716 diff: the line is fed by this takeoff, but not from the page replaced (per page, not per line).
    const elsewhere = refusal({ ...named, pages: [page(1, "replace", "plan-fictif.pdf", false), page(2, null)] });
    expect(elsewhere.message).toContain("Sinon, gardez les deux mesures de la page 1 de « plan-fictif.pdf » : la ligne garde la mesure "
      + "précédente et sa nouvelle mesure entre ailleurs, la page comptera deux fois au devis, à corriger à la main.");
  });

  it("keeps both ways out when the database does not name the line (a detail written before TI-716)", () => {
    const error = refusal({});
    expect(error.details).toMatchObject({ guard: "page_decision", reason: "dpgf_part_unknown" });
    expect(error.message).toBe("Une ligne DPGF tient la mesure d’un métré appliqué avant le cumul, qui mêle plusieurs pages sans la part "
      + "de chacune : elle ne sort pas avec une seule d’entre elles. Rien n’est appliqué. Recommandé : relancez le métré en lisant aussi "
      + "ses autres pages, puis remplacez ces pages ensemble : la mesure précédente sort alors entière. Sinon, gardez les deux mesures de "
      + "la page : la page comptera deux fois au devis, à corriger à la main.");
  });

  it("never offers to reset the line", () => {
    for (const error of [refusal({}), refusal({ ...named, pages: [page(1, "replace"), page(2, null)] })]) {
      expect(error.message).not.toMatch(/réinitialis|remettre à zéro|vider la ligne/i);
    }
  });
});

// TI-716: « Fusionner » matches a takeoff line to the first line of its title and unit, outside the reconciliation. Sent
// onto a DPGF line the application composes, its measure would be overwritten by the line's sum: the database refuses
// (TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT, merged_outside_reconciliation) and names both lines.
describe("mapApplyTakeoffRpcError, a line « Fusionner » sends onto a DPGF line (TI-716)", () => {
  const conflictOf = (details: string | null) => mapApplyTakeoffRpcError(
    { code: "40001", message: "TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT", details, hint: null }, { jobId: JOB_ID });

  it("names the takeoff line, the DPGF line, and the two ways out", () => {
    const error = conflictOf(JSON.stringify({ reason: "merged_outside_reconciliation", estimate_item_id: "00000000-0000-4000-8000-000000000301",
      dpgf_title: "Réseau EF cuivre DN 22", takeoff_item_id: "00000000-0000-4000-8000-000000000101", designation: "EF cuivre DN 22",
      quantity: 3, unit: "ml", fed: true }));
    expect(error).toMatchObject({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false });
    expect(error.details).toMatchObject({ guard: "dpgf_quantities", reason: "merged_outside_reconciliation",
      takeoff_item_id: "00000000-0000-4000-8000-000000000101" });
    expect(error.message).toBe("La fusion par désignation enverrait « EF cuivre DN 22 » (3 ml) de ce métré sur la ligne DPGF « Réseau EF "
      + "cuivre DN 22 », à laquelle le rapprochement ne la relie pas : la ligne DPGF tient la somme de ce qui l’alimente et effacerait cette "
      + "mesure. Rien n’est appliqué. Reliez cette ligne à la ligne DPGF dans le rapprochement, ou excluez-la à la revue du métré, puis "
      + "appliquez à nouveau.");
  });

  // Review of the TI-716 diff: a line the reconciliation links to another DPGF line, sent onto one whose page this takeoff
  // replaces: it is counted where it is linked, so « relink it here » would be no way out.
  it("does not ask to link a line the reconciliation already links elsewhere", () => {
    const error = conflictOf(JSON.stringify({ reason: "merged_outside_reconciliation", dpgf_title: "EF cuivre DN 22", designation: "EF cuivre DN 22",
      quantity: 3, unit: "ml", fed: false, linked: true }));
    expect(error.message).toBe("La fusion par désignation enverrait « EF cuivre DN 22 » (3 ml) de ce métré, que le rapprochement relie à "
      + "une autre ligne DPGF, aussi sur la ligne DPGF « EF cuivre DN 22 » : la somme de cette ligne effacerait la mesure. Rien n’est "
      + "appliqué. Vérifiez les rattachements DPGF de cette ligne dans le rapprochement, puis appliquez à nouveau.");
  });

  it("keeps the general message without a detail", () => {
    expect(conflictOf(null).message).toBe("Vérifiez les quantités et les rattachements DPGF avant l’application. Une même prestation doit "
      + "conserver une base et un chiffrage cohérents.");
  });

  // TI-723: onto a DPGF line this application neither feeds nor replaces a page of (`composed: false`), the merge would make
  // it an ordinary takeoff line, its DPGF quantity and its composition lost. Written before the message (red on 4915259f:
  // the message said the DPGF line's sum would erase the measure, the reverse of what happens).
  it("names both lines and points to the reconciliation for a DPGF line the application does not compose", () => {
    const error = conflictOf(JSON.stringify({ reason: "merged_outside_reconciliation", estimate_item_id: "00000000-0000-4000-8000-000000000302",
      dpgf_title: "Calorifuge DN 22", dpgf_quantity: 8, dpgf_unit: "ml", takeoff_item_id: "00000000-0000-4000-8000-000000000102",
      designation: "Calorifuge DN 22", quantity: 9, unit: "ml", fed: false, composed: false, linked: false }));
    expect(error).toMatchObject({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false });
    expect(error.details).toMatchObject({ guard: "dpgf_quantities", reason: "merged_outside_reconciliation", composed: false,
      estimate_item_id: "00000000-0000-4000-8000-000000000302", takeoff_item_id: "00000000-0000-4000-8000-000000000102" });
    expect(error.message).toBe("La fusion par désignation enverrait « Calorifuge DN 22 » (9 ml) de ce métré sur la ligne DPGF "
      + "« Calorifuge DN 22 » (8 ml), que ce métré n’alimente pas : la fusion en ferait une ligne de métré ordinaire, sans sa quantité du DPGF "
      + "ni sa composition. Rien n’est appliqué. Reliez cette ligne à la ligne DPGF dans le rapprochement : elle l’alimentera, sa quantité "
      + "du DPGF gardée. Sinon, excluez-la à la revue du métré. Puis appliquez à nouveau.");
  });

  it("asks to check the links of a line the reconciliation links elsewhere, sent onto a DPGF line not composed", () => {
    const error = conflictOf(JSON.stringify({ reason: "merged_outside_reconciliation", dpgf_title: "EF cuivre DN 22", dpgf_quantity: 4,
      dpgf_unit: "ml", designation: "EF cuivre DN 22", quantity: 8, unit: "ml", fed: false, composed: false, linked: true }));
    expect(error.message).toBe("La fusion par désignation enverrait « EF cuivre DN 22 » (8 ml) de ce métré, que le rapprochement relie à "
      + "une autre ligne DPGF, aussi sur la ligne DPGF « EF cuivre DN 22 » (4 ml), que ce métré n’alimente pas : la fusion en ferait une ligne "
      + "de métré ordinaire, sans sa quantité du DPGF ni sa composition. Rien n’est appliqué. Vérifiez les rattachements DPGF de cette "
      + "ligne dans le rapprochement, puis appliquez à nouveau.");
  });

  // Counterexample: a detail written before TI-723 (no `composed`) keeps the TI-716 message, the line being composed.
  it("reads a detail without `composed` as a DPGF line the application composes", () => {
    const error = conflictOf(JSON.stringify({ reason: "merged_outside_reconciliation", dpgf_title: "EF cuivre DN 22", designation: "EF cuivre DN 22",
      quantity: 3, unit: "ml", fed: false, linked: false }));
    expect(error.message).toContain("à laquelle le rapprochement ne la relie pas : la ligne DPGF tient la somme de ce qui l’alimente");
  });
});
