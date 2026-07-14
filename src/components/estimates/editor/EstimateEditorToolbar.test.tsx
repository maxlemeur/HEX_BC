import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateEditorToolbar } from "@/components/estimates/editor/EstimateEditorToolbar";

afterEach(() => {
  cleanup();
});

function renderToolbar(versionZeroActionLabel?: string) {
  render(
    <EstimateEditorToolbar
      projectName="358 LLG LT"
      versionNumber={1}
      status="draft"
      autoSaveStatus="idle"
      autoSaveStatusLabel=""
      autoSaveStatusClassName=""
      showAutoSaveStatus={false}
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
}

describe("EstimateEditorToolbar page actions", () => {
  it("presents the assistant as one lightweight draft action", () => {
    renderToolbar();

    expect(
      screen.getByRole("button", { name: "Préparer un brouillon IA" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Assistant optionnel")).not.toBeInTheDocument();
    expect(screen.queryByText(/V0/)).not.toBeInTheDocument();
  });

  it("uses the review wording when an AI draft already exists", () => {
    renderToolbar("Revoir le brouillon IA");

    expect(
      screen.getByRole("button", { name: "Revoir le brouillon IA" })
    ).toBeInTheDocument();
  });
});
