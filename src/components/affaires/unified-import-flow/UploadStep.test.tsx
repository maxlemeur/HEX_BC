import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { importFile, reviewTabularPdfFile } = vi.hoisted(() => ({
  importFile: vi.fn(),
  reviewTabularPdfFile: vi.fn(),
}));

vi.mock("@/hooks/useImportFlow", () => ({
  useImportFlow: () => ({
    imports: [], isSubmitting: false, uploadProgress: null, isPolling: false,
    submitError: null, lastImportId: null, importFile,
    importReviewedPdfFile: vi.fn(), reviewTabularPdfFile,
  }),
}));

import { UploadStep } from "./UploadStep";

const projectId = "11111111-1111-4111-8111-111111111111";
const first = { documentId: "22222222-2222-4222-8222-222222222222", fileName: "drive.csv", label: "drive.csv · version Drive 1" };

function downloadResponse(candidate: typeof first, contents = "a;b\n1;2\n") {
  const blob = new Blob([contents], { type: "text/csv" });
  return {
    metadata: { ok: true, json: async () => ({ data: { ...candidate, mimeType: "text/csv", sizeBytes: blob.size, downloadUrl: "https://storage.invalid/signed" } }) },
    download: { ok: true, blob: async () => blob },
  };
}

describe("UploadStep intake DPGF", () => {
  beforeEach(() => { vi.clearAllMocks(); importFile.mockResolvedValue(true); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("selects a Drive-linked DPGF without downloading it, for the server to read", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: {
      ...first, mimeType: "text/csv", sizeBytes: 2048, downloadUrl: null,
    } }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<UploadStep projectId={projectId} intakeDpgfCandidates={[first]} onImportReady={vi.fn()} />);

    await screen.findByRole("button", { name: "Lancer l'import" });
    expect(screen.getByText("2.0 Ko")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lancer l'import" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(importFile).toHaveBeenCalledWith(expect.any(File), { sourceDocumentId: first.documentId });
    expect((importFile.mock.calls[0][0] as File).name).toBe(first.fileName);
  });

  it("keeps a manually chosen file when a previous dossier download finishes late", async () => {
    const response = downloadResponse(first);
    let finishDownload!: (value: typeof response.download) => void;
    const fetchMock = vi.fn().mockResolvedValueOnce(response.metadata).mockImplementationOnce(() => new Promise((resolve) => { finishDownload = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(<UploadStep projectId={projectId} intakeDpgfCandidates={[first]} onImportReady={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await user.upload(container.querySelector('input[type="file"]')!, new File(["local"], "local.csv", { type: "text/csv" }));
    finishDownload(response.download);
    await screen.findByText("local.csv");
    await user.click(screen.getByRole("button", { name: "Lancer l'import" }));
    expect((importFile.mock.calls[0][0] as File).name).toBe("local.csv");
  });
});
