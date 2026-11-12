import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";

import { DpgfCompositionNote } from "./DpgfCompositionNote";

// TI-682 lot D4: the DPGF reconciliation shows what a line holds of the other takeoffs, by takeoff and page, with the
// total it will hold, and flags a run drawn again in a line it keeps. Written before the note existed. Fictional values.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = {
  line_id: id(3), line_label: "EF cuivre DN 22", takeoff_quantity: 10.2, quantity_unit: "ml",
  dpgf: { estimate_item_id: id(3), title: "EF cuivre DN 22", description: null, quantity: 20, unit: "ml", source_page: 1,
    source_file_name: "dpgf-fictif.xlsx", position: 1 },
  composition: {
    earlier: [{ job_id: id(11), job_created_at: "2026-11-10T09:00:00.000Z", job_level: "B", quantity: 12.4, read_again: false,
      pages: [{ source_file_name: "plan.pdf", source_page: 1, quantity: 12.4 }] }],
    earlier_quantity: 12.4, earlier_protective: 0, earlier_printed_gap: 0, total_quantity: 22.6,
    double_counted: [{ item_id: id(201), partner_item_id: id(101), partner_job_id: id(11), overlap_m: 2.5 }],
  },
} as unknown as TakeoffDpgfComparisonRow;

describe("the composition of a DPGF line in the reconciliation", () => {
  it("names each takeoff it keeps, by page, the total with this one, and a run perhaps counted twice", () => {
    render(<DpgfCompositionNote row={row} />);
    const note = screen.getByRole("group", { name: "Composition de EF cuivre DN 22" });
    expect(note).toHaveTextContent("Alimentée par 2 métrés : total 22,6 ml");
    expect(within(note).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Déjà alimentée par le métré du 10/11/2026 (niveau B) : 12,4 ml (plan.pdf, page 1 : 12,4)",
      "Ce métré : 10,2 ml",
    ]);
    expect(within(note).getByRole("status")).toHaveTextContent("Peut-être compté deux fois, à vérifier : 2,5 m dessinés");
  });

  it("says what the line keeps while its row is decided out of scope (TI-696)", () => {
    // Fed, it would hold 10 (the earlier page read again); out of scope, its lines are skipped and it keeps 12.
    const outOfScope = { ...row, takeoff_quantity: 10, quantity_unit: "u", applied_decision: { decision: "out_of_scope" },
      composition: { ...row.composition!, earlier_quantity: 0, total_quantity: 10, unfed_quantity: 12, unfed_protective: 0,
        double_counted: [] } } as unknown as TakeoffDpgfComparisonRow;
    render(<DpgfCompositionNote row={outOfScope} />);
    expect(screen.getByRole("group", { name: "Composition de EF cuivre DN 22" }))
      .toHaveTextContent("Hors périmètre : tant que ce métré ne l’alimente pas, la ligne garde 12 u des autres métrés ; "
        + "le total ci-dessus est celui qu’elle tiendrait alimentée.");
  });
});
