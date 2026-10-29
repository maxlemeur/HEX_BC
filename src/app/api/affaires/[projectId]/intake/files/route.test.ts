import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/affaires/intake-server", () => ({
  createAffaireIntakeUpload: vi.fn(),
  processAffaireIntakeUpload: vi.fn(),
}));

import { POST } from "@/app/api/affaires/[projectId]/intake/files/route";
import { createAffaireIntakeUpload } from "@/lib/affaires/intake-server";

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
