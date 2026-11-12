import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuantityCell } from "@/components/material-requests/cells";

// The quantity cell names its own reason (« Quantité illisible… », a range the decimal grammar
// alone does not know). Its decimal input must not add a second reason or a second announcement.
describe("QuantityCell", () => {
  it("gives an unreadable quantity one reason and one announcement", () => {
    render(<QuantityCell label="Quantité de tube" value={2} onCommit={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Quantité de tube" });

    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "0" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "Non enregistré : Quantité illisible : un nombre au-dessus de zéro, trois décimales au plus.",
    );

    fireEvent.blur(input);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
