import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportListItem } from "@/hooks/useImportFlow";

const { useImportFlowMock } = vi.hoisted(() => ({
  useImportFlowMock: vi.fn(),
}));

const importFileMock = vi.fn();
const importReviewedPdfFileMock = vi.fn();
const reviewTabularPdfFileMock = vi.fn();
const refreshImportsMock = vi.fn();

vi.mock("next/link", () => ({
  default: function MockLink({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) {
    return <a href={href}>{children}</a>;
  },
}));

vi.mock("@/hooks/useImportFlow", () => ({
  useImportFlow: useImportFlowMock,
}));

vi.mock("xlsx", () => ({
  default: {
    read: vi.fn(() => ({
      SheetNames: ["Feuil1"],
      Sheets: { Feuil1: {} },
    })),
    utils: {
      sheet_to_json: vi.fn(() => [
        ["Titre du document"],
        ["Code", "Description", "Prix"],
      ]),
    },
  },
}));

import { ImportWizard } from "@/components/imports/ImportWizard";
import { ImportWizardFileStageSection } from "@/components/imports/ImportWizardFileStageSection";

function createFlowState(overrides?: Partial<{
  imports: ImportListItem[];
  isLoadingImports: boolean;
  isRefreshing: boolean;
  isSubmitting: boolean;
  isPolling: boolean;
  loadError: string | null;
  submitError: string | null;
  workerError: string | null;
  modeMessage: string | null;
  lastMode: "worker" | "server" | "unknown" | null;
  lastImportId: string | null;
}>) {
  return {
    imports: [],
    isLoadingImports: false,
    isRefreshing: false,
    isSubmitting: false,
    isPolling: false,
    loadError: null,
    submitError: null,
    workerError: null,
    modeMessage: null,
    lastMode: null,
    lastImportId: null,
    importFile: importFileMock,
    importReviewedPdfFile: importReviewedPdfFileMock,
    reviewTabularPdfFile: reviewTabularPdfFileMock,
    refreshImports: refreshImportsMock,
    ...overrides,
  };
}

describe("ImportWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importFileMock.mockResolvedValue(true);
    importReviewedPdfFileMock.mockResolvedValue(true);
    reviewTabularPdfFileMock.mockResolvedValue({
      source_file_name: "devis.pdf",
      source_document_id: null,
      tables: [],
      review: { suggested_approved_tables: [] },
    });
    refreshImportsMock.mockResolvedValue(undefined);
    useImportFlowMock.mockReturnValue(createFlowState());
  });

  afterEach(() => {
    cleanup();
  });

  it("does not force detected header row when user did not provide one", async () => {
    const user = userEvent.setup();
    const { container } = render(<ImportWizard />);

    const fileInput = container.querySelector(
      "#import-file-input"
    ) as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) {
      throw new Error("File input not found");
    }

    const file = new File(["xlsx-data"], "devis.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await user.upload(fileInput, file);

    await waitFor(
      () => {
        expect(screen.getByText(/ligne du tableau 2/i)).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    await user.click(screen.getByRole("button", { name: /lancer l'import/i }));

    await waitFor(() => {
      expect(importFileMock).toHaveBeenCalledTimes(1);
    });

    expect(importFileMock).toHaveBeenCalledWith(file, { headerRowNumber: null });
  });

  it("re-shows the success CTA after importing another file", async () => {
    let flowState = createFlowState({
      lastImportId: "import-1",
    });
    useImportFlowMock.mockImplementation(() => flowState);
    importFileMock.mockImplementation(async () => {
      flowState = createFlowState({
        lastImportId: "import-2",
      });
      return true;
    });

    const user = userEvent.setup();
    const { container } = render(<ImportWizard />);

    await user.click(
      screen.getByRole("button", { name: /importer un autre fichier/i })
    );

    const fileInput = container.querySelector(
      "#import-file-input"
    ) as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) {
      throw new Error("File input not found");
    }

    const file = new File(["xlsx-data"], "devis.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await user.upload(fileInput, file);

    await waitFor(
      () => {
        expect(screen.getByText(/ligne du tableau 2/i)).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    await user.click(screen.getByRole("button", { name: /lancer l'import/i }));

    await waitFor(() => {
      expect(importFileMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /mapper les colonnes/i })
      ).toHaveAttribute("href", "/dashboard/mappings?import_id=import-2");
    });
  });
});

describe("the header row of a workbook", () => {
  it("numbers it as the item list and the structure review do: the row of the table read", () => {
    const noop = () => undefined;
    render(
      <ImportWizardFileStageSection
        approvedPdfTables={[]} clearSelectedFile={noop} detectedHeaderRow={null} detectedHeaders={[]}
        fileInputRef={{ current: null }} fileStage="header_needed" formatError={null} handleDragLeave={noop}
        handleDragOver={noop} handleDrop={noop} handleFileSelection={noop} handleFormSubmit={async () => undefined}
        handleHeaderRowInputChange={noop} handlePdfReviewSubmit={async () => undefined} handleTogglePdfTable={noop}
        headerRowError={null} headerRowInput="" isDragOver={false} isSubmitting={false} lastMode={null} modeMessage={null}
        pdfReview={null} pdfReviewError={null} selectedFile={new File(["x"], "dpgf.xlsx")} submitError={null}
        workerError={null}
      />,
    );
    expect(screen.getByLabelText("Ligne d’en-tête (ligne du tableau)")).toBeInTheDocument();
    expect(screen.getByText(/numéro de la ligne du tableau qui contient les noms de colonnes/)).toBeInTheDocument();
  });
});
