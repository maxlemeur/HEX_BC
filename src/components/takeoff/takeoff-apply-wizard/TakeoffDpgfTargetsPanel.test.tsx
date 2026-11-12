import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

import { initialConfirmationDraft, resolveConfirmation } from "./page-decisions";
import { TakeoffDpgfTargetsPanel } from "./TakeoffDpgfTargetsPanel";

// TI-682 lot D4: at the confirmation, each DPGF line the application touches, before and after. A line several takeoffs
// feed is shown as such with its composition by takeoff and page, whatever its unit: zone rules see no duplicate count
// of washbasins between an overview and its enlarged plan, the estimator does here. Written before the panel existed.
// Fictional values.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const data: TakeoffPageReplacementResponse = {
  job_id: id(1), version_id: id(2), pages: [], lines: [], new_lines: [], pairs: [], unidentified_count: 0, merge_required: true,
  jobs: [{ id: id(9000), created_at: "2026-11-10T09:00:00.000Z", level: "B", source_file_name: "ensemble.pdf" }],
  dpgf_targets: [{ id: id(300), title: "Lavabo double vasque", unit_key: "u", quantity: 4, reference: 4, length_factor: null,
    earlier: [{ job_id: id(9000), item_ids: [id(101)], quantity: 4, protective: 0, printed_gap: 0, source_file_name: "ensemble.pdf", source_page: 1 }],
    fed: [{ item_id: id(201), quantity: 4, protective: 0, printed_gap: 0, source_file_name: "agrandi.pdf", source_page: 1 }] }],
};

describe("« Lignes DPGF » at the application's confirmation", () => {
  it("shows a count fed by two takeoffs as such, with its composition by takeoff and page", () => {
    render(<TakeoffDpgfTargetsPanel proposal={data} resolution={resolveConfirmation(data, initialConfirmationDraft(data))} />);
    const line = within(screen.getByRole("region", { name: "Lignes DPGF" })).getByRole("group", { name: "Ligne DPGF Lavabo double vasque" });
    expect(line).toHaveTextContent("Lavabo double vasque : 4 → 8 (+4) — alimentée par 2 métrés");
    expect(within(within(line).getByRole("list", { name: "Composition de Lavabo double vasque" })).getAllByRole("listitem")
      .map((item) => item.textContent)).toEqual([
      "Le métré du 10/11/2026 (niveau B) : 4 (ensemble.pdf, page 1 : 4)",
      "Ce métré : 4 (agrandi.pdf, page 1 : 4)",
    ]);
    expect(within(line).queryByRole("status")).toBeNull();
  });
});
