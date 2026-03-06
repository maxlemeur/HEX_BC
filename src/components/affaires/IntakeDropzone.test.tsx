import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntakeDropzone } from "@/components/affaires/IntakeDropzone";

describe("IntakeDropzone", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("accepts wrapped API success responses and triggers completion", async () => {
    const onUploadComplete = vi.fn();
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            uploadId: "upload-1",
            files: [
              {
                documentId: "doc-1",
                fileName: "plans.pdf",
                status: "uploaded",
                rejectionReason: null,
              },
            ],
          },
        }),
        {
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );

    const { container } = render(
      <IntakeDropzone projectId="project-1" onUploadComplete={onUploadComplete} />
    );

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(["plans"], "plans.pdf", { type: "application/pdf" })],
      },
    });

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledTimes(1));

    expect(
      await screen.findByText("plans.pdf", { selector: "span" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Erreur reseau/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/affaires/project-1/intake/files",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      })
    );
  });
});
