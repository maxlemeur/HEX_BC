import { z } from "zod";

import type { SendEstimateInput } from "@/lib/estimates/schemas";

const pendingSubmissionSchema = z.object({
  version: z.literal(1),
  requestId: z.string().uuid(),
  payload: z.object({
    to: z.string().min(1),
    cc: z.array(z.string()).optional(),
    subject: z.string().min(1),
    message: z.string().min(1),
  }),
  concurrencyToken: z.string().optional(),
});
export type PendingEstimateEmail = z.infer<typeof pendingSubmissionSchema>;

function pendingStorageKey(versionId: string) {
  return `estimate-email:${versionId}:pending`;
}

export function readPendingEstimateEmail(versionId: string): PendingEstimateEmail | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(pendingStorageKey(versionId));
    if (!raw) return null;
    const parsed = pendingSubmissionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function persistPendingEstimateEmail(versionId: string, pending: PendingEstimateEmail) {
  try {
    globalThis.sessionStorage?.setItem(pendingStorageKey(versionId), JSON.stringify(pending));
  } catch {
    // The mounted dialog retains the same request if browser storage is unavailable.
  }
}

export function clearPendingEstimateEmail(versionId: string, requestId?: string) {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return;
    const prefix = `estimate-email:${versionId}:`;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix) && (!requestId || storage.getItem(key) === requestId ||
          (key === pendingStorageKey(versionId) && readPendingEstimateEmail(versionId)?.requestId === requestId))) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Confirmed success or a named deterministic failure is still usable without storage.
  }
}

/** Recover keys created by the previous client without changing a pending dispatch. */
export async function readLegacyEstimateEmailRequestId(versionId: string, payload: SendEstimateInput) {
  // Preserve the previous field order, which is part of its storage fingerprint.
  const ordered = JSON.stringify({ to: payload.to, cc: payload.cc ?? [], subject: payload.subject, message: payload.message });
  let hash = 0x811c9dc5;
  for (let index = 0; index < ordered.length; index += 1) {
    hash ^= ordered.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  let fingerprintHash = (hash >>> 0).toString(16).padStart(8, "0");
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(ordered));
    fingerprintHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  try {
    const value = globalThis.sessionStorage?.getItem(`estimate-email:${versionId}:${fingerprintHash}`);
    return value && z.string().uuid().safeParse(value).success ? value : null;
  } catch {
    return null;
  }
}
