import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";

describe("DecimalDraftInput", () => {
  it("retombe sur emptyValue (1) quand un coefficient est vidé", () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    render(
      <DecimalDraftInput
        aria-label="K FO"
        value={1.3}
        emptyValue={1}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    const input = screen.getByRole("textbox", { name: "K FO" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenLastCalledWith(1);
    expect(onValueCommit).toHaveBeenLastCalledWith(1);
  });

  it("préserve le comportement historique (vide -> 0) sans emptyValue", () => {
    const onValueCommit = vi.fn();
    render(
      <DecimalDraftInput
        aria-label="Heures"
        value={5}
        onValueChange={vi.fn()}
        onValueCommit={onValueCommit}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Heures" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onValueCommit).toHaveBeenLastCalledWith(0);
  });
});
