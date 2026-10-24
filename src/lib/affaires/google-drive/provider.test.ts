import { afterEach, describe, expect, it, vi } from "vitest";
import { DRIVE_MAX_FILE_BYTES, driveFileRejection, type DriveFile } from "./contracts";
import { GoogleDriveReader } from "./provider";
import { fakeDrive } from "./memory.test-utils";
const file: DriveFile = { id: "plan_demo", name: "plan.pdf", mimeType: "application/pdf", size: "5", version: "1", parents: ["folder_demo"] };
afterEach(() => vi.unstubAllGlobals());
describe("Drive read-only provider boundaries", () => {
  it.each([
    [401, "DRIVE_EXPIRED"], [403, "DRIVE_FORBIDDEN"], [404, "DRIVE_NOT_FOUND"], [429, "DRIVE_QUOTA"], [500, "DRIVE_UNAVAILABLE"],
  ])("maps Google status %s to a safe actionable error", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ secret: "must-not-escape" }, { status })));
    await expect(new GoogleDriveReader("fictitious", new AbortController().signal).file("plan_demo")).rejects.toMatchObject({ code });
  });
  it.each([
    [{ mimeType: "application/vnd.google-apps.document" }, "Google Docs"],
    [{ mimeType: "application/vnd.google-apps.shortcut" }, "raccourcis"],
    [{ driveId: "shared_demo" }, "Drives partagés"],
    [{ size: "0" }, "vide"], [{ size: undefined }, "inconnue"],
    [{ size: String(DRIVE_MAX_FILE_BYTES + 1) }, "50 Mo"],
    [{ name: "plan.exe" }, "Format"], [{ capabilities: { canDownload: false } }, "interdit"],
  ])("rejects unsupported metadata %j", (patch, message) => {
    expect(driveFileRejection({ ...file, ...patch })).toContain(message);
  });
  it("bounds actual streamed bytes independently of declared metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("too many bytes")));
    await expect(new GoogleDriveReader("fiction", new AbortController().signal).download(file, "folder_demo")).rejects.toThrow("Taille réelle");
  });
  it("rejects an incomplete transfer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad")));
    await expect(new GoogleDriveReader("fiction", new AbortController().signal).download(file, "folder_demo")).rejects.toThrow("incomplet");
  });
  it("rejects a file changed while content was being copied", async () => {
    const google = fakeDrive(); google.files.get("plan_demo")!.version = "2";
    vi.stubGlobal("fetch", google.fetchMock);
    await expect(new GoogleDriveReader("fiction", new AbortController().signal).download(file, "folder_demo")).rejects.toThrow("modifiée pendant");
  });
  it("uses only Google GETs, never source links or redirects", async () => {
    const google = fakeDrive(); vi.stubGlobal("fetch", google.fetchMock);
    await new GoogleDriveReader("fiction", new AbortController().signal).download(file, "folder_demo");
    for (const [url, options] of google.fetchMock.mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://www.googleapis.com");
      expect(options?.method).toBeUndefined(); expect(options?.redirect).toBe("error");
      expect(String(url)).not.toContain("fiction");
    }
  });
});
