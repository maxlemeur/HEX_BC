import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  bulkArchiveDraftAffaires: vi.fn(),
}));

vi.mock("@/lib/affaires/delete-server", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/affaires/delete-server")
  >();
  return {
    ...actual,
    bulkArchiveDraftAffaires: mocks.bulkArchiveDraftAffaires,
  };
});

const projectId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/affaires/bulk-archive", () => {
  it("archives the validated target list", async () => {
    mocks.bulkArchiveDraftAffaires.mockResolvedValue({
      requestedCount: 1,
      archivedIds: [projectId],
      failures: [],
    });

    const response = await POST(
      new Request("http://localhost/api/affaires/bulk-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: [projectId] }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { archivedIds: [projectId], failures: [] },
    });
    expect(mocks.bulkArchiveDraftAffaires).toHaveBeenCalledWith([projectId]);
  });

  it("rejects an empty selection", async () => {
    const response = await POST(
      new Request("http://localhost/api/affaires/bulk-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: [] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.bulkArchiveDraftAffaires).not.toHaveBeenCalled();
  });

  it("rejects more than 1,000 targets", async () => {
    const response = await POST(
      new Request("http://localhost/api/affaires/bulk-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectIds: Array.from(
            { length: 1001 },
            (_, index) =>
              `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          ),
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.bulkArchiveDraftAffaires).not.toHaveBeenCalled();
  });
});