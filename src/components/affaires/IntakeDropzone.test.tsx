import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntakeDropzone } from "@/components/affaires/IntakeDropzone";
import { COCKPIT_OPEN_SURFACE_EVENT } from "@/lib/cockpit/events";

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

  it("uploads files forwarded from the empty-affaire drop card", async () => {
    const onUploadComplete = vi.fn();
    const fetchMock = vi.mocked(fetch);
    const file = new File(["cctp"], "cctp.pdf", { type: "application/pdf" });

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            uploadId: "upload-drop",
            files: [
              {
                documentId: "doc-drop",
                fileName: "cctp.pdf",
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
        },
      ),
    );

    render(
      <IntakeDropzone projectId="project-drop" onUploadComplete={onUploadComplete} />,
    );

    document.dispatchEvent(
      new CustomEvent(COCKPIT_OPEN_SURFACE_EVENT, {
        detail: {
          projectId: "project-drop",
          actionId: "flow-empty-upload",
          surfaceId: "intake-upload",
          files: [file],
        },
      }),
    );

    await waitFor(() =>
      expect(onUploadComplete).toHaveBeenCalledWith("upload-drop"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/affaires/project-drop/intake/files",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      }),
    );
  });
});
