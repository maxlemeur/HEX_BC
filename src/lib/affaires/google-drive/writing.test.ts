import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("./connections", () => ({ driveWriteToken: vi.fn() }));
import { driveWriteToken } from "./connections";
import { writeDriveFile } from "./writing";
describe("explicit Google writes", () => {
  const member = { tenantId: "tenant", userId: "user", supabase: {} };
  const configuration = {
    enabled: true as const,
    clientId: "client",
    clientSecret: "secret",
    tokenKey: Buffer.alloc(32),
  };
  const input = {
    connectionId: "id",
    grantVersion: "version",
    fileId: "file_demo",
    action: "comment" as const,
    content: "Observation de recette",
  };
  beforeEach(() => {
    vi.mocked(driveWriteToken).mockReset().mockResolvedValue("fixture-token");
  });
  afterEach(() => vi.unstubAllGlobals());
  it("never calls Google when server-side writing is disabled", async () => {
    vi.mocked(driveWriteToken).mockRejectedValue(new Error("Lecture seule"));
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      writeDriveFile(
        member,
        configuration,
        input,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Lecture seule");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("checks Google file capabilities before commenting and does not retry a failed mutation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ capabilities: { canComment: false } }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      writeDriveFile(
        member,
        configuration,
        input,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "DRIVE_WRITE_FORBIDDEN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("checks the current permission again after metadata and sends only an explicit comment", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ capabilities: { canComment: true } }),
      )
      .mockResolvedValueOnce(Response.json({ id: "comment_demo" }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await writeDriveFile(
        member,
        configuration,
        input,
        new AbortController().signal,
      ),
    ).toEqual({ done: true });
    expect(driveWriteToken).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toContain(
      "/files/file_demo/comments",
    );
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      content: "Observation de recette",
    });
  });
  it("treats a server failure after sending the comment as an unknown result without retry", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ capabilities: { canComment: true } }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(writeDriveFile(member, configuration, input, new AbortController().signal))
      .rejects.toMatchObject({ code: "DRIVE_WRITE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
