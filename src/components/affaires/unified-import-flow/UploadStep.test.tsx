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
const second = { documentId: "33333333-3333-4333-8333-333333333333", fileName: "autre.csv", label: "autre.csv" };

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

  it("loads the sole stored Drive copy and submits its bytes through the normal import", async () => {
    const response = downloadResponse(first);
    const fetchMock = vi.fn().mockResolvedValueOnce(response.metadata).mockResolvedValueOnce(response.download);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<UploadStep projectId={projectId} intakeDpgfCandidates={[first]} onImportReady={vi.fn()} />);

    await screen.findByRole("button", { name: "Lancer l'import" });
    await user.click(screen.getByRole("button", { name: "Lancer l'import" }));
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/affaires/${projectId}/intake/files/${first.documentId}`);
    expect(importFile).toHaveBeenCalledTimes(1);
    expect(importFile).toHaveBeenCalledWith(expect.any(File), { sourceDocumentId: first.documentId });
    const file = importFile.mock.calls[0][0] as File;
    expect(file.name).toBe(first.fileName);
    expect(file.size).toBe(8);
    expect(await file.text()).toBe("a;b\n1;2\n");
  });

  it("shows why a Drive-linked DPGF cannot be read", async () => {
    const message = "Le compte Google qui a lié ce fichier a été retiré. Sélectionnez de nouveau le fichier dans Google Drive.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false, error: { code: "DRIVE_CONNECTION_REMOVED", message } }) }));
    render(<UploadStep projectId={projectId} intakeDpgfCandidates={[first]} onImportReady={vi.fn()} />);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(importFile).not.toHaveBeenCalled();
  });

  it("asks which copy to use when several DPGFs are available", async () => {
    const response = downloadResponse(second);
    const fetchMock = vi.fn().mockResolvedValueOnce(response.metadata).mockResolvedValueOnce(response.download);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<UploadStep projectId={projectId} intakeDpgfCandidates={[first, second]} onImportReady={vi.fn()} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("Choisir une DPGF du dossier"), second.documentId);
    await screen.findByRole("button", { name: "Lancer l'import" });
    expect(fetchMock.mock.calls[0][0]).toContain(second.documentId);
    expect(screen.getByLabelText("Choisir une DPGF du dossier")).toHaveValue(second.documentId);
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
