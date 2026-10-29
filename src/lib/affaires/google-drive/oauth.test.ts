import { afterEach, describe, expect, it, vi } from "vitest";
import { beginDriveAuthorization, driveOAuthReturn, exchangeDriveCode, readDriveAuthorization, safeDriveReturnPath } from "./oauth";
import { connectionSecretContext, openDriveSecret, sealDriveSecret } from "./secrets";

const key = Buffer.alloc(32, 3);
const start = (now = 1_000) => beginDriveAuthorization({ clientId: "fictitious-client", key, redirectUri: "http://localhost:3000/api/google-drive/oauth/callback",
  returnTo: "/dashboard/affaires/11111111-1111-4111-8111-111111111111", userId: "user_demo", tenantId: "tenant_demo", generation:"44444444-4444-4444-8444-444444444444", now });
afterEach(() => vi.unstubAllGlobals());
describe("Google Drive OAuth boundaries", () => {
  it("asks Google for read-only, durable access with PKCE and a fresh account choice", () => {
    const { url } = start();
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(["scope", "access_type", "prompt", "response_type", "code_challenge_method", "include_granted_scopes"]
      .map((name) => [name, url.searchParams.get(name)]))).toEqual({ scope: "https://www.googleapis.com/auth/drive.readonly",
      access_type: "offline", prompt: "consent select_account", response_type: "code", code_challenge_method: "S256", include_granted_scopes: "false" });
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("keeps the verifier in a sealed cookie bound to the member and to ten minutes", () => {
    const { url, cookie } = start();
    const authorization = readDriveAuthorization(key, cookie, 2_000)!;
    expect(authorization).toMatchObject({ state: url.searchParams.get("state"), userId: "user_demo", tenantId: "tenant_demo",
      returnTo: "/dashboard/affaires/11111111-1111-4111-8111-111111111111" });
    expect(cookie).not.toContain(authorization.verifier);
    expect(readDriveAuthorization(key, cookie, 1_000 + 600_001)).toBeNull();
    expect(readDriveAuthorization(Buffer.alloc(32, 4), cookie, 2_000)).toBeNull();
    expect(readDriveAuthorization(key, `${cookie.slice(0, -2)}AA`, 2_000)).toBeNull();
    expect(readDriveAuthorization(key, undefined)).toBeNull();
  });
  it.each(["https://example.invalid", "//example.invalid", "/dashboard/../login", "/login", "/dashboard?x=1", "/dashboard/a//b", null])
    ("returns only to a dashboard page (%s)", (value) => {
      expect(safeDriveReturnPath(value)).toBe("/dashboard");
    });
  it("puts only an outcome code in the return address", () => {
    expect(driveOAuthReturn("http://localhost:3000", "https://example.invalid", "connected", "c1").toString())
      .toBe("http://localhost:3000/dashboard?drive=connected&driveConnection=c1");
  });
  it.each([
    [{ scope: "openid" }, "DRIVE_SCOPE_REFUSED"],
    [{ refresh_token: undefined }, "DRIVE_OFFLINE_REFUSED"],
  ])("refuses a grant without durable Drive read access (%j)", async (patch, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ access_token: "a", expires_in: 3600, refresh_token: "r",
      scope: "https://www.googleapis.com/auth/drive.readonly", ...patch })));
    await expect(exchangeDriveCode({ clientId: "c", clientSecret: "s", code: "x", verifier: "v", redirectUri: "http://localhost/cb" }))
      .rejects.toMatchObject({ code });
  });
  it("binds a sealed refresh token to its member and Google account", () => {
    const sealed = sealDriveSecret(key, "refresh", connectionSecretContext("tenant", "user", "account"));
    expect(openDriveSecret(key, sealed, connectionSecretContext("tenant", "user", "account"))).toBe("refresh");
    expect(() => openDriveSecret(key, sealed, connectionSecretContext("tenant", "other", "account"))).toThrow("illisible");
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});
