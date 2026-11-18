import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";

import { ApiKeyError } from "@/lib/ai/access/api-key-errors";
import { writePrivateJson, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";

// What MergeOne remembers about a member's key, beside the Keychain item:
// masked suffix, version, how it was verified, last test and last use. Never
// the key. One private JSON per member and tenant (0600 in a 0700 directory
// under the ignored .private/), like the subscription's store. `next_version`
// survives a removal, so a key added again never takes the version a lab
// essai froze for the previous one.

export type AiAccessOwner = ChatGptOwner;

const connectionSchema = z.object({
  provider: z.literal("openai"),
  version: z.number().int().positive(),
  suffix: z.string().regex(/^[A-Za-z0-9_-]{4}$/),
  verification: z.enum(["models_listed", "model_tested"]),
  saved_at: z.string(),
  last_test: z.object({ at: z.string(), model: z.string().max(200) }).strict().nullable(),
  last_used_at: z.string().nullable(),
}).strict();
const fileSchema = z.object({
  schema_version: z.literal(1),
  next_version: z.number().int().positive(),
  connections: z.object({ openai: connectionSchema.optional() }).strict(),
}).strict();

export type StoredApiKeyConnection = z.infer<typeof connectionSchema>;
export type AiAccessFile = z.infer<typeof fileSchema>;

export const defaultAiAccessDirectory = () => path.join(process.cwd(), ".private", "ai-access");

const ownerKey = (owner: AiAccessOwner) => createHash("sha256").update(JSON.stringify([owner.userId, owner.tenantId])).digest("hex");

const EMPTY: AiAccessFile = { schema_version: 1, next_version: 1, connections: {} };

export async function readAiAccessFile(directory: string, owner: AiAccessOwner): Promise<AiAccessFile> {
  try {
    return fileSchema.parse(JSON.parse(await readFile(path.join(directory, `${ownerKey(owner)}.json`), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY);
    throw new ApiKeyError("AI_KEY_UNEXPECTED");
  }
}

export async function writeAiAccessFile(directory: string, owner: AiAccessOwner, file: AiAccessFile) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writePrivateJson(path.join(directory, `${ownerKey(owner)}.json`), fileSchema.parse(file));
}

/** One change at a time per member and tenant, across server processes. A lock is never stolen. */
export async function withAiAccessLock<T>(directory: string, owner: AiAccessOwner, effect: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, `${ownerKey(owner)}.lock`);
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new ApiKeyError("AI_KEY_UNEXPECTED");
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
