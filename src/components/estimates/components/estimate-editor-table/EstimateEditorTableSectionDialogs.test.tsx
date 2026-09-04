// @vitest-environment jsdom

import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateEditorTableSectionDialogs } from "@/components/estimates/components/estimate-editor-table/EstimateEditorTableSectionDialogs";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EstimateEditorTableSectionDialogs", () => {
  it("délègue la suppression à l'unique confirmation du contrôleur", () => {
    const onCloseSectionContextMenu = vi.fn();
    const onDeleteSection = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm");

    render(
      <EstimateEditorTableSectionDialogs
        isReadOnly={false}
        isItemConversionPending={false}
        sectionContextMenu={{ sectionId: "section-1", right: 16, y: 120 }}
        sectionContextMeta={{
          sectionLevel: 2,
          hasChildren: false,
          canAddSection: true,
          canAddLine: true,
          addSectionLabel: "+ Sous-chapitre",
          addLineLabel: "+ Ligne Chapitre",
        }}
        onCloseSectionContextMenu={onCloseSectionContextMenu}
        onAddLine={vi.fn()}
        onAddSection={vi.fn()}
        onConvertSectionToLine={vi.fn()}
        onDuplicateSectionInPlace={vi.fn()}
        onOpenDuplicateSectionDialog={vi.fn()}
        onOpenSaveAsAssemblyDialog={vi.fn()}
        onDeleteSection={onDeleteSection}
        availableSectionDuplicateTargets={[]}
        duplicateSectionDialogSectionId={null}
        duplicateSectionTargetVersionId=""
        onDuplicateSectionTargetVersionIdChange={vi.fn()}
        isDuplicateSectionPending={false}
        onCloseDuplicateSectionDialog={vi.fn()}
        onConfirmDuplicateSectionToVersion={vi.fn()}
        saveAsAssemblyDialogSectionId={null}
        saveAsAssemblyName=""
        onSaveAsAssemblyNameChange={vi.fn()}
        saveAsAssemblyNameInputRef={createRef<HTMLInputElement>()}
        isSaveAsAssemblyPending={false}
        onCloseSaveAsAssemblyDialog={vi.fn()}
        onConfirmSaveAsAssembly={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Supprimer la section" })
    );

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onCloseSectionContextMenu).toHaveBeenCalledOnce();
    expect(onDeleteSection).toHaveBeenCalledOnce();
    expect(onDeleteSection).toHaveBeenCalledWith("section-1");
  });
});
