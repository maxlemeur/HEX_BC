import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";

describe("DecimalDraftInput", () => {
  it("preserves comma and point drafts while the numeric value updates", () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    const view = render(
      <DecimalDraftInput
        aria-label="Coefficient"
        value={1}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Coefficient" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1," } });
    view.rerender(
      <DecimalDraftInput
        aria-label="Coefficient"
        value={1}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    expect(input).toHaveValue("1,");

    fireEvent.change(input, { target: { value: "1,5" } });
    view.rerender(
      <DecimalDraftInput
        aria-label="Coefficient"
        value={1.5}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );
    expect(input).toHaveValue("1,5");
    expect(onValueChange).toHaveBeenLastCalledWith(1.5);

    fireEvent.blur(input);
    expect(onValueCommit).toHaveBeenLastCalledWith(1.5);
    expect(input).toHaveValue("1.5");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2." } });
    expect(input).toHaveValue("2.");
    fireEvent.change(input, { target: { value: "2.75" } });
    expect(input).toHaveValue("2.75");
    expect(onValueChange).toHaveBeenLastCalledWith(2.75);
    fireEvent.blur(input);
    expect(onValueCommit).toHaveBeenLastCalledWith(2.75);
  });
});
