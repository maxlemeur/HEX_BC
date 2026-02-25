import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanFileUploadZone } from "@/components/takeoff/PlanFileUploadZone";

vi.mock("@/lib/takeoff/client", () => ({
  isTakeoffApiError: (e: unknown) =>
    e instanceof Error && "status" in e,
  registerPlanFile: vi.fn(),
  uploadFileToSignedUrl: vi.fn(),
}));

import {
  registerPlanFile,
  uploadFileToSignedUrl,
} from "@/lib/takeoff/client";

const SET_ID = "aaaa1111-2222-4333-8444-555566667777";

function makePdfFile(name = "plan.pdf", size = 1024) {
  return new File(["x".repeat(size)], name, { type: "application/pdf" });
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
    name: /Zone de depot PDF/i,
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
  });

  afterEach(() => {
    cleanup();
  });

  it("renders drop zone with instructions", () => {
    renderZone();
    expect(
      screen.getByText(/Glissez des PDF ici ou cliquez pour parcourir/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/PDF uniquement/i)).toBeInTheDocument();
  });

  it("rejects a non-PDF file", async () => {
    renderZone();

    const docxFile = new File(["hello"], "file.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    // Use drag-drop to bypass the accept attribute filtering
    dropFiles([docxFile]);

    await waitFor(() => {
      expect(screen.getByText(/n'est pas un PDF/i)).toBeInTheDocument();
    });
  });

  it("uploads a valid PDF file", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

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

    renderZone(onComplete);

    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const pdfFile = makePdfFile();

    await user.upload(input, pdfFile);

    await waitFor(() => {
      expect(registerPlanFile).toHaveBeenCalledWith(SET_ID, {
        file_name: "plan.pdf",
        file_type: "application/pdf",
        file_size_bytes: 1024,
      });
    });

    await waitFor(() => {
      expect(uploadFileToSignedUrl).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("shows error when upload fails", async () => {
    vi.mocked(registerPlanFile).mockRejectedValue(new Error("Server error"));

    renderZone();

    dropFiles([makePdfFile()]);

    await waitFor(() => {
      const errorElements = screen.getAllByText(/Echec de l'upload/i);
      expect(errorElements.length).toBeGreaterThanOrEqual(1);
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
    const files = [makePdfFile("a.pdf"), makePdfFile("b.pdf"), makePdfFile("c.pdf")];

    await user.upload(input, files);

    await waitFor(() => {
      expect(registerPlanFile).toHaveBeenCalledTimes(3);
    });
  });
});
