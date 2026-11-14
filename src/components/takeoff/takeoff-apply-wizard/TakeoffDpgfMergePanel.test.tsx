import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

import { initialConfirmationDraft, resolveConfirmation } from "./page-decisions";
import { TakeoffDpgfMergePanel } from "./TakeoffDpgfMergePanel";

// TI-723: at the application's confirmation, a line « Fusionner » sends onto a DPGF line outside the reconciliation is
// named with that DPGF line before anything is sent, with the way out: the reconciliation, opened from here where the
// wizard knows it. Written before the panel existed. Fictional values.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const data: TakeoffPageReplacementResponse = {
  job_id: id(1), version_id: id(2), pages: [], lines: [], new_lines: [], pairs: [], jobs: [], unidentified_count: 0, merge_required: true,
  dpgf_targets: [], dpgf_merge_refusals: [{ takeoff_item_id: id(401), designation: "Calorifuge DN 22", quantity: 9, unit: "ml",
    estimate_item_id: id(301), title: "Calorifuge DN 22", dpgf_quantity: 8, unit_key: "ml", fed: false, linked: false }],
};
const resolution = resolveConfirmation(data, initialConfirmationDraft(data));

describe("« Fusion sur une ligne DPGF » at the application's confirmation", () => {
  it("names both lines and the way out, and opens the reconciliation", () => {
    const open = vi.fn();
    render(<TakeoffDpgfMergePanel resolution={resolution} dpgfReviewHref="/dashboard/affaires/p/takeoff/j/review?view=dpgf" onOpenDpgfReview={open} />);
    const region = screen.getByRole("region", { name: "Fusion sur une ligne DPGF" });
    expect(within(region).getByRole("status")).toHaveTextContent("« Fusionner » enverrait « Calorifuge DN 22 » (9 ml) de ce métré sur la "
      + "ligne DPGF « Calorifuge DN 22 » (8 ml), que ce métré n’alimente pas.");
    expect(region).toHaveTextContent("Reliez cette ligne à la ligne DPGF dans le rapprochement : elle l’alimentera, sa quantité du DPGF gardée.");
    const link = within(region).getByRole("link", { name: "Ouvrir le rapprochement DPGF" });
    expect(link).toHaveAttribute("href", "/dashboard/affaires/p/takeoff/j/review?view=dpgf");
    // jsdom does not navigate: the click reaches the host's callback, its default navigation held back.
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens the reconciliation through the host when it has no address, and shows nothing without a refusal", () => {
    const open = vi.fn();
    const { rerender } = render(<TakeoffDpgfMergePanel resolution={resolution} onOpenDpgfReview={open} />);
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir le rapprochement DPGF" }));
    expect(open).toHaveBeenCalledTimes(1);
    rerender(<TakeoffDpgfMergePanel resolution={{ merges: [] }} onOpenDpgfReview={open} />);
    expect(screen.queryByRole("region", { name: "Fusion sur une ligne DPGF" })).toBeNull();
  });
});
