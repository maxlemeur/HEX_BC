import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateEditorToolbar } from "@/components/estimates/editor/EstimateEditorToolbar";

afterEach(() => {
  cleanup();
});

function renderToolbar(
  versionZeroActionLabel?: string,
  options?: {
    showAutoSaveStatus?: boolean;
    isAutoSaveEnabled?: boolean;
    hasPendingChanges?: boolean;
    isSaveNowDisabled?: boolean;
  }
) {
  const onAutoSaveEnabledChange = vi.fn();
  const onSaveNow = vi.fn();
  render(
    <EstimateEditorToolbar
      projectName="358 LLG LT"
      versionNumber={1}
      status="draft"
      autoSaveStatus="idle"
      autoSaveStatusLabel=""
      autoSaveStatusClassName=""
      showAutoSaveStatus={options?.showAutoSaveStatus ?? false}
      isAutoSaveEnabled={options?.isAutoSaveEnabled ?? true}
      hasPendingChanges={options?.hasPendingChanges ?? false}
      lastSavedAt="2026-08-13T13:42:00.000Z"
      isSaveNowDisabled={options?.isSaveNowDisabled ?? true}
      onAutoSaveEnabledChange={onAutoSaveEnabledChange}
      onSaveNow={onSaveNow}
      canSend={false}
      canAccept={false}
      canArchive={false}
      isStatusActionsDisabled={false}
      isUpdatingStatus={false}
      isDraftLockedByOther={false}
      isDraftLockAcquiring={false}
      isForcingDraftUnlock={false}
      onSend={vi.fn()}
      onAccept={vi.fn()}
      onOpenExclusions={vi.fn()}
      onArchive={vi.fn()}
      onExportExcel={vi.fn()}
      onExportCSV={vi.fn()}
      onExportDpgf={vi.fn()}
      onExportBdc={vi.fn()}
      onImportDpgfSource={vi.fn()}
      showImportDpgfSource={false}
      onOpenVersionZeroDialog={vi.fn()}
      versionZeroActionLabel={versionZeroActionLabel}
      isVersionZeroActionDisabled={false}
      isExportDisabled={false}
      isExporting={false}
      exportLoadingLabel=""
      activeExportMode={null}
      isImportingDpgfSource={false}
      isImportDpgfSourceDisabled={false}
      versionId="version-1"
    />
  );

  return { onAutoSaveEnabledChange, onSaveNow };
}

describe("EstimateEditorToolbar page actions", () => {
  it("presents the assistant as one lightweight draft action", () => {
    renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: "Plus d'actions" }));

    expect(
      screen.getByRole("menuitem", { name: "Préparer un brouillon IA" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Exclusions" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Assistant optionnel")).not.toBeInTheDocument();
    expect(screen.queryByText(/V0/)).not.toBeInTheDocument();
  });

  it("uses the review wording when an AI draft already exists", () => {
    renderToolbar("Revoir le brouillon IA");

    fireEvent.click(screen.getByRole("button", { name: "Plus d'actions" }));

    expect(
      screen.getByRole("menuitem", { name: "Revoir le brouillon IA" })
    ).toBeInTheDocument();
  });
  it("closes the secondary actions with Escape and restores focus", () => {
    renderToolbar();

    const trigger = screen.getByRole("button", { name: "Plus d'actions" });
    fireEvent.click(trigger);
    expect(
      screen.getByRole("menu", { name: "Plus d'actions du chiffrage" })
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByRole("menu", { name: "Plus d'actions du chiffrage" })
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("lets the user disable autosave and save pending changes manually", () => {
    const { onAutoSaveEnabledChange, onSaveNow } = renderToolbar(undefined, {
      showAutoSaveStatus: true,
      isAutoSaveEnabled: true,
      hasPendingChanges: true,
      isSaveNowDisabled: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Plus d'actions" }));

    const toggle = screen.getByRole("menuitemcheckbox", {
      name: "Sauvegarde automatique",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Activée")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Les lignes sont automatiques ; le paramétrage reste manuel."
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId("estimate-page-toolbar-last-saved-at"))
      .toHaveTextContent("Dernière sauvegarde : 13/08/2026 15:42");

    fireEvent.click(toggle);
    expect(onAutoSaveEnabledChange).toHaveBeenCalledWith(false);

    fireEvent.click(
      screen.getByRole("menuitem", { name: /Sauvegarder maintenant/ })
    );
    expect(onSaveNow).toHaveBeenCalledTimes(1);
  });
});
