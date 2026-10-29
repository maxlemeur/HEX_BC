import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/affaires/google-drive/connections", () => ({ saveDriveConnection: vi.fn() }));
vi.mock("@/lib/affaires/google-drive/store", () => ({ rearmLotsFailedWithConnection: vi.fn() }));
vi.mock("@/lib/affaires/intake-server", () => ({ processAffaireIntakeUpload: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: vi.fn() }));
import { after } from "next/server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { saveDriveConnection } from "@/lib/affaires/google-drive/connections";
import { rearmLotsFailedWithConnection } from "@/lib/affaires/google-drive/store";
import { processAffaireIntakeUpload } from "@/lib/affaires/intake-server";
import { beginDriveAuthorization, DRIVE_OAUTH_COOKIE } from "@/lib/affaires/google-drive/oauth";
import { fakeDrive } from "@/lib/affaires/google-drive/memory.test-utils";
import { GET as start } from "../start/route";
import { GET } from "./route";

const key = Buffer.alloc(32, 9);
const origin = "http://localhost:3000";
const returnTo = "/dashboard/affaires/11111111-1111-4111-8111-111111111111";
function begin(userId = "user_demo") {
  return beginDriveAuthorization({ clientId: "fictitious-client", key, redirectUri: `${origin}/api/google-drive/oauth/callback`, returnTo, userId, tenantId: "tenant_demo" });
}
function callback(query: Record<string, string>, cookie?: string) {
  const request = new NextRequest(`${origin}/api/google-drive/oauth/callback?${new URLSearchParams(query)}`);
  if (cookie) request.cookies.set(DRIVE_OAUTH_COOKIE, cookie);
  return GET(request);
}
const outcome = (response: Response) => new URL(response.headers.get("location")!).searchParams.get("drive");
let google: ReturnType<typeof fakeDrive>;
beforeEach(() => {
  google = fakeDrive(); vi.stubGlobal("fetch", google.fetchMock);
  vi.stubEnv("MERGEONE_GOOGLE_DRIVE_ENABLED", "true");
  vi.stubEnv("MERGEONE_GOOGLE_DRIVE_CLIENT_ID", "fictitious-client");
  vi.stubEnv("MERGEONE_GOOGLE_DRIVE_CLIENT_SECRET", "fictitious-secret");
  vi.stubEnv("MERGEONE_GOOGLE_DRIVE_TOKEN_KEY", key.toString("base64"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fictitious-service-role");
  vi.mocked(getAuthenticatedContext).mockResolvedValue({ userId: "user_demo", tenantId: "tenant_demo" } as never);
  vi.mocked(saveDriveConnection).mockResolvedValue("22222222-2222-4222-8222-222222222222");
  vi.mocked(rearmLotsFailedWithConnection).mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("Google Drive OAuth routes", () => {
  it("starts from the signed-in member with an httpOnly state cookie and a safe return", async () => {
    const response = await start(new NextRequest(`${origin}/api/google-drive/oauth/start?returnTo=${encodeURIComponent(returnTo)}`));
    expect(new URL(response.headers.get("location")!).origin).toBe("https://accounts.google.com");
    expect(new URL(response.headers.get("location")!).searchParams.get("redirect_uri")).toBe(`${origin}/api/google-drive/oauth/callback`);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${DRIVE_OAUTH_COOKIE}=v1.`);
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=lax/i); expect(cookie).toContain("Path=/api/google-drive/oauth");
  });
  it("stores the account and returns to the affaire with its id only", async () => {
    const { url, cookie } = begin();
    const response = await callback({ state: url.searchParams.get("state")!, code: "fictitious-code" }, cookie);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe(returnTo);
    expect(Object.fromEntries(location.searchParams)).toEqual({ drive: "connected", driveConnection: "22222222-2222-4222-8222-222222222222" });
    expect(google.tokens[0]).toMatchObject({ grant_type: "authorization_code", code: "fictitious-code", client_secret: "fictitious-secret",
      redirect_uri: `${origin}/api/google-drive/oauth/callback` });
    expect(google.tokens[0].code_verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(vi.mocked(saveDriveConnection).mock.calls[0][2]).toEqual({ permissionId: "google_account_demo", emailAddress: "poc@example.invalid", displayName: "Compte fictif" });
    expect(vi.mocked(saveDriveConnection).mock.calls[0][3]).toMatchObject({ refreshToken: "fictitious-refresh-token" });
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(location.toString()).not.toMatch(/token|code=/);
  });
  it("runs again, once the account is reconnected, the analyses that failed with it", async () => {
    vi.mocked(rearmLotsFailedWithConnection).mockResolvedValue(["upload_failed"]);
    const { url, cookie } = begin();
    expect(outcome(await callback({ state: url.searchParams.get("state")!, code: "fictitious-code" }, cookie))).toBe("connected");
    expect(rearmLotsFailedWithConnection).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_demo", tenantId: "tenant_demo" }),
      "22222222-2222-4222-8222-222222222222");
    expect(after).toHaveBeenCalledTimes(1);
    await (vi.mocked(after).mock.calls[0][0] as () => Promise<void>)();
    expect(processAffaireIntakeUpload).toHaveBeenCalledWith("upload_failed");
  });
  it("keeps the reconnection when the failed analyses cannot be armed again", async () => {
    vi.mocked(rearmLotsFailedWithConnection).mockRejectedValue(new Error("unavailable"));
    const { url, cookie } = begin();
    expect(outcome(await callback({ state: url.searchParams.get("state")!, code: "fictitious-code" }, cookie))).toBe("connected");
    expect(after).not.toHaveBeenCalled();
  });
  it.each([
    ["a wrong state", (state: string) => ({ state: `${state}x`, code: "c" }), "expired"],
    ["a refusal at Google", (state: string) => ({ state, error: "access_denied" }), "refused"],
    ["no code", (state: string) => ({ state }), "failed"],
  ])("ends without any Google call on %s", async (_name, query, expected) => {
    const { url, cookie } = begin();
    expect(outcome(await callback(query(url.searchParams.get("state")!), cookie))).toBe(expected);
    expect(google.fetchMock).not.toHaveBeenCalled();
    expect(saveDriveConnection).not.toHaveBeenCalled();
    expect(rearmLotsFailedWithConnection).not.toHaveBeenCalled();
  });
  it("refuses a return without the cookie or for another member", async () => {
    const { url, cookie } = begin();
    expect(outcome(await callback({ state: url.searchParams.get("state")!, code: "c" }))).toBe("expired");
    vi.mocked(getAuthenticatedContext).mockResolvedValue({ userId: "someone_else", tenantId: "tenant_demo" } as never);
    expect(outcome(await callback({ state: url.searchParams.get("state")!, code: "c" }, cookie))).toBe("expired");
    expect(google.fetchMock).not.toHaveBeenCalled();
  });
});
