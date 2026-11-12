import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

import { initialConfirmationDraft } from "./page-decisions";
import { TakeoffPageDecisionsPanel } from "./TakeoffPageDecisionsPanel";

// TI-682 lot D: « Pages déjà au devis » recommends nothing that cannot be confirmed. Read as the estimator sees it: the
// « (recommandé) » of « Remplacer », the introduction, and in the DPGF dead end one sentence for what blocks, then each
// way out on its own line with what it opens. Written before the fix (red on b6038554): the dead end showed « Remplacer
// la mesure précédente (recommandé) » checked under « ni remplacer ni garder les deux ne se confirme ici », and the
// introduction said « remplacez leur mesure précédente ». Fictional identifiers and titles.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const document = { plan_file_id: null, content_hash: null, logical_document_id: null, file_name: "plan.pdf" };
type Page = TakeoffPageReplacementResponse["pages"][number];
type Line = TakeoffPageReplacementResponse["lines"][number];
const page = (lines: number[], newLines: number[], extra: Partial<Page> = {}): Page => ({
  key: "page-1", document, file_name: "plan.pdf", page: 1, earlier_job_ids: [id(9000)],
  lines: lines.map((line) => ({ id: id(line), item_ids: [id(line + 1000)] })), new_line_ids: newLines.map(id),
  dpgf_fed_again: [], ambiguous_document: false, keep_both_refused: null, ...extra,
});
const line = (n: number, title: string, extra: Partial<Line> = {}): Line => ({
  id: id(n), title, unit_key: "u", quantity: 4, measured_quantity: 4, changed_by_hand: false, updated_at: "2026-11-12T10:00:00.000000+00:00",
  unit_price_ht_cents: 1000, dpgf_target: false, assembly: false, outside_pages: false, sources: [{ id: id(n + 1000), quantity: 4 }],
  length_factor: null, ...extra,
});
const newLine = (n: number, designation: string, lineIds: number[], unit = "u") => ({
  id: id(n), designation, unit, quantity: 5, unit_key: unit, candidates: [{ key: "page-1", line_ids: lineIds.map(id) }],
});
const proposal = (extra: Partial<TakeoffPageReplacementResponse>): TakeoffPageReplacementResponse => ({
  job_id: id(1), version_id: id(2), pages: [], lines: [], new_lines: [], pairs: [], jobs: [], unidentified_count: 0, merge_required: false, ...extra,
});
const DPGF = "Réseau de distribution sanitaire EF en tube cuivre DN 22";

const measuredAgain = proposal({ pages: [page([201], [101])], lines: [line(201, "WC suspendu")], new_lines: [newLine(101, "WC suspendu", [201])],
  pairs: [{ takeoff_item_id: id(101), estimate_item_id: id(201), reason: "same_designation", locked: false }] });
const nothingToReplace = proposal({ pages: [page([201], [101])], lines: [line(201, "EF cuivre DN 20", { unit_key: "ml", outside_pages: true })],
  new_lines: [newLine(101, "Vanne d'arrêt", [])] });
const deadEnd = proposal({ merge_required: true, pages: [page([201, 202], [101], { keep_both_refused: "merge_match" })],
  lines: [line(201, "Lavabo double vasque"), line(202, DPGF, { unit_key: "ml", dpgf_target: true, measured_quantity: null })],
  new_lines: [newLine(101, "Lavabo double vasque", [201])],
  pairs: [{ takeoff_item_id: id(101), estimate_item_id: id(201), reason: "merge", locked: true }] });

function show(data: TakeoffPageReplacementResponse) {
  render(<TakeoffPageDecisionsPanel proposal={data} error={null} loading={false} draft={initialConfirmationDraft(data)} strategyNotice={null}
    disabled={false} onDraftChange={() => undefined} />);
  return screen.getByRole("region", { name: "Pages déjà au devis" });
}

describe("« Pages déjà au devis » recommends only what can be confirmed", () => {
  it("keeps « (recommandé) » and both choices in the introduction where the page can be replaced", () => {
    const region = show(measuredAgain);
    expect(within(region).getByRole("radio", { name: "Remplacer la mesure précédente (recommandé)" })).toBeChecked();
    expect(region).toHaveTextContent("Une page n’entre qu’une fois : remplacez leur mesure précédente, ou gardez les deux avec un motif.");
  });

  it("recommends neither replacing nor keeping the vanished line where nothing on the page can be replaced", () => {
    const region = show(nothingToReplace);
    expect(within(region).getByRole("radio", { name: "Remplacer la mesure précédente" })).toBeInTheDocument();
    expect(within(region).queryByRole("radio", { name: /recommandé/ })).toBeNull();
    expect(region).toHaveTextContent("Une page n’entre qu’une fois : gardez les deux avec un motif.");
    expect(region).not.toHaveTextContent(/remplacez leur mesure/);
    expect(within(region).getByRole("group", { name: "Page plan.pdf, page 1" })).toHaveTextContent(
      "Remplacer ne se confirme pas sur cette page : aucune ligne du nouveau métré ne remplace une de ses lignes, et aucune ne peut en être retirée. Gardez les deux mesures avec un motif.");
    expect(region).not.toHaveTextContent(/gardez-la/);
  });

  it("in the DPGF dead end, recommends nothing here, says the rest is done elsewhere, and lists each way out with what it opens", () => {
    const region = show(deadEnd);
    expect(within(region).getByRole("radio", { name: "Remplacer la mesure précédente" })).toBeInTheDocument();
    expect(within(region).queryByRole("radio", { name: /recommandé/ })).toBeNull();
    expect(region).not.toHaveTextContent(/remplacez leur mesure|gardez les deux avec un motif/);
    expect(region).toHaveTextContent("Une page n’entre qu’une fois : aucune ne se confirme ici, la suite se fait hors de cette étape, comme chaque page l’indique.");
    const pageGroup = within(region).getByRole("group", { name: "Page plan.pdf, page 1" });
    expect(pageGroup).toHaveTextContent(`« ${DPGF} » est une ligne DPGF que ce métré n’alimente pas, et la fusion, obligatoire avec un DPGF, met « Lavabo double vasque » sur une ligne de la page : ni remplacer ni garder les deux ne se confirme ici.`);
    const exits = within(pageGroup).getByRole("list", { name: "Pour débloquer plan.pdf, page 1" });
    expect(within(exits).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Écarter « Lavabo double vasque » à la revue du métré : garder les deux redevient possible.",
      "Lier à cette ligne DPGF, dans le rapprochement DPGF, une ligne de ce métré lue sur cette page qui la mesure (même unité, matériau et diamètre) : remplacer redevient possible.",
    ]);
    expect(pageGroup.textContent!.split(`« ${DPGF} »`)).toHaveLength(2);
  });
});
