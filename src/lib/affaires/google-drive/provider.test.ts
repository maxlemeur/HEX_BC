import { afterEach, describe, expect, it, vi } from "vitest";
import { DRIVE_MAX_FILE_BYTES, driveFileRejection, type DriveFile } from "./contracts";
import { GoogleDriveReader } from "./provider";
import { fakeDrive } from "./memory.test-utils";
const file: DriveFile = { id: "plan_demo", name: "plan.pdf", mimeType: "application/pdf", size: "5", version: "1", parents: ["folder_demo"] };
const reader = () => new GoogleDriveReader("fictitious", new AbortController().signal);
afterEach(() => vi.unstubAllGlobals());
describe("Drive read-only provider boundaries", () => {
  it.each([
    [401, "DRIVE_EXPIRED"], [403, "DRIVE_FORBIDDEN"], [404, "DRIVE_NOT_FOUND"], [429, "DRIVE_QUOTA"], [500, "DRIVE_UNAVAILABLE"],
  ])("maps Google status %s to a safe actionable error", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ secret: "must-not-escape" }, { status })));
    const failure = await reader().file("plan_demo").catch((error: Error) => error);
    expect(failure).toMatchObject({ code });
    expect(String((failure as Error).message)).not.toContain("must-not-escape");
  });
  it.each([
    [{ mimeType: "application/vnd.google-apps.document" }, "Google Docs"],
    [{ mimeType: "application/vnd.google-apps.shortcut" }, "raccourcis"],
    [{ size: "0" }, "vide"], [{ size: undefined }, "inconnue"],
    [{ size: String(DRIVE_MAX_FILE_BYTES + 1) }, "50 Mo"],
    [{ name: "plan.exe" }, "Format"], [{ capabilities: { canDownload: false } }, "interdit"],
  ])("rejects unsupported metadata %j", (patch, message) => {
    expect(driveFileRejection({ ...file, ...patch })).toContain(message);
  });
  it("accepts a file of a shared drive", () => {
    expect(driveFileRejection({ ...file, driveId: "shared_drive_demo" })).toBeNull();
  });
  it("bounds actual streamed bytes independently of declared metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("too many bytes")));
    await expect(reader().download(file)).rejects.toThrow("Taille réelle");
  });
  it("rejects an incomplete read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad")));
    await expect(reader().download(file)).rejects.toThrow("incomplète");
  });
  it("rejects a file changed while it was being read", async () => {
    const google = fakeDrive(); google.files.get("plan_demo")!.version = "2";
    vi.stubGlobal("fetch", google.fetchMock);
    await expect(reader().download(file)).rejects.toThrow("modifiée pendant");
  });
  it("uses only Google GETs with the token in a header, never redirects", async () => {
    const google = fakeDrive(); vi.stubGlobal("fetch", google.fetchMock);
    await reader().download(file);
    await reader().list({ kind: "folder", folderId: "folder_demo" });
    for (const [url, options] of google.fetchMock.mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://www.googleapis.com");
      expect(options?.method).toBeUndefined(); expect(options?.redirect).toBe("error");
      expect(String(url)).not.toContain("fictitious");
      expect((options?.headers as Record<string, string>).Authorization).toBe("Bearer fictitious");
    }
  });
  it("lists a shared drive folder within its drive", async () => {
    const google = fakeDrive();
    google.files.set("team_folder", { id: "team_folder", name: "Équipe", mimeType: "application/vnd.google-apps.folder", driveId: "shared_drive_demo" });
    vi.stubGlobal("fetch", google.fetchMock);
    await reader().list({ kind: "folder", folderId: "team_folder" });
    const listing = new URL(String(google.fetchMock.mock.calls.at(-1)![0]));
    expect(Object.fromEntries(["corpora", "driveId", "includeItemsFromAllDrives", "supportsAllDrives"].map((key) => [key, listing.searchParams.get(key)])))
      .toEqual({ corpora: "drive", driveId: "shared_drive_demo", includeItemsFromAllDrives: "true", supportsAllDrives: "true" });
  });
});
