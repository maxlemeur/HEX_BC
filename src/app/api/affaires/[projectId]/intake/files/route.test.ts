import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: vi.fn(),
  };
});

vi.mock("@/lib/affaires/intake-server", () => ({
  createAffaireIntakeUpload: vi.fn(),
  processAffaireIntakeUpload: vi.fn(),
}));

import { after } from "next/server";

import { POST } from "@/app/api/affaires/[projectId]/intake/files/route";
import {
  createAffaireIntakeUpload,
  processAffaireIntakeUpload,
} from "@/lib/affaires/intake-server";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function buildMultipartRequest() {
  const formData = new FormData();
  formData.append(
    "files",
    new File(["hello"], "dpgf.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  return new Request(`http://localhost/api/affaires/${PROJECT_ID}/intake/files`, {
    method: "POST",
    body: formData,
  });
}

describe("affaire intake upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 201 and schedules async processing when at least one file is uploaded", async () => {
    vi.mocked(createAffaireIntakeUpload).mockResolvedValue({
      uploadId: "22222222-2222-4222-8222-222222222222",
      files: [
        {
          documentId: "33333333-3333-4333-8333-333333333333",
          fileName: "dpgf.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: 5,
          status: "uploaded",
          rejectionReason: null,
        },
      ],
      shouldProcessAsync: true,
    });

    const response = await POST(buildMultipartRequest(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({
      ok: true,
      data: {
        uploadId: "22222222-2222-4222-8222-222222222222",
        files: [
          {
            documentId: "33333333-3333-4333-8333-333333333333",
            fileName: "dpgf.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: 5,
            status: "uploaded",
            rejectionReason: null,
          },
        ],
      },
    });
    expect(vi.mocked(after)).toHaveBeenCalledTimes(1);

    const scheduled = vi.mocked(after).mock.calls[0]?.[0];
    expect(typeof scheduled).toBe("function");

    await (scheduled as () => Promise<void>)();

    expect(vi.mocked(processAffaireIntakeUpload)).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222"
    );
  });

  it("does not schedule background processing when everything was rejected", async () => {
    vi.mocked(createAffaireIntakeUpload).mockResolvedValue({
      uploadId: "22222222-2222-4222-8222-222222222222",
      files: [
        {
          documentId: "33333333-3333-4333-8333-333333333333",
          fileName: "virus.exe",
          mimeType: "application/octet-stream",
          sizeBytes: 5,
          status: "rejected",
          rejectionReason: "Extension de fichier non supportee.",
        },
      ],
      shouldProcessAsync: false,
    });

    const response = await POST(buildMultipartRequest(), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(201);
    expect(vi.mocked(after)).not.toHaveBeenCalled();
    expect(vi.mocked(processAffaireIntakeUpload)).not.toHaveBeenCalled();
  });

  it("rejects non-multipart payloads", async () => {
    const response = await POST(
      new Request(`http://localhost/api/affaires/${PROJECT_ID}/intake/files`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      {
        params: Promise.resolve({ projectId: PROJECT_ID }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "BAD_REQUEST",
        }),
      })
    );
  });

  it("rejects an oversized multipart body before parsing or persistence", async () => {
    const request = buildMultipartRequest();
    request.headers.set("content-length", String(106 * 1024 * 1024));

    const response = await POST(request, {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "BAD_REQUEST",
          message: expect.stringMatching(/depasse la taille maximale/),
        }),
      })
    );
    expect(createAffaireIntakeUpload).not.toHaveBeenCalled();
  });
});
