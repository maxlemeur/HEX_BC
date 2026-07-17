import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateEditorTableLineContextMenu } from "@/components/estimates/components/estimate-editor-table/EstimateEditorTableLineContextMenu";

afterEach(() => {
  cleanup();
});

describe("EstimateEditorTableLineContextMenu", () => {
  it("edits and normalizes the line AID from the context menu", () => {
    const onPatchAid = vi.fn();

    render(
      <EstimateEditorTableLineContextMenu
        itemId="line-1"
        aid={null}
        x={12}
        y={24}
        isReadOnly={false}
        isViewerMode={false}
        isItemConversionPending={false}
        onPatchAid={onPatchAid}
        onCompareSuppliers={vi.fn()}
        onConvertToSection={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", {
      name: "Identifiant AID de la ligne",
    });
    fireEvent.change(input, { target: { value: " cu.tu.100 " } });
    fireEvent.blur(input);

    expect(onPatchAid).toHaveBeenNthCalledWith(
      1,
      "line-1",
      " cu.tu.100 ",
      { persist: false },
    );
    expect(onPatchAid).toHaveBeenNthCalledWith(2, "line-1", "CU.TU.100", {
      persist: true,
    });
  });

  it("keeps the existing line actions", () => {
    const onCompareSuppliers = vi.fn();
    const onConvertToSection = vi.fn();

    render(
      <EstimateEditorTableLineContextMenu
        itemId="line-2"
        aid="AID-2"
        x={12}
        y={24}
        isReadOnly={false}
        isViewerMode={false}
        isItemConversionPending={false}
        onPatchAid={vi.fn()}
        onCompareSuppliers={onCompareSuppliers}
        onConvertToSection={onConvertToSection}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Comparer fournisseurs" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Convertir en section" }));

    expect(onCompareSuppliers).toHaveBeenCalledWith("line-2");
    expect(onConvertToSection).toHaveBeenCalledWith("line-2");
  });
});
