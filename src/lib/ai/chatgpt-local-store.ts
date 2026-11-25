import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { chatGptReasoningEffortSchema } from "@/lib/ai/chatgpt-model-preferences";

export type ChatGptOwner = { userId: string; tenantId: string };

const profileSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  issuer: z.string(),
  subject: z.string(),
  email: z.string(),
  model: z.string().nullable(),
  reasoningEffort: chatGptReasoningEffortSchema.nullable().default(null),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  idToken: z.string().optional(),
  expiresAt: z.number().optional(),
  scopes: z.array(z.string()),
  // The authorization of the current connection: each sign-in gives a new one, a disconnection removes it. A mandate to
  // spend on this subscription names it, so that a reconnection never revives a withdrawn mandate.
  authorizationId: z.string().optional(),
});
const storeSchema = z.object({
  selectedId: z.string().nullable(),
  profiles: z.array(profileSchema),
});
export type ChatGptProfile = z.infer<typeof profileSchema>;
export type ChatGptStore = z.infer<typeof storeSchema>;

// This directory is already ignored by Git. Credentials never enter Supabase.
const root = () => path.join(process.cwd(), ".private", "chatgpt-local");
/** File name stem of an owner's private records, shared by the ChatGPT and API key stores. */
export const ownerKey = (owner: ChatGptOwner) => createHash("sha256")
  .update(JSON.stringify([owner.userId, owner.tenantId])).digest("hex");

export async function writePrivateJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function localChatGptDirectory() {
  const directory = root();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

// The Mac's identifier never changes once written: read once per directory, then kept.
const hostIds = new Map<string, Promise<string>>();
export async function getChatGptHostId() {
  const file = path.join(await localChatGptDirectory(), "host.json");
  let hostId = hostIds.get(file);
  if (!hostId) {
    hostId = (async () => {
      try {
        await writeFile(file, JSON.stringify(`urn:uuid:${randomUUID()}`), { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      return z.string().startsWith("urn:uuid:").parse(JSON.parse(await readFile(file, "utf8")));
    })();
    hostIds.set(file, hostId);
    hostId.catch(() => hostIds.delete(file));
  }
  return hostId;
}

/**
 * The Mac's identifier when it has one, without creating anything: a read path (what a page shows) never writes the
 * private directory or `host.json`. Null on a Mac that has never run a local analysis (no Mac here for this read).
 */
export async function readChatGptHostId(): Promise<string | null> {
  const file = path.join(root(), "host.json");
  const known = hostIds.get(file);
  if (known) return known;
  try {
    return z.string().startsWith("urn:uuid:").parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** A disconnected profile still has a store on the Mac that received the launch. */
export async function hasLocalChatGptStore(owner: ChatGptOwner) {
  try {
    return (await stat(path.join(root(), `${ownerKey(owner)}.json`))).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function readChatGptStore(owner: ChatGptOwner): Promise<ChatGptStore> {
  try {
    const content = await readFile(path.join(root(), `${ownerKey(owner)}.json`), "utf8");
    const store = storeSchema.parse(JSON.parse(content));
    // A connection made before authorizations existed gets one when the store loads, from what it was signed in with:
    // its identity token, or else its registration and account (a refresh keeps it, a new sign-in replaces it with its
    // own, a disconnection removes it with the tokens).
    for (const profile of store.profiles) {
      if (!profile.authorizationId && (profile.accessToken || profile.refreshToken)) {
        const signedIn = profile.idToken ?? `${profile.clientId}:${profile.subject}`;
        profile.authorizationId = `legacy:${createHash("sha256").update(`${profile.id}:${signedIn}`).digest("hex")}`;
      }
    }
    return store;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { selectedId: null, profiles: [] };
    throw new Error("La connexion ChatGPT locale ne peut pas être lue. Reconnectez le compte.");
  }
}

export async function saveChatGptStore(owner: ChatGptOwner, store: ChatGptStore) {
  await writePrivateJson(path.join(await localChatGptDirectory(), `${ownerKey(owner)}.json`), storeSchema.parse(store));
}

// Serialize rotating refresh tokens and account changes across Next.js processes.
// A lock is never stolen: a crashed process requires explicit local recovery.
export async function withChatGptLock<T>(owner: ChatGptOwner, effect: () => Promise<T>): Promise<T> {
  const lock = path.join(await localChatGptDirectory(), `${ownerKey(owner)}.lock`);
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > deadline) throw new Error("Connexion ChatGPT occupée. Réessayez dans quelques instants.");
      await setTimeout(50);
    }
  }
  try {
    await writeFile(path.join(lock, "pid"), String(process.pid), { mode: 0o600 });
    return await effect();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
