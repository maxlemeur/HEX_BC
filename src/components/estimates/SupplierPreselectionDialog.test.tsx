import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupplierPreselectionDialog } from "@/components/estimates/SupplierPreselectionDialog";
import type {
  EstimateSupplierComparisonAlternativeContract,
  EstimateSupplierPreselectionReview,
} from "@/lib/estimates/supplier-preselection";
import { formatCurrency } from "@/lib/money";

// Second review of 2.9. Isolation exception: the dialog shows the current offer of a line written in
// bars; a converted bar (262,45 € for 3 ml) must read 262,45 €, not its 87,48 € per metre. The
// preselection journey of the E2E campaign has no converted offer on a line in bars.
const LINE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function alternative(overrides: Partial<EstimateSupplierComparisonAlternativeContract>): EstimateSupplierComparisonAlternativeContract {
  return {
    kind: "selected_current", supplier_price_id: "11111111-1111-4111-8111-111111111111",
    supplier_id: "22222222-2222-4222-8222-222222222222", supplier_name: "Fonte A", adjusted_unit_price_cents: 8748,
    currency: "EUR", supplier_reference: null, catalogue_url: null, updated_at: null, is_stale: false,
    product_designation: "Tube fonte", is_selected: true, unit: "barre", unit_price_cents: 26245,
    estimate_unit_code: "ml", estimate_units_per_purchase_unit: 3, purchase_rounding: "ceil", ...overrides,
  };
}

afterEach(cleanup);

describe("SupplierPreselectionDialog and converted offers", () => {
  it("shows the bar price of the current offer on a line written in bars", () => {
    const current = alternative({});
    const review = {
      summary: { total_items: 2, proposed_items: 1, exception_items: 1, already_selected_items: 0, divergence_items: 1,
        stale_items: 0, ambiguous_items: 0, no_price_items: 0, currency_mismatch_items: 0 },
      proposals: [{ item_id: LINE_ID, item_title: "Fonte en barres", item_unit: "barre", current_alternative: current,
        proposed_alternative: alternative({ kind: "best_price", supplier_price_id: "33333333-3333-4333-8333-333333333333",
          supplier_name: "Fonte B", adjusted_unit_price_cents: 8000, unit_price_cents: 24000, is_selected: false }),
        patch: { unit_price_ht_cents: 24000, selected_supplier_price_id: "33333333-3333-4333-8333-333333333333" },
        reason: "single_clear_option", explanation: "Une seule option.", is_reversible: true }],
      exceptions: [{ item_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", item_title: "Autre fonte en barres", item_unit: "barre",
        reason: "divergence", coverage_status: "covered", risk_flags: [], selected_alternative: current, alternatives: [current] }],
    } as unknown as EstimateSupplierPreselectionReview;

    render(
      <SupplierPreselectionDialog isOpen review={review} selectedItemIds={[LINE_ID]} isLoading={false} isApplying={false}
        error={null} onClose={vi.fn()} onConfirm={vi.fn()} onToggleItem={vi.fn()} onToggleAll={vi.fn()} />,
    );

    const bar = formatCurrency(26245, "EUR");
    expect(screen.getAllByText(bar, { exact: false }).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(formatCurrency(8748, "EUR"), { exact: false })).toBeNull();
  });
});
