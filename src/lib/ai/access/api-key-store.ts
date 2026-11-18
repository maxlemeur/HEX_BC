import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";

import { ApiKeyError } from "@/lib/ai/access/api-key-errors";
import { writePrivateJson, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";

// What MergeOne remembers about a member's key, beside the Keychain: the
// active version and its masked suffix, how it was verified, the models it
// listed, the last test and the last use. Never the key. One private JSON per
// member and tenant (0600 in a 0700 directory under the ignored .private/).
//
// Each saved key is its own Keychain item, named by its version. The active
// version changes only by an atomic rename of this file, after the new item was
// written and read back. `pending` names an item written (or about to be) for a
// candidate not yet active; `retired` an item replaced or removed and still to
// delete. Both are cleaned at the next operation that opens the Keychain, so an
// interrupted replacement never touches the key in service. `next_version`
// survives a removal: a key added again never takes a version a lab essai froze.

export type AiAccessOwner = ChatGptOwner;

const connectionSchema = z.object({
  provider: z.literal("openai"),
  /** Random, new at every save: what a page that shows this key carries back (versions start at 1 for every owner). */
  connection_id: z.uuid(),
  version: z.number().int().positive(),
  suffix: z.string().regex(/^[A-Za-z0-9_-]{4}$/),
  verification: z.enum(["models_listed", "model_tested"]),
  /** Qualified models the key listed when saved; null when the key may not list models (saved after a model test). */
  models: z.array(z.string().max(200)).max(50).nullable(),
  saved_at: z.string(),
  last_test: z.object({ at: z.string(), model: z.string().max(200) }).strict().nullable(),
  last_used_at: z.string().nullable(),
}).strict();
const itemRefSchema = z.object({ provider: z.literal("openai"), version: z.number().int().positive() }).strict();
const fileSchema = z.object({
  schema_version: z.literal(1),
  next_version: z.number().int().positive(),
  connections: z.object({ openai: connectionSchema.optional() }).strict(),
  pending: z.array(itemRefSchema).max(100).default([]),
  retired: z.array(itemRefSchema).max(100).default([]),
}).strict();

export type StoredApiKeyConnection = z.infer<typeof connectionSchema>;
export type AiAccessFile = z.infer<typeof fileSchema>;
export type AiAccessItemRef = z.infer<typeof itemRefSchema>;

export const defaultAiAccessDirectory = () => path.join(process.cwd(), ".private", "ai-access");

const ownerKey = (owner: AiAccessOwner) => createHash("sha256").update(JSON.stringify([owner.userId, owner.tenantId])).digest("hex");

const empty = (): AiAccessFile => ({ schema_version: 1, next_version: 1, connections: {}, pending: [], retired: [] });

/** Records read back as empty because the stored one could not be read: the screen says so, and the next write replaces it. */
const unreadableRecords = new WeakSet<AiAccessFile>();

export function wasUnreadable(file: AiAccessFile) {
  return unreadableRecords.has(file);
}

/**
 * The member's record. One that cannot be read (damaged, or written by another format) counts as no key saved,
 * so it never locks the member out: a new save or a removal writes a fresh one. Its Keychain items, if any, are
 * no longer named by MergeOne.
 */
export async function readAiAccessFile(directory: string, owner: AiAccessOwner): Promise<AiAccessFile> {
  let text: string;
  try {
    text = await readFile(path.join(directory, `${ownerKey(owner)}.json`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw new ApiKeyError("AI_KEY_UNEXPECTED");
  }
  try {
    return fileSchema.parse(JSON.parse(text));
  } catch {
    const file = empty();
    unreadableRecords.add(file);
    return file;
  }
}

/** Atomic: a temporary file renamed over the previous one. */
export async function writeAiAccessFile(directory: string, owner: AiAccessOwner, file: AiAccessFile) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writePrivateJson(path.join(directory, `${ownerKey(owner)}.json`), fileSchema.parse(file));
}

const LOCK_OWNER = "owner.json";
/** A lock (or a takeover in progress) without its owner file this old was left by a process that stopped. */
const ORPHAN_LOCK_MS = 30_000;

type LockOwner = { pid: number; token: string | null; raw: string };
const lockOwnerSchema = z.object({ pid: z.number().int().positive(), token: z.string().min(1).max(100).optional() });

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists under another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLockOwner(lock: string): Promise<LockOwner | null> {
  try {
    const raw = await readFile(path.join(lock, LOCK_OWNER), "utf8");
    const owner = lockOwnerSchema.parse(JSON.parse(raw));
    return { pid: owner.pid, token: owner.token ?? null, raw };
  } catch {
    return null;
  }
}

async function olderThan(target: string, ms: number) {
  try {
    return Date.now() - (await stat(target)).mtimeMs > ms;
  } catch {
    return false;
  }
}

/** The dead holder of a lock (its owner file as read, or null for an orphan without one), or undefined when the lock is alive. */
async function deadHolder(lock: string): Promise<{ owner: string | null } | undefined> {
  const owner = await readLockOwner(lock);
  if (owner) return processAlive(owner.pid) ? undefined : { owner: owner.raw };
  return (await olderThan(lock, ORPHAN_LOCK_MS)) ? { owner: null } : undefined;
}

async function discard(target: string) {
  const tomb = `${target}.discarded-${randomUUID()}`;
  await rename(target, tomb).then(() => rm(tomb, { recursive: true, force: true })).catch(() => undefined);
}

/**
 * Removes a lock judged dead, if it is still that very lock. Only the waiter that creates the takeover directory
 * acts, and it re-reads the holder first: a lock taken over meanwhile (another token) is left alone.
 */
async function takeOver(lock: string, dead: { owner: string | null }) {
  const takeover = `${lock}.takeover`;
  try {
    await mkdir(takeover, { mode: 0o700 });
  } catch {
    // Another waiter is taking over; a takeover left by a stopped process is cleared for the next try.
    if (await olderThan(takeover, ORPHAN_LOCK_MS)) await discard(takeover);
    return;
  }
  try {
    const current = await readLockOwner(lock);
    const same = dead.owner === null ? current === null && (await olderThan(lock, ORPHAN_LOCK_MS)) : current?.raw === dead.owner;
    if (same) await discard(lock);
  } finally {
    await rm(takeover, { recursive: true, force: true });
  }
}

/**
 * One change at a time per member and tenant, across server processes. A lock whose process is gone (or an
 * orphan lock past 30 s) is taken over by a single waiter; a lock is released only by the holder whose token it
 * carries.
 */
export async function withAiAccessLock<T>(directory: string, owner: AiAccessOwner, effect: () => Promise<T>,
  options: { deadlineMs?: number; /** Tests only: called after a lock was judged dead, before the takeover. */ onStaleLock?: () => Promise<void> } = {}): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, `${ownerKey(owner)}.lock`);
  const token = randomUUID();
  const deadline = Date.now() + (options.deadlineMs ?? 20_000);
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeFile(path.join(lock, LOCK_OWNER), JSON.stringify({ pid: process.pid, token }), { mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new ApiKeyError("AI_KEY_UNEXPECTED");
      const dead = await deadHolder(lock);
      if (dead) {
        await options.onStaleLock?.();
        await takeOver(lock, dead);
        continue;
      }
      if (Date.now() > deadline) throw new ApiKeyError("AI_KEY_BUSY");
      await setTimeout(50);
    }
  }
  try {
    return await effect();
  } finally {
    if ((await readLockOwner(lock))?.token === token) await discard(lock);
  }
}
