import { cleanup,fireEvent,render,screen,within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach,describe,expect,it,vi } from "vitest";

import { ColumnMapper } from "@/components/mappings/ColumnMapper";

describe("ColumnMapper", () => {
  afterEach(cleanup);

  it("does not mutate mapping through conflict removal when disabled", async () => {
    const onChange = vi.fn();
    render(
      createElement(ColumnMapper, {
        sourceColumns: ["Code", "Description"],
        mapping: {
          Code: "hex_code",
          Description: "hex_code",
          LegacyColumn: "designation",
        },
        targetFields: [
          { value: "hex_code", label: "Référence article", required: true },
          { value: "designation", label: "Désignation", required: true },
        ],
        disabled: true,
        onChange,
      })
    );

    const retirerButtons = screen.getAllByRole("button", { name: "Retirer" });
    expect(retirerButtons).toHaveLength(2);
    retirerButtons.forEach((button) => {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets users explicitly leave an irrelevant source column unmapped", () => {
    const onChange = vi.fn();
    render(
      createElement(ColumnMapper, {
        sourceColumns: ["Designation", "Statut_import"],
        mapping: {
          Designation: "designation",
          Statut_import: "notes",
        },
        targetFields: [
          { value: "designation", label: "Désignation", required: true },
          { value: "notes", label: "Notes" },
        ],
        onChange,
      }),
    );

    const ignoredRow = screen.getByText("Statut_import").closest("tr");
    expect(ignoredRow).not.toBeNull();

    const ignoredSelect = within(ignoredRow as HTMLElement).getByRole("combobox");
    expect(
      within(ignoredSelect).getByRole("option", { name: "Ne pas mapper" }),
    ).toBeInTheDocument();

    fireEvent.change(ignoredSelect, { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith({
      Designation: "designation",
    });
  });
});
