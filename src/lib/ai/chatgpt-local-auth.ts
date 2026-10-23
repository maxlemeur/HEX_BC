import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

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
  userId: z.string(), tenantId: z.string(), expiresAt: z.number(),
  profileId: z.string().nullable(), clientId: z.string(),
});
const tokenSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(), token_type: z.string(),
  expires_in: z.number().positive().max(604800), scope: z.string().optional(),
});

export function isLocalChatGptEnabled() {
  return process.env.MERGEONE_CHATGPT_LOCAL === "1" &&
    process.env.NODE_ENV !== "production" && !process.env.VERCEL && !process.env.CI;
}

export function assertLocalChatGptHost(host: string | null) {
  if (!isLocalChatGptEnabled() || !host || !/^127\.0\.0\.1:\d+$/.test(host)) {
    throw new Error("ChatGPT est disponible uniquement dans MergeOne local sur 127.0.0.1.");
  }
  return `http://${host}`;
}

function hasPlanAccess(profile: ChatGptProfile) {
  return Boolean(profile.accessToken && profile.scopes.includes(PLAN_SCOPE));
}

export async function getLocalChatGptState(owner: ChatGptOwner) {
  const store = await readChatGptStore(owner);
  const selected = store.profiles.find((profile) => profile.id === store.selectedId);
  return {
    enabled: true as const,
    selectedId: store.selectedId,
    model: selected?.model ?? null,
    sharing: selected ? hasPlanAccess(selected) : false,
    profiles: store.profiles.map((profile, index) => ({
      id: profile.id, email: profile.email, label: `Connexion ${index + 1}`,
      connected: Boolean(profile.accessToken), sharing: hasPlanAccess(profile),
    })),
  };
}

export async function beginLocalChatGptSignIn(owner: ChatGptOwner, origin: string, profileId?: string) {
  const store = await readChatGptStore(owner);
  const profile = profileId ? store.profiles.find((entry) => entry.id === profileId) : null;
  if (profileId && !profile) throw new Error("Connexion ChatGPT introuvable.");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const transaction = {
    userId: owner.userId, tenantId: owner.tenantId,
    state, nonce, verifier, redirectUri: `${origin}${CHATGPT_CALLBACK}`,
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
  const response = await fetch(`${ISSUER}/api/accounts/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body, signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  if (!response.ok) throw new Error("L’accès ChatGPT a expiré ou a été refusé. Reconnectez le compte.");
  return tokenSchema.parse(await response.json());
}

export async function finishLocalChatGptSignIn(owner: ChatGptOwner, url: URL, cookieState?: string) {
  const state = url.searchParams.get("state");
  if (!state || !/^[\w-]{43}$/.test(state) || cookieState !== state) throw new Error("Connexion ChatGPT non vérifiable.");
  const directory = await localChatGptDirectory();
  const pending = path.join(directory, `pending-${state}.json`);
  const consumed = `${pending}.consumed-${randomUUID()}`;
  // Atomic consume prevents replay, including across server processes.
  await rename(pending, consumed);
  try {
    const transaction = transactionSchema.parse(JSON.parse(await readFile(consumed, "utf8")));
    if (transaction.expiresAt < Date.now() || transaction.userId !== owner.userId ||
      transaction.tenantId !== owner.tenantId || transaction.redirectUri !== `${url.origin}${url.pathname}`) {
      throw new Error("Connexion ChatGPT expirée ou compte MergeOne différent.");
    }
    if (url.searchParams.has("error")) throw new Error("Connexion ChatGPT annulée. Vous pouvez réessayer.");
    const code = url.searchParams.get("code");
    const issuedId = url.searchParams.get("client_id");
    const clientId = issuedId ?? transaction.clientId;
    if (!code || !clientId.startsWith("oaiapp_") ||
      (transaction.profileId && clientId !== transaction.clientId)) throw new Error("Inscription ChatGPT incomplète.");

    // Persist a new issued registration before code exchange, even if that code expires.
    await withChatGptLock(owner, async () => {
      const store = await readChatGptStore(owner);
      let profile = transaction.profileId ? store.profiles.find((item) => item.id === transaction.profileId) : undefined;
      if (transaction.profileId && !profile) throw new Error("Connexion ChatGPT introuvable.");
      if (!profile) {
        profile = { id: randomUUID(), clientId, issuer: ISSUER, subject: "", email: "", model: null, scopes: [] };
        store.profiles.push(profile);
        await saveChatGptStore(owner, store);
      }
      const tokens = await requestTokens(new URLSearchParams({
        grant_type: "authorization_code", client_id: clientId, code,
        code_verifier: transaction.verifier, redirect_uri: transaction.redirectUri, resource: RESOURCE,
      }));
      if (!tokens.id_token || tokens.token_type.toLowerCase() !== "bearer") throw new Error("Identité ChatGPT absente.");
      const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: ISSUER, audience: clientId, algorithms: ["RS256"], requiredClaims: ["exp", "sub", "nonce"] });
      if (payload.nonce !== transaction.nonce || !payload.sub ||
        (profile.subject && payload.sub !== profile.subject)) throw new Error("Identité ChatGPT différente ou non vérifiable.");
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
    if (!hasPlanAccess(profile)) throw new Error("Autorisez l’utilisation du forfait ChatGPT en reconnectant le compte.");
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
      if (!hasPlanAccess(profile)) throw new Error("Le forfait ChatGPT n’est plus autorisé. Reconnectez le compte.");
    }
    return { accessToken: profile.accessToken!, model: profile.model, profileId: profile.id };
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
