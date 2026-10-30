import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";

const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "session@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
function session(expiresAt: number) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expiresAt })}.c3ludGhldGlj`, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, user };
}
let signingKeyCount = 0;
async function asymmetricSession() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  // A new key id per session: the SDK caches the signing keys across clients.
  const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: `review-key-${++signingKeyCount}`, alg: "ES256", use: "sig" };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const signed = `${encode({ alg: "ES256", typ: "JWT", kid: jwk.kid })}.${encode({ sub: user.id, role: "authenticated", exp: expiresAt })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(signed));
  const stored = { ...session(expiresAt), access_token: `${signed}.${Buffer.from(signature).toString("base64url")}` };
  return { jwk, cookie: `sb-auth-review-auth-token=base64-${Buffer.from(JSON.stringify(stored)).toString("base64url")}` };
}
function request(path: string) {
  const value = Buffer.from(JSON.stringify(session(Math.floor(Date.now() / 1000) - 300))).toString("base64url");
  return new NextRequest(`https://app.example.invalid${path}`, { headers: { cookie: `sb-auth-review-auth-token=base64-${value}` } });
}

describe("session refresh response security with the installed SSR SDK", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth-review.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public-key");
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.origin !== "https://auth-review.invalid") throw new Error("Real network access is forbidden");
      if (url.pathname === "/auth/v1/token") return Response.json(session(Math.floor(Date.now() / 1000) + 3600));
      if (url.pathname === "/auth/v1/user") return Response.json(user);
      throw new Error("Unexpected Auth endpoint");
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it.each(["/", "/login", "/signup", "/api/docs/swagger-ui/swagger-ui.css"])("keeps renewed cookies private and secure on %s", async (path) => {
    const req = request(path);
    const response = await proxy(req);
    expect(response.cookies.getAll().length).toBeGreaterThan(0);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    for (const cookie of response.cookies.getAll()) {
      expect(cookie.secure).toBe(true);
      expect(cookie.sameSite).toBe("lax");
      expect(req.cookies.get(cookie.name)?.value).toBe(cookie.value);
    }
    expect(response.status).toBe(path === "/login" || path === "/signup" ? 307 : 200);
  });

  it("verifies an asymmetric session with the cached signing keys, asking Auth only before leaving the login page", async () => {
    const { cookie, jwk } = await asymmetricSession();
    const authCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      authCalls.push(url.pathname);
      if (url.pathname === "/auth/v1/.well-known/jwks.json") return Response.json({ keys: [jwk] });
      if (url.pathname === "/auth/v1/user") return Response.json(user);
      throw new Error("Unexpected Auth endpoint");
    }));

    const dashboard = await proxy(new NextRequest("https://app.example.invalid/dashboard/affaires", { headers: { cookie } }));
    const prefetch = await proxy(new NextRequest("https://app.example.invalid/dashboard/estimates?_rsc=1", { headers: { cookie } }));
    expect(dashboard.status).toBe(200);
    expect(prefetch.status).toBe(200);
    expect(authCalls).toEqual(["/auth/v1/.well-known/jwks.json"]);

    const login = await proxy(new NextRequest("https://app.example.invalid/login", { headers: { cookie } }));
    expect(login.status).toBe(307);
    expect(login.headers.get("location")).toBe("https://app.example.invalid/dashboard");
    expect(authCalls).toEqual(["/auth/v1/.well-known/jwks.json", "/auth/v1/user"]);
  });

  it("keeps the login page open for a deleted account whose token is still validly signed", async () => {
    const { cookie, jwk } = await asymmetricSession();
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/auth/v1/.well-known/jwks.json") return Response.json({ keys: [jwk] });
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ code: "user_not_found", msg: "User from sub claim in JWT does not exist" }, { status: 403 });
      }
      throw new Error("Unexpected Auth endpoint");
    }));

    // The dashboard's own getUser check sends this account to /login: a redirect back would loop.
    const login = await proxy(new NextRequest("https://app.example.invalid/login", { headers: { cookie } }));
    expect(login.status).toBe(200);
    expect(login.headers.get("location")).toBeNull();
  });

  it("clears a rejected session and preserves protection on the login redirect", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "refresh_token_not_found", msg: "Invalid Refresh Token" }, { status: 400 })));
    const response = await proxy(request("/dashboard/memberships"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.invalid/login");
    expect(response.cookies.getAll().length).toBeGreaterThan(0);
    expect(response.cookies.getAll().every((cookie) => cookie.maxAge === 0 && cookie.secure)).toBe(true);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
