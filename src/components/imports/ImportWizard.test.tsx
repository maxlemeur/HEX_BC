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
        expect(screen.getByText(/ligne 2/i)).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    await user.click(screen.getByRole("button", { name: /lancer l'import/i }));

    await waitFor(() => {
      expect(importFileMock).toHaveBeenCalledTimes(1);
    });

    expect(importFileMock).toHaveBeenCalledWith(file, { headerRowNumber: null });
  });

  it("keeps history section visible when imports fail to load", async () => {
    useImportFlowMock.mockReturnValue(
      createFlowState({
        imports: [],
        loadError: "Impossible de charger la liste des imports.",
      })
    );

    const user = userEvent.setup();
    render(<ImportWizard />);

    expect(screen.getByText("Historique")).toBeInTheDocument();
    expect(
      screen.getByText("Impossible de charger la liste des imports.")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actualiser" }));
    expect(refreshImportsMock).toHaveBeenCalledTimes(1);
  });
});
