import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EstimateEditorStateModel } from "@/hooks/useEstimateEditorState";

const { useEstimateEditorStateMock } = vi.hoisted(() => ({
  useEstimateEditorStateMock: vi.fn(),
}));

vi.mock("@/hooks/useEstimateEditorState", () => ({
  useEstimateEditorState: useEstimateEditorStateMock,
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockVersionZeroDraftDialog({ versionId }: { versionId?: string }) {
      return <div data-testid="stub-version-zero-dialog">{versionId}</div>;
    },
}));

vi.mock("@/components/AffaireBreadcrumb", () => ({
  AffaireBreadcrumb: ({
    projectId,
    projectName,
    versionNumber,
  }: {
    projectId: string;
    projectName: string;
    versionNumber: number;
  }) => (
    <div data-testid="stub-affaire-breadcrumb">
      {projectId}:{projectName}:V{versionNumber}
    </div>
  ),
}));

vi.mock("@/components/estimates/EstimateEditorSkeleton", () => ({
  EstimateEditorSkeleton: () => <div data-testid="stub-editor-skeleton" />,
}));

vi.mock("@/components/estimates/editor/EstimateEditorToolbar", () => ({
  EstimateEditorToolbar: ({
    projectName,
    versionNumber,
  }: {
    projectName: string;
    versionNumber: number;
  }) => (
    <div data-testid="stub-editor-toolbar">
      {projectName}:V{versionNumber}
    </div>
  ),
}));

vi.mock("@/components/estimates/editor/EstimateEditorAlerts", () => ({
  EstimateEditorAlerts: ({ actionError }: { actionError?: string | null }) => (
    <div data-testid="stub-editor-alerts">{actionError}</div>
  ),
}));

vi.mock("@/components/estimates/EstimateSettingsSummaryBar", () => ({
  EstimateSettingsSummaryBar: ({ currency }: { currency?: string }) => (
    <div data-testid="stub-summary-bar">{currency}</div>
  ),
}));

vi.mock("@/components/estimates/EstimateEditorTable", () => ({
  EstimateEditorTable: ({ versionId }: { versionId?: string }) => (
    <div data-testid="stub-editor-table">{versionId}</div>
  ),
}));

vi.mock("@/components/estimates/editor/EstimateEditorDrawer", () => ({
  EstimateEditorDrawer: ({ projectName }: { projectName?: string }) => (
    <div data-testid="stub-editor-drawer">{projectName}</div>
  ),
}));

vi.mock("@/components/estimates/BulkSuggestDialog", () => ({
  BulkSuggestDialog: ({ isOpen }: { isOpen?: boolean }) => (
    <div data-testid="stub-bulk-suggest-dialog">{String(isOpen)}</div>
  ),
}));

vi.mock("@/components/estimates/SupplierPreselectionDialog", () => ({
  SupplierPreselectionDialog: ({ isOpen }: { isOpen?: boolean }) => (
    <div data-testid="stub-supplier-preselection-dialog">
      {String(isOpen)}
    </div>
  ),
}));

vi.mock("@/components/estimates/ImportFromEstimateDialog", () => ({
  ImportFromEstimateDialog: ({ targetVersionId }: { targetVersionId?: string }) => (
    <div data-testid="stub-import-from-estimate-dialog">{targetVersionId}</div>
  ),
}));

vi.mock("@/components/estimates/EstimateStructureDraftDialog", () => ({
  EstimateStructureDraftDialog: ({ targetVersionId }: { targetVersionId?: string }) => (
    <div data-testid="stub-structure-draft-dialog">{targetVersionId}</div>
  ),
}));

vi.mock("@/components/estimates/GeneratedOuvrageDialog", () => ({
  GeneratedOuvrageDialog: ({ targetVersionId }: { targetVersionId?: string }) => (
    <div data-testid="stub-generated-ouvrage-dialog">{targetVersionId}</div>
  ),
}));

vi.mock("@/components/estimates/EstimateSendGatingDialog", () => ({
  EstimateSendGatingDialog: ({ isOpen }: { isOpen?: boolean }) => (
    <div data-testid="stub-send-gating-dialog">{String(isOpen)}</div>
  ),
}));

import { EstimateEditorPage } from "@/components/estimates/editor/EstimateEditorPage";

type ReadyMeta = Extract<EstimateEditorStateModel["meta"], { kind: "ready" }>;

function makeModel(meta: EstimateEditorStateModel["meta"]): EstimateEditorStateModel {
  return {
    state: {},
    actions: {},
    meta,
  } as unknown as EstimateEditorStateModel;
}

function makeReadyMeta(overrides: Partial<ReadyMeta> = {}): ReadyMeta {
  return {
    kind: "ready",
    projectId: "project-1",
    toolbarProps: {
      projectName: "Chantier Atlas",
      versionNumber: 4,
    },
    alertsProps: {
      actionError: "Erreur d'action témoin",
    },
    summaryBarProps: {
      currency: "EUR",
    },
    editorTableProps: {
      versionId: "version-4",
    },
    drawerProps: {
      projectName: "Chantier Atlas",
    },
    bulkSuggestDialogProps: {
      isOpen: true,
    },
    supplierPreselectionDialogProps: {
      isOpen: true,
    },
    importFromEstimateDialogProps: {
      targetVersionId: "version-4",
    },
    estimateStructureDraftDialogProps: {
      targetVersionId: "version-4",
    },
    generatedOuvrageDialogProps: {
      targetVersionId: "version-4",
    },
    versionZeroDraftDialogProps: {
      versionId: "version-4",
    },
    sendGatingDialogProps: {
      isOpen: true,
    },
    ...overrides,
  } as unknown as ReadyMeta;
}

afterEach(() => {
  cleanup();
  useEstimateEditorStateMock.mockReset();
});

describe("EstimateEditorPage", () => {
  it("renders the missing-version state and forwards default hook options", () => {
    useEstimateEditorStateMock.mockReturnValue(
      makeModel({ kind: "missing-version" })
    );

    render(<EstimateEditorPage versionId="" />);

    expect(screen.getByText("Version introuvable.")).toBeInTheDocument();
    expect(screen.queryByTestId("estimate-editor-page")).not.toBeInTheDocument();
    expect(useEstimateEditorStateMock).toHaveBeenCalledWith({
      versionId: "",
      focusItemId: null,
      autoOpenVersionZero: false,
      autoOpenStructureDraft: false,
      autoOpenSettingsSection: null,
    });
  });

  it("renders the loading state", () => {
    useEstimateEditorStateMock.mockReturnValue(makeModel({ kind: "loading" }));

    render(<EstimateEditorPage versionId="version-1" />);

    expect(screen.getByTestId("stub-editor-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("estimate-editor-page")).not.toBeInTheDocument();
  });

  it("renders the error returned by the model", () => {
    useEstimateEditorStateMock.mockReturnValue(
      makeModel({ kind: "error", message: "Chargement impossible." })
    );

    render(<EstimateEditorPage versionId="version-2" />);

    expect(screen.getByText("Chargement impossible.")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-editor-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByTestId("estimate-editor-page")).not.toBeInTheDocument();
  });

  it("renders every ready region and forwards the supplied view props", () => {
    useEstimateEditorStateMock.mockReturnValue(makeModel(makeReadyMeta()));

    render(
      <EstimateEditorPage
        versionId="version-4"
        focusItemId="line-9"
        autoOpenVersionZero
        autoOpenStructureDraft
      />
    );

    expect(screen.getByTestId("estimate-editor-page")).toBeInTheDocument();
    expect(screen.getByTestId("stub-affaire-breadcrumb")).toHaveTextContent(
      "project-1:Chantier Atlas:V4"
    );
    expect(screen.getByTestId("stub-editor-toolbar")).toHaveTextContent(
      "Chantier Atlas:V4"
    );
    expect(screen.getByTestId("estimate-editor-alerts-region")).toContainElement(
      screen.getByTestId("stub-editor-alerts")
    );
    expect(screen.getByTestId("stub-editor-alerts")).toHaveTextContent(
      "Erreur d'action témoin"
    );
    expect(screen.getByTestId("estimate-editor-summary-bar")).toContainElement(
      screen.getByTestId("stub-summary-bar")
    );
    expect(screen.getByTestId("stub-summary-bar")).toHaveTextContent("EUR");
    expect(screen.getByTestId("estimate-editor-table-region")).toContainElement(
      screen.getByTestId("stub-editor-table")
    );
    expect(screen.getByTestId("stub-editor-table")).toHaveTextContent("version-4");
    expect(screen.getByTestId("estimate-editor-drawer-region")).toContainElement(
      screen.getByTestId("stub-editor-drawer")
    );
    expect(
      screen.getByTestId("estimate-editor-bulk-suggest-dialog-region")
    ).toContainElement(screen.getByTestId("stub-bulk-suggest-dialog"));
    expect(
      screen.getByTestId("estimate-editor-supplier-preselection-dialog-region")
    ).toContainElement(screen.getByTestId("stub-supplier-preselection-dialog"));
    expect(
      screen.getByTestId("estimate-editor-import-from-estimate-dialog-region")
    ).toContainElement(screen.getByTestId("stub-import-from-estimate-dialog"));
    expect(
      screen.getByTestId("estimate-editor-structure-draft-dialog-region")
    ).toContainElement(screen.getByTestId("stub-structure-draft-dialog"));
    expect(
      screen.getByTestId("estimate-editor-generated-ouvrage-dialog-region")
    ).toContainElement(screen.getByTestId("stub-generated-ouvrage-dialog"));
    expect(
      screen.getByTestId("estimate-editor-version-zero-dialog-region")
    ).toContainElement(screen.getByTestId("stub-version-zero-dialog"));
    expect(
      screen.getByTestId("estimate-editor-send-gating-dialog-region")
    ).toContainElement(screen.getByTestId("stub-send-gating-dialog"));
    expect(useEstimateEditorStateMock).toHaveBeenCalledWith({
      versionId: "version-4",
      focusItemId: "line-9",
      autoOpenVersionZero: true,
      autoOpenStructureDraft: true,
      autoOpenSettingsSection: null,
    });
  });

  it("omits optional ready regions when their props are absent", () => {
    useEstimateEditorStateMock.mockReturnValue(
      makeModel(
        makeReadyMeta({
          projectId: null,
          importFromEstimateDialogProps: null,
          estimateStructureDraftDialogProps: null,
          generatedOuvrageDialogProps: null,
          versionZeroDraftDialogProps: null,
        })
      )
    );

    render(<EstimateEditorPage versionId="version-4" />);

    expect(screen.queryByTestId("stub-affaire-breadcrumb")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("estimate-editor-import-from-estimate-dialog-region")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("estimate-editor-structure-draft-dialog-region")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("estimate-editor-generated-ouvrage-dialog-region")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("estimate-editor-version-zero-dialog-region")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("estimate-editor-bulk-suggest-dialog-region")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("estimate-editor-supplier-preselection-dialog-region")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("estimate-editor-send-gating-dialog-region")
    ).toBeInTheDocument();
  });
});
