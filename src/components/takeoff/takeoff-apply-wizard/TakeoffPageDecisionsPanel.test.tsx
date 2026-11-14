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
  job_id: id(1), version_id: id(2), pages: [], lines: [], new_lines: [], pairs: [], jobs: [], unidentified_count: 0, merge_required: false, dpgf_targets: [], dpgf_merge_refusals: [], ...extra,
});
const DPGF = "Réseau de distribution sanitaire EF en tube cuivre DN 22";

const measuredAgain = proposal({ pages: [page([201], [101])], lines: [line(201, "WC suspendu")], new_lines: [newLine(101, "WC suspendu", [201])],
  pairs: [{ takeoff_item_id: id(101), estimate_item_id: id(201), reason: "same_designation", locked: false }] });
const nothingToReplace = proposal({ pages: [page([201], [101])], lines: [line(201, "EF cuivre DN 20", { unit_key: "ml", outside_pages: true })],
  new_lines: [newLine(101, "Vanne d'arrêt", [])] });
// TI-682 D4: the DPGF line the earlier takeoff fed from the page (40 ml, DPGF reference 30), not fed again; its run is
// read again but not linked to it. Replacing the page takes its part out: the line falls to its reference.
const falling = proposal({ merge_required: true, pages: [page([201, 202], [101, 102], { keep_both_refused: "merge_match" })],
  lines: [line(201, "Lavabo double vasque"), line(202, DPGF, { unit_key: "ml", dpgf_target: true, measured_quantity: null, quantity: 40,
    length_factor: 1 })],
  new_lines: [newLine(101, "Lavabo double vasque", [201]), newLine(102, "EF cuivre DN 22", [], "ml")],
  pairs: [{ takeoff_item_id: id(101), estimate_item_id: id(201), reason: "merge", locked: true }],
  jobs: [{ id: id(9000), created_at: "2026-11-10T09:00:00.000Z", level: "B", source_file_name: "plan.pdf" }],
  dpgf_targets: [{ id: id(202), title: DPGF, unit_key: "ml", quantity: 40, reference: 30, length_factor: 1,
    earlier: [{ job_id: id(9000), item_ids: [id(1202)], quantity: 40, protective: 0, printed_gap: 0, source_file_name: "plan.pdf", source_page: 1 }],
    fed: [] }] });

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

  it("replaces the page of a DPGF line not fed again, and says on the line that it falls, why, and where the page's measure went", () => {
    const region = show(falling);
    expect(within(region).getByRole("radio", { name: "Remplacer la mesure précédente (recommandé)" })).toBeChecked();
    expect(region).toHaveTextContent("Une page n’entre qu’une fois : remplacez leur mesure précédente.");
    expect(region).not.toHaveTextContent(/ne se confirme ici/);
    expect(region).toHaveTextContent(`${DPGF} : Baisse : 40 → 30 (−10). plan.pdf, page 1 n’alimente plus cette ligne DPGF ; `
      + "sa nouvelle mesure est entrée hors DPGF : « EF cuivre DN 22 » (5 ml).");
  });
});
