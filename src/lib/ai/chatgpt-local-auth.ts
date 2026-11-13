import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, rename, rm } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

import { ChatGptSignInError } from "@/lib/ai/chatgpt-sign-in-errors";

import {
  getChatGptHostId, localChatGptDirectory, readChatGptStore, saveChatGptStore,
  withChatGptLock, writePrivateJson,
  type ChatGptOwner, type ChatGptProfile,
} from "@/lib/ai/chatgpt-local-store";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const CHATGPT_COOKIE = "mergeone-chatgpt-transaction";
export const CHATGPT_CALLBACK = "/auth/chatgpt/callback";
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const transactionSchema = z.object({
  state: z.string(), nonce: z.string(), verifier: z.string(), redirectUri: z.string(),
  returnOrigin: z.string().optional(),
  userId: z.string(), tenantId: z.string(), expiresAt: z.number(),
  profileId: z.string().nullable(), clientId: z.string(),
});
const tokenSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(), token_type: z.string(),
  expires_in: z.number().positive().max(604800), scope: z.string().optional(),
});

export function isLocalChatGptEnabled() {
  // Development enables the personal integration. The host allowlist is separate.
  // Test/CLI opt-in remains explicit; a production build can never enable it.
  return process.env.NODE_ENV === "development" ||
    (process.env.NODE_ENV !== "production" && process.env.MERGEONE_CHATGPT_LOCAL === "1" && !process.env.VERCEL && !process.env.CI);
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const INVALID_DEV_ORIGIN = "Adresse du serveur de développement invalide.";
const INVALID_DEV_HOSTS = "MERGEONE_DEV_HOSTS doit contenir des noms d’hôte exacts séparés par des virgules, sans protocole, port ni joker.";

function developmentPort() {
  const value = process.env.PORT ?? "";
  if (/^[1-9]\d{0,4}$/.test(value)) {
    const port = Number(value);
    if (port <= 65535) return String(port);
  }
  return "3000";
}

function canonicalHostname(hostname: string) {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return bare.toLowerCase();
}

/** The name the client sent, before the URL parser rewrites aliases such as 127.1. */
function sentHostname(host: string) {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    const rest = end === -1 ? "invalid" : host.slice(end + 1);
    if (end <= 1 || (rest !== "" && !/^:\d+$/.test(rest))) throw new Error(INVALID_DEV_ORIGIN);
    return host.slice(1, end).toLowerCase();
  }
  const separator = host.lastIndexOf(":");
  if (separator !== -1) {
    if (host.indexOf(":") !== separator || !/^\d+$/.test(host.slice(separator + 1))) throw new Error(INVALID_DEV_ORIGIN);
    return host.slice(0, separator).toLowerCase();
  }
  return host.toLowerCase();
}

function explicitDevelopmentHosts(raw = process.env.MERGEONE_DEV_HOSTS ?? "") {
  const hosts = new Set<string>();
  for (const entry of raw.split(",")) {
    const host = entry.trim().toLowerCase();
    if (!host) continue;
    const address = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    if (isIP(address) === 6) {
      hosts.add(address.toLowerCase());
      continue;
    }
    if (isIP(address) === 4) {
      hosts.add(address);
      continue;
    }
    if (host.includes(":") || host.length > 253 || !host.split(".").every((label) =>
      label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
      throw new Error(INVALID_DEV_HOSTS);
    }
    hosts.add(host);
  }
  return hosts;
}

export function assertLocalChatGptHost(host: string | null, protocol: string | null = "http") {
  if (!isLocalChatGptEnabled()) throw new Error("ChatGPT est disponible uniquement en développement.");
  // Only an exact http or https scheme. Null means the header was absent.
  const scheme = (protocol ?? "http").toLowerCase();
  if ((scheme !== "http" && scheme !== "https") || !host || /[\s/@\\?#]/.test(host)) {
    throw new Error(INVALID_DEV_ORIGIN);
  }
  let url: URL;
  try { url = new URL(`${scheme}://${host}`); }
  catch { throw new Error(INVALID_DEV_ORIGIN); }
  const hostname = canonicalHostname(url.hostname);
  const port = url.port || (scheme === "https" ? "443" : "80");
  if (!hostname || sentHostname(host) !== hostname || url.pathname !== "/" || url.search || url.hash ||
    url.username || url.password || url.protocol !== `${scheme}:`) {
    throw new Error(INVALID_DEV_ORIGIN);
  }
  const devPort = developmentPort();
  const loopback = LOOPBACK_HOSTS.has(hostname) && port === devPort;
  // Extra names only. Network interfaces from resolveDevelopmentOrigins stay out of this list.
  const listed = explicitDevelopmentHosts().has(hostname) && (url.port === "" || url.port === devPort);
  if (!loopback && !listed) throw new Error(INVALID_DEV_ORIGIN);
  return url.origin;
}

/** Refuse before returnOrigin is written, and again before a relay or token exchange. */
function requireAllowlistedOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error(INVALID_DEV_ORIGIN); }
  const checked = assertLocalChatGptHost(url.host, url.protocol.slice(0, -1));
  if (checked !== value) throw new Error(INVALID_DEV_ORIGIN);
  return checked;
}

export function hasLocalChatGptPlanAccess(profile: ChatGptProfile) {
  return Boolean(profile.accessToken && profile.scopes.includes(PLAN_SCOPE) &&
    ((profile.expiresAt ?? 0) > Date.now() + 60_000 || profile.refreshToken));
}

export async function getLocalChatGptState(owner: ChatGptOwner) {
  const store = await readChatGptStore(owner);
  const selected = store.profiles.find((profile) => profile.id === store.selectedId);
  return {
    enabled: true as const,
    selectedId: store.selectedId,
    model: selected?.model ?? null,
    reasoningEffort: selected?.reasoningEffort ?? null,
    sharing: selected ? hasLocalChatGptPlanAccess(selected) : false,
    profiles: store.profiles.map((profile, index) => ({
      id: profile.id, email: profile.email, label: `Connexion ${index + 1}`,
      connected: Boolean(profile.accessToken), sharing: hasLocalChatGptPlanAccess(profile),
    })),
  };
}

export async function beginLocalChatGptSignIn(owner: ChatGptOwner, origin: string, profileId?: string) {
  const returnOrigin = requireAllowlistedOrigin(origin);
  const store = await readChatGptStore(owner);
  const profile = profileId ? store.profiles.find((entry) => entry.id === profileId) : null;
  if (profileId && !profile) throw new Error("Connexion ChatGPT introuvable.");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const transaction = {
    userId: owner.userId, tenantId: owner.tenantId,
    state, nonce, verifier,
    redirectUri: `http://127.0.0.1:${developmentPort()}${CHATGPT_CALLBACK}`,
    returnOrigin,
    expiresAt: Date.now() + 10 * 60_000, profileId: profile?.id ?? null,
    clientId: profile?.clientId ?? "dynamic_agent_client",
  };
  await writePrivateJson(path.join(await localChatGptDirectory(), `pending-${state}.json`), transaction);
  const url = new URL(`${ISSUER}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: transaction.clientId,
    ...(profile ? {} : { agent_name_hint: "MergeOne" }),
    ext_agent_host_id: await getChatGptHostId(),
    response_type: "code", redirect_uri: transaction.redirectUri,
    scope: `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`,
    resource: RESOURCE, state, nonce, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  // No ID-token hint in URLs: the account selector remains explicit.
  return { url: url.toString(), state };
}

async function requestTokens(body: URLSearchParams) {
  let response: Response;
  try {
    response = await fetch(`${ISSUER}/api/accounts/oauth/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body, signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
  } catch { throw new ChatGptSignInError("network"); }
  if (!response.ok) throw new ChatGptSignInError(body.get("grant_type") === "refresh_token" ? "renewal" : "exchange");
  try { return tokenSchema.parse(await response.json()); }
  catch { throw new ChatGptSignInError("response"); }
}

/** Relay the provider's loopback callback to the initiating development origin.
 * The original origin still checks the browser cookie, session and tenant before
 * consuming the transaction or exchanging the PKCE-bound code.
 */
export async function relayLocalChatGptCallback(url: URL): Promise<URL | null> {
  const state = url.searchParams.get("state");
  if (!state || !/^[\w-]{43}$/.test(state)) throw new ChatGptSignInError("state");
  let transaction: z.infer<typeof transactionSchema>;
  try {
    transaction = transactionSchema.parse(JSON.parse(await readFile(path.join(await localChatGptDirectory(), `pending-${state}.json`), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ChatGptSignInError("missing");
    throw error;
  }
  if (transaction.state !== state) throw new ChatGptSignInError("state");
  if (transaction.expiresAt < Date.now()) throw new ChatGptSignInError("expired");
  let returnOrigin: string;
  try { returnOrigin = requireAllowlistedOrigin(transaction.returnOrigin ?? new URL(transaction.redirectUri).origin); }
  catch { throw new ChatGptSignInError("callback"); }
  if (url.pathname !== CHATGPT_CALLBACK) throw new ChatGptSignInError("callback");
  if (url.origin === returnOrigin) return null;
  if (transaction.redirectUri !== `${url.origin}${url.pathname}`) throw new ChatGptSignInError("callback");
  const callback = new URL(CHATGPT_CALLBACK, returnOrigin);
  callback.search = url.search;
  return callback;
}

export async function finishLocalChatGptSignIn(owner: ChatGptOwner, url: URL, cookieState?: string) {
  const state = url.searchParams.get("state");
  if (!state || !/^[\w-]{43}$/.test(state) || cookieState !== state) throw new ChatGptSignInError("state");
  const directory = await localChatGptDirectory();
  const pending = path.join(directory, `pending-${state}.json`);
  const consumed = `${pending}.consumed-${randomUUID()}`;
  // Atomic consume prevents replay, including across server processes.
  try { await rename(pending, consumed); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ChatGptSignInError("missing");
    throw error;
  }
  try {
    const transaction = transactionSchema.parse(JSON.parse(await readFile(consumed, "utf8")));
    if (transaction.expiresAt < Date.now()) throw new ChatGptSignInError("expired");
    if (transaction.userId !== owner.userId || transaction.tenantId !== owner.tenantId) throw new ChatGptSignInError("owner");
    let returnOrigin: string;
    try { returnOrigin = requireAllowlistedOrigin(transaction.returnOrigin ?? new URL(transaction.redirectUri).origin); }
    catch { throw new ChatGptSignInError("callback"); }
    if (`${returnOrigin}${CHATGPT_CALLBACK}` !== `${url.origin}${url.pathname}`) throw new ChatGptSignInError("callback");
    if (url.searchParams.has("error")) {
      throw new ChatGptSignInError(url.searchParams.get("error") === "access_denied" ? "cancelled" : "provider");
    }
    const code = url.searchParams.get("code");
    const issuedId = url.searchParams.get("client_id");
    const clientId = issuedId ?? transaction.clientId;
    // OAuth client IDs are opaque. The documented oaiapp_ prefix is an example,
    // not an identity check; the issued ID must still match the verified audience.
    if (!code || !clientId || clientId === "dynamic_agent_client" || clientId.length > 512 ||
      (transaction.profileId && clientId !== transaction.clientId)) throw new ChatGptSignInError("registration");

    // Persist a new issued registration before code exchange, even if that code expires.
    await withChatGptLock(owner, async () => {
      const store = await readChatGptStore(owner);
      let profile = transaction.profileId ? store.profiles.find((item) => item.id === transaction.profileId) : undefined;
      if (transaction.profileId && !profile) throw new Error("Connexion ChatGPT introuvable.");
      if (!profile) {
        profile = { id: randomUUID(), clientId, issuer: ISSUER, subject: "", email: "", model: null, reasoningEffort: null, scopes: [] };
        store.profiles.push(profile);
        await saveChatGptStore(owner, store);
      }
      const tokens = await requestTokens(new URLSearchParams({
        grant_type: "authorization_code", client_id: clientId, code,
        code_verifier: transaction.verifier, redirect_uri: transaction.redirectUri, resource: RESOURCE,
      }));
      if (!tokens.id_token || tokens.token_type.toLowerCase() !== "bearer") throw new ChatGptSignInError("response");
      const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: ISSUER, audience: clientId, algorithms: ["RS256"], requiredClaims: ["exp", "sub", "nonce"] })
        .catch(() => { throw new ChatGptSignInError("identity"); });
      if (payload.nonce !== transaction.nonce || !payload.sub ||
        (profile.subject && payload.sub !== profile.subject)) throw new ChatGptSignInError("identity");
      Object.assign(profile, {
        subject: payload.sub, email: typeof payload.email === "string" ? payload.email : "Compte ChatGPT",
        accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token,
        expiresAt: Date.now() + tokens.expires_in * 1000, scopes: (tokens.scope ?? "").split(/\s+/).filter(Boolean),
      });
      store.selectedId = profile.id;
      await saveChatGptStore(owner, store);
    });
  } finally {
    await rm(consumed, { force: true });
  }
}

export async function getLocalChatGptCredential(owner: ChatGptOwner) {
  return withChatGptLock(owner, async () => {
    const store = await readChatGptStore(owner);
    const profile = store.profiles.find((item) => item.id === store.selectedId);
    if (!profile) return null;
    if (!hasLocalChatGptPlanAccess(profile)) throw new Error("Autorisez l’utilisation du forfait ChatGPT en reconnectant le compte.");
    if ((profile.expiresAt ?? 0) <= Date.now() + 60_000) {
      if (!profile.refreshToken) throw new Error("Reconnectez ChatGPT pour renouveler l’accès.");
      const tokens = await requestTokens(new URLSearchParams({
        grant_type: "refresh_token", client_id: profile.clientId,
        refresh_token: profile.refreshToken, resource: RESOURCE,
      }));
      if (tokens.token_type.toLowerCase() !== "bearer") throw new Error("Accès ChatGPT invalide.");
      profile.accessToken = tokens.access_token;
      profile.refreshToken = tokens.refresh_token ?? profile.refreshToken;
      profile.expiresAt = Date.now() + tokens.expires_in * 1000;
      if (tokens.scope !== undefined) profile.scopes = tokens.scope.split(/\s+/).filter(Boolean);
      await saveChatGptStore(owner, store);
      if (!hasLocalChatGptPlanAccess(profile)) throw new Error("Le forfait ChatGPT n’est plus autorisé. Reconnectez le compte.");
    }
    return { accessToken: profile.accessToken!, model: profile.model, reasoningEffort: profile.reasoningEffort ?? null, profileId: profile.id };
  });
}

export async function selectLocalChatGptProfile(owner: ChatGptOwner, profileId: string) {
  await withChatGptLock(owner, async () => {
    const store = await readChatGptStore(owner);
    if (!store.profiles.some((item) => item.id === profileId)) throw new Error("Connexion ChatGPT introuvable.");
    store.selectedId = profileId;
    await saveChatGptStore(owner, store);
  });
}

export async function disconnectLocalChatGpt(owner: ChatGptOwner) {
  return withChatGptLock(owner, async () => {
    const store = await readChatGptStore(owner);
    const profile = store.profiles.find((item) => item.id === store.selectedId);
    let revocationConfirmed = !profile?.refreshToken;
    if (profile?.refreshToken) {
      try {
        const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
        const config = z.object({ issuer: z.literal(ISSUER), revocation_endpoint: z.url() }).parse(await discovery.json());
        const endpoint = new URL(config.revocation_endpoint);
        if (endpoint.origin !== ISSUER) throw new Error("Endpoint inattendu.");
        const response = await fetch(endpoint, {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: profile.refreshToken, token_type_hint: "refresh_token", client_id: profile.clientId }),
          signal: AbortSignal.timeout(10_000), cache: "no-store",
        });
        revocationConfirmed = response.status === 200;
      } catch { revocationConfirmed = false; }
    }
    if (profile) {
      delete profile.accessToken; delete profile.refreshToken; delete profile.idToken; delete profile.expiresAt;
      profile.scopes = [];
    }
    store.selectedId = null;
    await saveChatGptStore(owner, store);
    return { revocationConfirmed };
  });
}
