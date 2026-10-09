import { render,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

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
