import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertLocalChatGptHost, beginLocalChatGptSignIn, relayLocalChatGptCallback, disconnectLocalChatGpt,
  finishLocalChatGptSignIn, getLocalChatGptCredential, getLocalChatGptState,
} from "@/lib/ai/chatgpt-local-auth";
import { readChatGptStore, saveChatGptStore, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";

const owner = { userId: "user-a", tenantId: "tenant-a" };
const origin = "http://127.0.0.1:3000";
let directory: string;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;

beforeAll(async () => {
  keys = await generateKeyPair("RS256"); publicJwk = await exportJWK(keys.publicKey);
});
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mergeone-chatgpt-auth-"));
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "1"); vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL", ""); vi.stubEnv("CI", ""); vi.stubEnv("PORT", ""); vi.stubEnv("MERGEONE_DEV_HOSTS", "");
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });

async function authorize(target: ChatGptOwner = owner, profileId?: string, claims: Record<string, unknown> = {}, issuedClientId = "oaiapp_test", sourceOrigin = origin) {
  const start = await beginLocalChatGptSignIn(target, sourceOrigin, profileId);
  const authorization = new URL(start.url);
  const clientId = profileId ? authorization.searchParams.get("client_id")! : issuedClientId;
  const idToken = await new SignJWT({ nonce: authorization.searchParams.get("nonce"), email: "fixture@example.test", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer("https://auth.openai.com")
    .setSubject("account-a").setAudience(clientId).setExpirationTime("5m").sign(keys.privateKey);
  const fetchMock = vi.fn(async (url: string | URL) => {
    if (String(url).endsWith("jwks.json")) return Response.json({ keys: [{ ...publicJwk, kid: "fixture", alg: "RS256" }] });
    return Response.json({ access_token: "fixture-access", refresh_token: "fixture-refresh", id_token: idToken,
      token_type: "Bearer", expires_in: 3600, scope: "openid resource.invoke chatgpt.tokens.use.direct" });
  });
  vi.stubGlobal("fetch", fetchMock);
  const callback = new URL(`${sourceOrigin}/auth/chatgpt/callback`);
  callback.search = new URLSearchParams({ state: start.state, client_id: clientId, code: "fixture-code" }).toString();
  return { start, authorization, callback, fetchMock };
}

describe("local ChatGPT authorization", () => {
  it("accepts an opaque issued client ID when the signed token audience matches", async () => {
    const { start, callback } = await authorize(owner, undefined, {}, "agent_fixture_opaque");
    await finishLocalChatGptSignIn(owner, callback, start.state);
    const store = await readChatGptStore(owner);
    expect(store.profiles[0].clientId).toBe("agent_fixture_opaque");
    expect((await getLocalChatGptState(owner)).sharing).toBe(true);
  });
  it("still rejects a token audience that does not match that opaque client ID", async () => {
    const { start, callback } = await authorize(owner, undefined, {}, "agent_fixture_opaque");
    const wrongAudience = await new SignJWT({ nonce: new URL(start.url).searchParams.get("nonce") })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer("https://auth.openai.com")
      .setSubject("account-a").setAudience("another-client").setExpirationTime("5m").sign(keys.privateKey);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => String(url).endsWith("jwks.json")
      ? Response.json({ keys: [{ ...publicJwk, kid: "fixture", alg: "RS256" }] })
      : Response.json({ access_token: "fixture-access", id_token: wrongAudience, token_type: "Bearer", expires_in: 3600 })));
    await expect(finishLocalChatGptSignIn(owner, callback, start.state)).rejects.toMatchObject({ reason: "identity" });
    expect((await readChatGptStore(owner)).selectedId).toBeNull();
  });
  it("rejects the bootstrap client ID and a changed returning client before exchange", async () => {
    const first = await authorize();
    first.callback.searchParams.set("client_id", "dynamic_agent_client");
    await expect(finishLocalChatGptSignIn(owner, first.callback, first.start.state)).rejects.toMatchObject({ reason: "registration" });
    expect(first.fetchMock).not.toHaveBeenCalled();
    const next = await authorize(); await finishLocalChatGptSignIn(owner, next.callback, next.start.state);
    const profile = (await readChatGptStore(owner)).profiles[0];
    const returning = await authorize(owner, profile.id);
    returning.callback.searchParams.set("client_id", "agent_different_registration");
    await expect(finishLocalChatGptSignIn(owner, returning.callback, returning.start.state)).rejects.toMatchObject({ reason: "registration" });
    expect(returning.fetchMock).not.toHaveBeenCalled();
  });
  it("persists only owner identifiers when passed a richer authenticated context", async () => {
    const circular: { self?: unknown } = {}; circular.self = circular;
    const context = { ...owner, supabase: circular };
    const start = await beginLocalChatGptSignIn(context, origin);
    const pending = JSON.parse(await readFile(path.join(directory, ".private", "chatgpt-local", `pending-${start.state}.json`), "utf8"));
    expect(pending).toMatchObject(owner); expect(pending).not.toHaveProperty("supabase");
  });
  it("accepts loopback on the dev port and an extra host from MERGEONE_DEV_HOSTS", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "");
    for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
      expect(assertLocalChatGptHost(host)).toBe(`http://${host}`);
    }
    expect(assertLocalChatGptHost("127.0.0.1:3000", "https")).toBe("https://127.0.0.1:3000");
    expect(() => assertLocalChatGptHost("127.0.0.1:3015")).toThrow();
    vi.stubEnv("PORT", "3015");
    expect(assertLocalChatGptHost("localhost:3015")).toBe("http://localhost:3015");
    expect(assertLocalChatGptHost("[::1]:3015")).toBe("http://[::1]:3015");
    expect(() => assertLocalChatGptHost("127.0.0.1:3000")).toThrow();
    vi.stubEnv("PORT", "");
    vi.stubEnv("MERGEONE_DEV_HOSTS", "mergeone.dev.test,192.168.1.42");
    expect(assertLocalChatGptHost("mergeone.dev.test", "https")).toBe("https://mergeone.dev.test");
    expect(assertLocalChatGptHost("192.168.1.42:3000")).toBe("http://192.168.1.42:3000");
    const start = await beginLocalChatGptSignIn(owner, "https://mergeone.dev.test");
    const pending = JSON.parse(await readFile(path.join(directory, ".private", "chatgpt-local", `pending-${start.state}.json`), "utf8"));
    expect(pending.returnOrigin).toBe("https://mergeone.dev.test");
    const callback = new URL(`${origin}/auth/chatgpt/callback?state=${start.state}&code=fixture-code`);
    const returned = await relayLocalChatGptCallback(callback);
    expect(returned?.origin).toBe("https://mergeone.dev.test");
    expect(returned?.searchParams.get("code")).toBe("fixture-code");
  });
  it("refuses an unlisted host or an unexpected forwarded protocol before storing a return origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const source of ["http://192.168.1.42:3000", "http://192.168.1.42", "https://mergeone.dev.test", "http://mergeone.dev.test:3000", "http://evil.test"]) {
      expect(() => assertLocalChatGptHost(new URL(source).host, new URL(source).protocol.slice(0, -1))).toThrow();
      await expect(beginLocalChatGptSignIn(owner, source)).rejects.toThrow();
    }
    for (const protocol of ["javascript", "https://evil.test", "", "http,https", "ftp"]) {
      expect(() => assertLocalChatGptHost("127.0.0.1:3000", protocol)).toThrow();
    }
    for (const host of ["2130706433:3000", "127.1:3000", "127.0.0.1.nip.io:3000", "localhost.:3000"]) {
      expect(() => assertLocalChatGptHost(host)).toThrow();
    }
    const names = await readdir(path.join(directory, ".private", "chatgpt-local")).catch(() => [] as string[]);
    expect(names.filter((name) => name.startsWith("pending-"))).toEqual([]);
    const planted = await beginLocalChatGptSignIn(owner, origin);
    const file = path.join(directory, ".private", "chatgpt-local", `pending-${planted.state}.json`);
    const pending = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...pending, returnOrigin: "http://192.168.1.42:3000" }));
    await expect(relayLocalChatGptCallback(new URL(`${origin}/auth/chatgpt/callback?state=${planted.state}&code=fixture-code`))).rejects.toMatchObject({ reason: "callback" });
    await writeFile(file, JSON.stringify({ ...pending, returnOrigin: "https://mergeone.dev.test" }));
    await expect(relayLocalChatGptCallback(new URL(`${origin}/auth/chatgpt/callback?state=${planted.state}&code=fixture-code`))).rejects.toMatchObject({ reason: "callback" });
  });
  it("rejects malformed authorities and protocols and always disables production", () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const host of [null, "", "user@evil.test", "example.test/path", "example.test?x=1", "example.test#x", " example.test", "example.test\\evil.test", "example.test:bad"]) {
      expect(() => assertLocalChatGptHost(host)).toThrow();
    }
    expect(() => assertLocalChatGptHost("localhost:3000", "javascript")).toThrow();
    vi.stubEnv("NODE_ENV", "production");
    for (const host of ["localhost:3000", "127.0.0.1:3000", "mergeone.dev.test"]) expect(() => assertLocalChatGptHost(host)).toThrow();
  });

  it("uses the supported loopback redirect and returns to the initiating browser origin", async () => {
    vi.stubEnv("MERGEONE_DEV_HOSTS", "mergeone.dev.test");
    const source = "https://mergeone.dev.test";
    const start = await beginLocalChatGptSignIn(owner, source);
    const callback = new URL(new URL(start.url).searchParams.get("redirect_uri")!);
    expect(callback.origin).toBe(origin);
    callback.search = new URLSearchParams({ state: start.state, error: "access_denied" }).toString();
    const returned = await relayLocalChatGptCallback(callback);
    expect(returned?.origin).toBe(source);
    expect(returned?.search).toBe(callback.search);
    expect(await relayLocalChatGptCallback(returned!)).toBeNull();
    await expect(finishLocalChatGptSignIn(owner, returned!, "wrong-browser")).rejects.toMatchObject({ reason: "state" });
    await expect(finishLocalChatGptSignIn(owner, returned!, start.state)).rejects.toMatchObject({ reason: "cancelled" });
    await expect(relayLocalChatGptCallback(callback)).rejects.toMatchObject({ reason: "missing" });
  });
  it("exchanges the supported loopback URI after a signed login from localhost", async () => {
    const { start, authorization, callback } = await authorize(owner, undefined, {}, "agent_fixture", "http://localhost:3000");
    const redirectUri = authorization.searchParams.get("redirect_uri");
    expect(redirectUri).toBe(`${origin}/auth/chatgpt/callback`);
    const transport = vi.mocked(fetch);
    await finishLocalChatGptSignIn(owner, callback, start.state);
    expect((await getLocalChatGptState(owner)).sharing).toBe(true);
    const exchange = transport.mock.calls.find(([url]) => String(url).endsWith("/oauth/token"));
    expect((exchange?.[1]?.body as URLSearchParams).get("redirect_uri")).toBe(redirectUri);
  });

  it("rejects a changed relay port/path or return origin before token exchange", async () => {
    const start = await beginLocalChatGptSignIn(owner, "http://localhost:3000");
    for (const bad of ["http://127.0.0.1:3015/auth/chatgpt/callback", `${origin}/wrong-path`, "https://other.dev.test/auth/chatgpt/callback"]) {
      const callback = new URL(bad); callback.searchParams.set("state", start.state);
      await expect(relayLocalChatGptCallback(callback)).rejects.toMatchObject({ reason: "callback" });
    }
    const forged = new URL(`https://other.dev.test/auth/chatgpt/callback?state=${start.state}&error=access_denied`);
    await expect(finishLocalChatGptSignIn(owner, forged, start.state)).rejects.toMatchObject({ reason: "callback" });
  });

  it("never relays a callback with an unknown, malformed or expired state", async () => {
    await expect(relayLocalChatGptCallback(new URL(`${origin}/auth/chatgpt/callback?state=../other`))).rejects.toMatchObject({ reason: "state" });
    const start = await beginLocalChatGptSignIn(owner, "http://localhost:3000");
    const file = path.join(directory, ".private", "chatgpt-local", `pending-${start.state}.json`);
    const pending = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...pending, expiresAt: 1 }));
    await expect(relayLocalChatGptCallback(new URL(`${origin}/auth/chatgpt/callback?state=${start.state}`))).rejects.toMatchObject({ reason: "expired" });
  });

  it("uses a stable host, new PKCE per attempt, verifies a signed identity, and consumes the callback once", async () => {
    const { start, authorization, callback, fetchMock } = await authorize();
    const again = new URL((await beginLocalChatGptSignIn(owner, origin)).url);
    expect(again.searchParams.get("ext_agent_host_id")).toBe(authorization.searchParams.get("ext_agent_host_id"));
    expect(again.searchParams.get("code_challenge")).not.toBe(authorization.searchParams.get("code_challenge"));
    await finishLocalChatGptSignIn(owner, callback, start.state);
    const state = await getLocalChatGptState(owner);
    expect(state.sharing).toBe(true); expect(state.profiles[0].email).toBe("fixture@example.test");
    expect(JSON.stringify(state)).not.toContain("fixture-access");
    const body = fetchMock.mock.calls.map((call) => call[0]);
    expect(body).toContain("https://auth.openai.com/api/accounts/oauth/token");
    await expect(finishLocalChatGptSignIn(owner, callback, start.state)).rejects.toThrow();
    const files = await readdir(path.join(directory, ".private", "chatgpt-local"));
    for (const file of files) expect((await stat(path.join(directory, ".private", "chatgpt-local", file))).mode & 0o777).toBe(0o600);
  });

  it("rejects a foreign browser or tenant before exchanging a code", async () => {
    const { start, callback, fetchMock } = await authorize();
    await expect(finishLocalChatGptSignIn(owner, callback, "different-browser")).rejects.toThrow();
    await expect(finishLocalChatGptSignIn({ ...owner, tenantId: "tenant-b" }, callback, start.state)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await readChatGptStore(owner)).profiles).toHaveLength(0);
  });

  it("rejects a nonce mismatch and preserves issued registration for a fresh attempt", async () => {
    const { start, callback } = await authorize(owner, undefined, { nonce: "wrong-nonce" });
    await expect(finishLocalChatGptSignIn(owner, callback, start.state)).rejects.toThrow();
    const store = await readChatGptStore(owner);
    expect(store.selectedId).toBeNull(); expect(store.profiles[0].accessToken).toBeUndefined();
    const retry = new URL((await beginLocalChatGptSignIn(owner, origin, store.profiles[0].id)).url);
    expect(retry.searchParams.get("client_id")).toBe("oaiapp_test"); expect(retry.searchParams.has("agent_name_hint")).toBe(false);
  });

  it("serializes refreshes, persists rotating tokens, and isolates another user and tenant", async () => {
    const { start, callback } = await authorize(); await finishLocalChatGptSignIn(owner, callback, start.state);
    const store = await readChatGptStore(owner); store.profiles[0].expiresAt = 0; await saveChatGptStore(owner, store);
    const fetchMock = vi.fn(async () => Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", token_type: "Bearer", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    const results = await Promise.all([getLocalChatGptCredential(owner), getLocalChatGptCredential(owner)]);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(results.map((item) => item?.accessToken)).toEqual(["rotated-access", "rotated-access"]);
    expect((await readChatGptStore(owner)).profiles[0].refreshToken).toBe("rotated-refresh");
    expect(await getLocalChatGptCredential({ ...owner, userId: "user-b" })).toBeNull();
    expect(await getLocalChatGptCredential({ ...owner, tenantId: "tenant-b" })).toBeNull();
  });

  it("clears local credentials and reports unconfirmed remote revocation while retaining the registration", async () => {
    const { start, callback } = await authorize(); await finishLocalChatGptSignIn(owner, callback, start.state);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await disconnectLocalChatGpt(owner)).toEqual({ revocationConfirmed: false });
    const store = await readChatGptStore(owner);
    expect(store.selectedId).toBeNull(); expect(store.profiles[0].clientId).toBe("oaiapp_test");
    const file = (await readdir(path.join(directory, ".private", "chatgpt-local"))).find((entry) => entry !== "host.json")!;
    expect(await readFile(path.join(directory, ".private", "chatgpt-local", file), "utf8")).not.toContain("fixture-refresh");
  });
});
