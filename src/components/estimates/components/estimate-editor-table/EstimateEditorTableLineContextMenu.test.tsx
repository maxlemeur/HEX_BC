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
        hasAssociatedProduct={false}
        onPatchAid={onPatchAid}
        onOpenArticle={vi.fn()}
        onAssociateArticle={vi.fn()}
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

  it("exposes article actions before supplier comparison and separates conversion", () => {
    const onOpenArticle = vi.fn();
    const onAssociateArticle = vi.fn();
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
        hasAssociatedProduct
        onPatchAid={vi.fn()}
        onOpenArticle={onOpenArticle}
        onAssociateArticle={onAssociateArticle}
        onCompareSuppliers={onCompareSuppliers}
        onConvertToSection={onConvertToSection}
      />,
    );

    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems.map((item) => item.textContent)).toEqual([
      "Fiche article",
      "Associer ou remplacer l’article",
      "Comparer les fournisseurs",
      "Convertir en section",
    ]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Fiche article" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Associer ou remplacer l’article" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Comparer les fournisseurs" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Convertir en section" }));

    expect(onOpenArticle).toHaveBeenCalledWith("line-2");
    expect(onAssociateArticle).toHaveBeenCalledWith("line-2");
    expect(onCompareSuppliers).toHaveBeenCalledWith("line-2");
    expect(onConvertToSection).toHaveBeenCalledWith("line-2");
  });

  it("disables the fiche without a linked article and association in read-only mode", () => {
    render(
      <EstimateEditorTableLineContextMenu
        itemId="line-3"
        aid={null}
        x={12}
        y={24}
        isReadOnly
        isViewerMode={false}
        isItemConversionPending={false}
        hasAssociatedProduct={false}
        onPatchAid={vi.fn()}
        onOpenArticle={vi.fn()}
        onAssociateArticle={vi.fn()}
        onCompareSuppliers={vi.fn()}
        onConvertToSection={vi.fn()}
      />,
    );

    expect(screen.getByRole("menuitem", { name: "Fiche article" })).toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: "Associer ou remplacer l’article" }),
    ).toBeDisabled();
  });
});
