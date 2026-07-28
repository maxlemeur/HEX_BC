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
    isDraftLockAcquiring: false,
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
