import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PDFDocument } from "pdf-lib";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import { PlanFileUploadZone } from "@/components/takeoff/PlanFileUploadZone";

vi.mock("@/lib/takeoff/client", () => ({
  deletePlanFile: vi.fn(),
  isTakeoffApiError: (e: unknown) =>
    e instanceof Error && "status" in e,
  registerPlanFile: vi.fn(),
  reconcilePlanSetDossier: vi.fn(),
  uploadFileToSignedUrl: vi.fn(),
}));

import {
deletePlanFile,
registerPlanFile,
reconcilePlanSetDossier,
uploadFileToSignedUrl,
} from "@/lib/takeoff/client";

const SET_ID = "aaaa1111-2222-4333-8444-555566667777";

async function makePdfFile(
  name = "plan.pdf",
  mimeType = "application/pdf"
) {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  return new File([new Uint8Array(await pdf.save())], name, { type: mimeType });
}

function renderZone(onUploadsComplete = vi.fn()) {
  return {
    onUploadsComplete,
    ...render(
      <PlanFileUploadZone setId={SET_ID} onUploadsComplete={onUploadsComplete} />
    ),
  };
}

/** Simulate a drop on the drop zone (bypasses the accept attribute on the file input). */
function dropFiles(files: File[]) {
  const zone = screen.getByRole("button", {
    name: /Zone de dépôt PDF/i,
  });
  const dataTransfer = {
    files,
    items: files.map((f) => ({ kind: "file", getAsFile: () => f })),
    types: ["Files"],
  };
  fireEvent.dragEnter(zone, { dataTransfer });
  fireEvent.drop(zone, { dataTransfer });
}

describe("PlanFileUploadZone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reconcilePlanSetDossier).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps uploaded bytes and lets the user retry if dossier synchronization fails", async () => {
    const file = await makePdfFile("plan.pdf");
    vi.mocked(registerPlanFile).mockResolvedValue({
      plan_file: { id: "file-1" } as never,
      signed_upload: { url: "https://storage.example.com/upload", method: "PUT", path: "path", token: "fixture", expires_in_seconds: 7200 },
    });
    vi.mocked(uploadFileToSignedUrl).mockResolvedValue(undefined);
    vi.mocked(reconcilePlanSetDossier).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderZone();
    dropFiles([file]);

    await screen.findByText(/Plans envoyés, mais le dossier n'a pas pu être actualisé/);
    expect(deletePlanFile).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Réessayer l'actualisation" }));
    await waitFor(() => expect(screen.queryByText(/Plans envoyés, mais le dossier/)).not.toBeInTheDocument());
    expect(reconcilePlanSetDossier).toHaveBeenCalledTimes(2);
  });

  it("cleans up a registered file after a binary upload failure and allows retry", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const createResponse = {
      plan_file: {
        id: "file-to-clean",
        created_at: "2026-02-25T10:00:00.000Z",
        updated_at: "2026-02-25T10:00:00.000Z",
        tenant_id: "tenant-1",
        plan_set_id: SET_ID,
        file_path: "path/to/retry.pdf",
        file_name: "retry.pdf",
        file_type: "application/pdf",
        file_size_bytes: 1024,
        page_count: null,
        file_hash: null,
        metadata: {},
        created_by: null,
      },
      signed_upload: {
        url: "https://storage.example.com/upload",
        method: "PUT" as const,
        path: "path/to/retry.pdf",
        token: "tok123",
        expires_in_seconds: 7200,
      },
    };
    vi.mocked(registerPlanFile).mockResolvedValue(createResponse);
    vi.mocked(uploadFileToSignedUrl)
      .mockRejectedValueOnce(new Error("Connexion interrompue."))
      .mockResolvedValueOnce(undefined);
    vi.mocked(deletePlanFile).mockResolvedValue({
      deleted: true,
      plan_set_id: SET_ID,
      file_id: "file-to-clean",
    });

    renderZone(onComplete);
    dropFiles([await makePdfFile("retry.pdf")]);

    await waitFor(() => {
      expect(deletePlanFile).toHaveBeenCalledWith(SET_ID, "file-to-clean");
    });

    const retryButton = await screen.findByRole("button", {
      name: "Réessayer",
    });
    await waitFor(() => expect(retryButton).toBeEnabled());
    await user.click(retryButton);

    await waitFor(() => {
      expect(registerPlanFile).toHaveBeenCalledTimes(2);
      expect(uploadFileToSignedUrl).toHaveBeenCalledTimes(2);
      expect(onComplete).toHaveBeenLastCalledWith({
        uploadedCount: 1,
        uploadedSizeBytes: expect.any(Number),
      });
    });
  });

  it("accepts a PDF when the browser sends application/octet-stream", async () => {
    const user = userEvent.setup();

    vi.mocked(registerPlanFile).mockResolvedValue({
      plan_file: {
        id: "file-1",
        created_at: "2026-02-25T10:00:00.000Z",
        updated_at: "2026-02-25T10:00:00.000Z",
        tenant_id: "tenant-1",
        plan_set_id: SET_ID,
        file_path: "path/to/file.pdf",
        file_name: "terrain.pdf",
        file_type: "application/pdf",
        file_size_bytes: 1024,
        page_count: null,
        file_hash: null,
        metadata: {},
        created_by: null,
      },
      signed_upload: {
        url: "https://storage.example.com/upload",
        method: "PUT" as const,
        path: "path/to/file.pdf",
        token: "tok123",
        expires_in_seconds: 7200,
      },
    });
    vi.mocked(uploadFileToSignedUrl).mockResolvedValue(undefined);

    renderZone();

    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const pdfFile = await makePdfFile("terrain.pdf", "application/octet-stream");

    await user.upload(input, pdfFile);

    await waitFor(() => {
      expect(registerPlanFile).toHaveBeenCalledWith(SET_ID, {
        file_name: "terrain.pdf",
        file_type: "application/pdf",
        file_size_bytes: pdfFile.size,
      });
    });
  });

  it("rejects a corrupted PDF with an explicit remediation message", async () => {
    renderZone();

    const corruptedPdf = new File(["not-a-pdf"], "corrompu.pdf", {
      type: "application/pdf",
    });

    dropFiles([corruptedPdf]);

    await waitFor(() => {
      expect(screen.getAllByText(/corrompu\.pdf/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/invalide ou corrompu/i)).toBeInTheDocument();
    });
  });

  it("handles multiple files", async () => {
    const user = userEvent.setup();

    vi.mocked(registerPlanFile).mockResolvedValue({
      plan_file: {
        id: "file-1",
        created_at: "2026-02-25T10:00:00.000Z",
        updated_at: "2026-02-25T10:00:00.000Z",
        tenant_id: "tenant-1",
        plan_set_id: SET_ID,
        file_path: "path/to/file.pdf",
        file_name: "plan.pdf",
        file_type: "application/pdf",
        file_size_bytes: 1024,
        page_count: null,
        file_hash: null,
        metadata: {},
        created_by: null,
      },
      signed_upload: {
        url: "https://storage.example.com/upload",
        method: "PUT" as const,
        path: "path/to/file.pdf",
        token: "tok123",
        expires_in_seconds: 7200,
      },
    });
    vi.mocked(uploadFileToSignedUrl).mockResolvedValue(undefined);

    renderZone();

    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const files = [
      await makePdfFile("a.pdf"),
      await makePdfFile("b.pdf"),
      await makePdfFile("c.pdf"),
    ];

    await user.upload(input, files);

    await waitFor(() => {
      expect(registerPlanFile).toHaveBeenCalledTimes(3);
    });
  });
});
