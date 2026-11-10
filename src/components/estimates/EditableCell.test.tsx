import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { EditableCell } from "@/components/estimates/EditableCell";
import { useGridNavigation, useGridRowSignature } from "@/hooks/useGridNavigation";
import type { SpreadsheetNavigationRow } from "@/hooks/useSpreadsheetNavigation";

const ROWS: SpreadsheetNavigationRow[] = [{ rowId: "L1", columnKeys: ["quantity", "unit_price"] }];

function Row({ navigation }: { navigation: ReturnType<typeof useGridNavigation> }) {
  useGridRowSignature(navigation, "L1");
  const [quantity, setQuantity] = useState("3");

  return (
    <div>
      <EditableCell
        cell={{ rowId: "L1", columnKey: "quantity" }}
        navigation={navigation}
        value={quantity}
        ariaLabel="Quantité"
        onChange={setQuantity}
        onCommit={setQuantity}
      />
    </div>
  );
}

function Harness() {
  return <Row navigation={useGridNavigation({ rows: ROWS })} />;
}

/** A press as the browser sends it: the pointer event first, then the mouse events it is translated to. */
function press(node: Element, pointerType: "mouse" | "touch" | "pen") {
  const pointerDown = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(pointerDown, "pointerType", { value: pointerType });
  act(() => {
    node.dispatchEvent(pointerDown);
  });
  fireEvent.mouseDown(node, { button: 0 });
  fireEvent.mouseUp(node, { button: 0 });
  fireEvent.click(node, { button: 0 });
}

describe("EditableCell in the estimate grid", () => {
  it("selects the cell on a mouse click and leaves the editor closed", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Quantité");
    const cell = input.closest("[data-cell-id]") as HTMLElement;

    press(cell, "mouse");

    expect(document.activeElement).toBe(cell);
    expect(input.style.pointerEvents).toBe("none");
  });

  it.each(["touch", "pen"] as const)("opens the editor on a %s tap, so the virtual keyboard shows", (pointerType) => {
    render(<Harness />);
    const input = screen.getByLabelText("Quantité");
    const cell = input.closest("[data-cell-id]") as HTMLElement;

    press(cell, pointerType);

    expect(document.activeElement).toBe(input);
    expect(input.style.pointerEvents).toBe("");
  });
});
