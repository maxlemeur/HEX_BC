import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateEditorAlerts } from "@/components/estimates/editor/EstimateEditorAlerts";

type AlertsProps = ComponentProps<typeof EstimateEditorAlerts>;

function createProps(overrides: Partial<AlertsProps> = {}): AlertsProps {
  return {
    statusError: null,
    isViewerReadOnly: false,
    canSend: false,
    isSendBlockedForCurrentUser: false,
    isDraftLockedByOther: false,
    lockHolderLabel: "",
    isAdmin: false,
    isForcingDraftUnlock: false,
    onForceUnlockDraftLock: vi.fn(),
    draftLockError: null,
    conflictMessage: null,
    isReloadingVersion: false,
    onReloadAfterConflict: vi.fn(),
    hasRestorableDraft: false,
    onRestoreConflictDraft: vi.fn(),
    totalsOutOfSync: false,
    isTotalCapped: false,
    isSaveBlocked: false,
    onRetryTotalsSave: vi.fn(),
    isStatusReadOnly: false,
    bulkSuggestAppliedCount: null,
    onUndoBulkSuggest: vi.fn(),
    isUndoingBulkSuggest: false,
    isUndoBulkSuggestDisabled: false,
    importSummaryMessage: null,
    actionNotice: null,
    actionError: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe("EstimateEditorAlerts", () => {
  it("keeps the force-unlock button clickable while the lock is held elsewhere", () => {
    render(
      <EstimateEditorAlerts
        {...createProps({
          isDraftLockedByOther: true,
          isAdmin: true,
          lockHolderLabel: "vous dans un autre onglet ou appareil",
        })}
      />
    );

    expect(
      screen.getByTestId("estimate-editor-alert-force-unlock-button")
    ).toBeEnabled();
  });

  it("disables the force-unlock button only while the unlock runs", () => {
    render(
      <EstimateEditorAlerts
        {...createProps({
          isDraftLockedByOther: true,
          isAdmin: true,
          isForcingDraftUnlock: true,
          lockHolderLabel: "Bob Dupont",
        })}
      />
    );

    expect(
      screen.getByTestId("estimate-editor-alert-force-unlock-button")
    ).toBeDisabled();
  });

  it("renders a restored-draft confirmation once as an accessible notice", () => {
    const message =
      "Modifications locales restaurées. Les lignes sont resynchronisées automatiquement.";

    render(
      <EstimateEditorAlerts {...createProps({ actionNotice: message })} />
    );

    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(
      screen.getByTestId("estimate-editor-alert-action-notice")
    ).toHaveClass("alert-info");
    expect(
      screen.queryByTestId("estimate-editor-alert-action-error")
    ).not.toBeInTheDocument();
  });
});
