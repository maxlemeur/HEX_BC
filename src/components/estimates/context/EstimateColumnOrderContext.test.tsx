import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_ESTIMATE_COLUMN_ORDER, normalizeEstimateColumnOrder } from "@/hooks/useEstimateColumnOrder";
import { EstimateColumnOrderContext, EstimateOrderedCells } from "@/components/estimates/context/EstimateColumnOrderContext";

describe("column order DOM", () => {
  it("moves actual cells and their nested editors while preserving opaque group boundaries", () => {
    const order = normalizeEstimateColumnOrder(["k_fo", "supply_type", "supply_price"]);
    const { container } = render(
      <EstimateColumnOrderContext.Provider value={order}>
        <div role="row">
          <EstimateOrderedCells>
            <div data-estimate-column="designation">Article</div>
            <>
              <div data-estimate-column="supply_price"><input aria-label="Prix" defaultValue="10" /></div>
              <div data-estimate-column="supply_type">Type</div>
              <div data-estimate-column="k_fo"><input aria-label="Coefficient" defaultValue="1.03" /></div>
            </>
            <button type="button">Actions</button>
          </EstimateOrderedCells>
        </div>
      </EstimateColumnOrderContext.Provider>,
    );
    expect([...container.querySelectorAll("[data-estimate-column]")].map((cell) => cell.getAttribute("data-estimate-column")))
      .toEqual(["designation", "k_fo", "supply_type", "supply_price"]);
    expect(screen.getByRole("textbox", { name: "Prix" })).toHaveValue("10");
    expect(screen.getByRole("textbox", { name: "Coefficient" })).toHaveValue("1.03");
    expect(container.querySelector("[role=row]")?.lastElementChild).toHaveTextContent("Actions");
  });

  it("ignores invalid keys, duplicates and attempts to move columns across calculation groups", () => {
    const normalized = normalizeEstimateColumnOrder(["marque", "designation", "marque", "unknown", "k_fo"]);
    expect(normalized[0]).toBe("designation");
    expect(normalized.filter((key) => key === "marque")).toHaveLength(1);
    expect(new Set(normalized)).toEqual(new Set(DEFAULT_ESTIMATE_COLUMN_ORDER));
    expect(normalized.indexOf("marque")).toBeGreaterThan(normalized.indexOf("k_mo_site"));
  });
});
