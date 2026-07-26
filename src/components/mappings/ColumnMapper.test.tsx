import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
          { value: "designation", label: "Designation", required: true },
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

  it("indicates required targets with explicit marker and required hint", async () => {
    render(
      createElement(ColumnMapper, {
        sourceColumns: ["Code", "Description"],
        mapping: {
          Code: "hex_code",
          Description: "designation",
        },
        targetFields: [
          { value: "hex_code", label: "Référence article", required: true },
          { value: "designation", label: "Designation", required: false },
        ],
        onChange: vi.fn(),
      })
    );

    expect(
      screen.getAllByRole("option").find(
        (option) => (option as HTMLOptionElement).value === "hex_code"
      )
    ).toHaveTextContent("*");
    expect(screen.getByText("Champ requis")).toBeInTheDocument();
  });
});
