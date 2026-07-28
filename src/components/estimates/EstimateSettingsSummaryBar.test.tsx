import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateSettingsSummaryBar } from "@/components/estimates/EstimateSettingsSummaryBar";
import type { EstimateTotals } from "@/lib/estimate-calculations";

const totals: EstimateTotals = {
  costSubtotalCents: 1_000,
  saleSubtotalBeforeCoefficientCents: 1_000,
  saleSubtotalCents: 1_000,
  discountCents: 100,
  appliedMarginMultiplier: 1.2,
  globalCoefficient: 1,
  discountMode: "simple",
  discountStepTotals: [],
  saleTotalCents: 900,
  taxCents: 180,
  ttcCents: 1_080,
  roundedTtcCents: 1_080,
  roundingAdjustmentCents: 0,
  adjustedTaxCents: 180,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EstimateSettingsSummaryBar", () => {
  it("renders simplified details in a portal and opens their settings section", () => {
    const onOpenSettings = vi.fn();

    render(
      <EstimateSettingsSummaryBar
        totals={totals}
        currency="EUR"
        taxRateBp={2_000}
        isExpert={false}
        onOpenSettings={onOpenSettings}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Voir les details TVA, Remise et TTC",
      }),
    );

    const portal = document.body.querySelector(
      '[data-popover-portal="true"]',
    );
    expect(portal).toBeInTheDocument();
    expect(portal).toHaveTextContent("TVA");
    expect(portal).toHaveTextContent("Remise");
    expect(portal).toHaveTextContent("Total TTC");

    fireEvent.click(
      within(portal as HTMLElement).getByRole("button", { name: /TVA/ }),
    );
    expect(onOpenSettings).toHaveBeenCalledWith("tax");
  });
});
