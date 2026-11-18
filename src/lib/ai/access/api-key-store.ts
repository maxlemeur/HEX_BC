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

export async function readAiAccessFile(directory: string, owner: AiAccessOwner): Promise<AiAccessFile> {
  try {
    return fileSchema.parse(JSON.parse(await readFile(path.join(directory, `${ownerKey(owner)}.json`), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw new ApiKeyError("AI_KEY_UNEXPECTED");
  }
}

/** Atomic: a temporary file renamed over the previous one. */
export async function writeAiAccessFile(directory: string, owner: AiAccessOwner, file: AiAccessFile) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writePrivateJson(path.join(directory, `${ownerKey(owner)}.json`), fileSchema.parse(file));
}

const LOCK_OWNER = "owner.json";
/** A lock directory without its owner file this old was left by a process that stopped right after creating it. */
const ORPHAN_LOCK_MS = 30_000;

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists under another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether a lock was left by a process that no longer runs on this Mac. */
async function staleLock(lock: string) {
  try {
    const owner = z.object({ pid: z.number().int().positive() }).parse(JSON.parse(await readFile(path.join(lock, LOCK_OWNER), "utf8")));
    return !processAlive(owner.pid);
  } catch {
    try {
      return Date.now() - (await stat(lock)).mtimeMs > ORPHAN_LOCK_MS;
    } catch {
      return false;
    }
  }
}

/**
 * One change at a time per member and tenant, across server processes. A lock whose process is gone (or an
 * orphan lock past 30 s) is taken over: it is renamed away first, so two waiters never both remove a live one.
 */
export async function withAiAccessLock<T>(directory: string, owner: AiAccessOwner, effect: () => Promise<T>,
  options: { deadlineMs?: number } = {}): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, `${ownerKey(owner)}.lock`);
  const deadline = Date.now() + (options.deadlineMs ?? 20_000);
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeFile(path.join(lock, LOCK_OWNER), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new ApiKeyError("AI_KEY_UNEXPECTED");
      if (await staleLock(lock)) {
        const moved = `${lock}.stale-${randomUUID()}`;
        await rename(lock, moved).then(() => rm(moved, { recursive: true, force: true })).catch(() => undefined);
        continue;
      }
      if (Date.now() > deadline) throw new ApiKeyError("AI_KEY_BUSY");
      await setTimeout(50);
    }
  }
  try {
    return await effect();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
