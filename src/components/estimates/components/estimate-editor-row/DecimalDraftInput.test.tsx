import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";
import { NUMERIC_INPUT_ERROR } from "@/lib/numeric-input/parsers";

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

// A mere focus must not turn an automatic K FO into a manual override.
it("keeps an untouched automatic coefficient automatic, including an external update", () => {
  const change = vi.fn();
  const commit = vi.fn();
  const view = (value: number) => <DecimalDraftInput aria-label="Automatic K FO" value={value}
    commitOnUnchangedBlur={false} onValueChange={change} onValueCommit={commit} />;
  const { rerender } = render(view(1.13));
  const input = screen.getByRole("textbox", { name: "Automatic K FO" });
  fireEvent.focus(input);
  rerender(view(1.02));
  fireEvent.blur(input);
  expect(change).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(input).toHaveValue("1,02");
});
it("commits a deliberately retyped neutral coefficient even when numerically unchanged", () => {
  const commit = vi.fn();
  render(<DecimalDraftInput aria-label="Manual K FO" value={1} commitOnUnchangedBlur={false}
    onValueChange={vi.fn()} onValueCommit={commit} />);
  const input = screen.getByRole("textbox", { name: "Manual K FO" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "1,0" } });
  fireEvent.blur(input);
  expect(commit).toHaveBeenCalledWith(1);
});

// MWG « Error Link » in the dense grid: the refused draft names its reason to assistive technology
// (aria-describedby, after the caller's hint) only while it is invalid, and leaving the field with a
// refused draft announces it once, while typing an invalid prefix announces nothing.
it("describes a refused draft while invalid and announces each refusal once", () => {
  render(
    <>
      <span id="k-hint">Coefficient de vente</span>
      <DecimalDraftInput aria-label="K MO" aria-describedby="k-hint" value={1.2} emptyValue={1}
        onValueChange={vi.fn()} onValueCommit={vi.fn()} />
    </>,
  );
  const input = screen.getByRole("textbox", { name: "K MO" });
  expect(input).toHaveAccessibleDescription("Coefficient de vente");

  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "1,2x" } });
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription(`Coefficient de vente ${NUMERIC_INPUT_ERROR}`);
  expect(screen.queryByRole("alert")).toBeNull();

  fireEvent.blur(input);
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent(NUMERIC_INPUT_ERROR);

  // Passing through the cell again with the same refused draft does not announce it again.
  fireEvent.focus(input);
  fireEvent.blur(input);
  expect(screen.getByRole("alert")).toBe(alert);

  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "1,5" } });
  fireEvent.blur(input);
  expect(input).not.toHaveAttribute("aria-invalid");
  expect(input).toHaveAccessibleDescription("Coefficient de vente");
  expect(screen.queryByRole("alert")).toBeNull();
});

// Review finding: a refusal already announced must not make a later invalid keystroke an alert.
it("does not announce while retyping after a refusal", () => {
  render(<DecimalDraftInput aria-label="K FO" value={1.2} emptyValue={1} onValueChange={vi.fn()} onValueCommit={vi.fn()} />);
  const input = screen.getByRole("textbox", { name: "K FO" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "1,2x" } });
  fireEvent.blur(input);
  expect(screen.getByRole("alert")).toHaveTextContent(NUMERIC_INPUT_ERROR);

  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.change(input, { target: { value: "3x" } });
  expect(input).toHaveAccessibleDescription(NUMERIC_INPUT_ERROR);
  expect(screen.queryByRole("alert")).toBeNull();

  fireEvent.blur(input);
  expect(screen.getByRole("alert")).toHaveTextContent(NUMERIC_INPUT_ERROR);
});
