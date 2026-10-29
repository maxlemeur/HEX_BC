import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EstimateTypeCombobox } from "./EstimateTypeCombobox";
import type { EstimateTypeOption } from "@/lib/estimates/type-search";

const options: EstimateTypeOption[] = [
  { id: "tube", code: "TUB", label: "Tube" },
  { id: "elec", label: "Électricien", detail: "42,00 €/h" },
  { id: "plombier", label: "Plombier" },
  { id: "plaquiste", label: "Plaquiste" },
  { id: "inactive", label: "Ancien rôle", disabled: true },
];

afterEach(cleanup);

function renderControl(overrides: Partial<Parameters<typeof EstimateTypeCombobox>[0]> = {}) {
  const onCommit = vi.fn();
  return { onCommit, ...render(<EstimateTypeCombobox
    value="tube" options={options} label="Type FO" emptyLabel="Aucun type"
    disabled={false} onCommit={onCommit} {...overrides}
  />) };
}

describe("EstimateTypeCombobox", () => {
  it("keeps the previous value on ambiguous Tab and unknown blur", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderControl();
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "pl");
    await user.tab();
    expect(input).toHaveValue("Tube");
    expect(onCommit).not.toHaveBeenCalled();
    await user.click(input);
    await user.type(input, "introuvable");
    expect(screen.getByText("Aucun type correspondant")).toBeVisible();
    fireEvent.blur(input);
    expect(input).toHaveValue("Tube");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("requires an explicit choice for ambiguity, and explicit clearing", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderControl();
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "pl{Enter}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeVisible();
    await user.keyboard("{ArrowDown}{ArrowDown}{Tab}");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("plaquiste");
    onCommit.mockClear();
    await user.click(input);
    await user.clear(input);
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "Aucun type" }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("cancels with Escape, skips inactive roles and does not save unchanged values", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderControl();
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "elec{Escape}");
    expect(input).toHaveValue("Tube");
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "Ancien rôle (inactif)" }));
    expect(onCommit).not.toHaveBeenCalled();
    await user.type(input, "tub{Tab}");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
