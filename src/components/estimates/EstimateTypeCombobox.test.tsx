import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { EstimateTypeCombobox } from "./EstimateTypeCombobox";
import { useSpreadsheetNavigation } from "@/hooks/useSpreadsheetNavigation";
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

function Grid({ onCommit }: { onCommit: (id: string | null) => void }) {
  const [value, setValue] = useState<string | null>("tube");
  const rows = [{ rowId: "a", columnKeys: ["type", "other"] }, { rowId: "b", columnKeys: ["type"] }];
  const navigation = useSpreadsheetNavigation({ rows });
  const cell = { rowId: "a", columnKey: "type" };
  return <div role="grid">
    <div {...navigation.getCellProps(cell)}>
      <EstimateTypeCombobox value={value} options={options} label="Type FO" emptyLabel="Aucun type" disabled={false}
        editorProps={navigation.getEditorProps<HTMLInputElement>(cell)}
        onCommit={(id) => { onCommit(id); setValue(id); }} />
    </div>
    <div {...navigation.getCellProps({ rowId: "a", columnKey: "other" })}>Suivante</div>
    <div {...navigation.getCellProps({ rowId: "b", columnKey: "type" })}>Dessous</div>
  </div>;
}

describe("EstimateTypeCombobox", () => {
  it("filters without writes and only commits the selected UUID once", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderControl();
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "ELEC");
    expect(screen.getByRole("option", { name: /Électricien/ })).toHaveTextContent("42,00 €/h");
    expect(onCommit).not.toHaveBeenCalled();
    await user.keyboard("{ArrowDown}");
    expect(onCommit).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("elec");
  });

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

  it("invalidates a search if the value or permission changes", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const props = { value: "tube", options, label: "Type FO", emptyLabel: "Aucun type", disabled: false, onCommit };
    const { rerender } = render(<EstimateTypeCombobox {...props} />);
    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "pl");
    rerender(<EstimateTypeCombobox {...props} value="elec" />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("Électricien");
    rerender(<EstimateTypeCombobox {...props} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("leaves IME Enter and arrows to composition", () => {
    const { onCommit } = renderControl();
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "elec" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("keeps Ctrl/Cmd+S available to the document without committing the search", () => {
    const onSaveShortcut = vi.fn();
    const onCommit = vi.fn();
    render(<div onKeyDown={onSaveShortcut}><Grid onCommit={onCommit} /></div>);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "elec" } });
    fireEvent.keyDown(input, { key: "s", ctrlKey: true });
    fireEvent.keyDown(input, { key: "s", metaKey: true });
    expect(onSaveShortcut).toHaveBeenCalledTimes(2);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("integrates typing, arrows, Enter and Tab with the real grid navigation", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Grid onCommit={onCommit} />);
    const first = screen.getAllByRole("gridcell")[0];
    first.focus();
    await user.keyboard("elec");
    expect(screen.getByRole("combobox")).toHaveValue("elec");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("combobox")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("elec");
    expect(screen.getByText("Dessous")).toHaveFocus();
    first.focus();
    await user.keyboard("pl{Tab}");
    expect(screen.getByText("Suivante")).toHaveFocus();
    expect(onCommit).toHaveBeenCalledTimes(1);
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(first).toHaveFocus();
    await user.keyboard("tub{Escape}");
    expect(first).toHaveFocus();
    expect(screen.getByRole("combobox")).toHaveValue("Électricien");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
