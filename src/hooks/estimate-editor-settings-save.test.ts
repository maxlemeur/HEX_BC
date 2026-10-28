import { describe, expect, it, vi } from "vitest";

import { persistEstimateSettingsWithLockRecovery } from "@/hooks/estimate-editor-settings-save";
import { EstimateApiError } from "@/lib/estimates/client";
import { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function documentLifetime() {
  const identity = { actorId: "actor-a", tenantId: "tenant", versionId: "version" };
  const document = new EstimateEditorDocument(identity);
  const scope = document.captureScope();
  return {
    isCurrent: () => document.isCurrent(scope),
    revisit: () => {
      document.changeScope({ ...identity, actorId: "actor-b" });
      document.changeScope(identity);
    },
  };
}
const lockError = () => new EstimateApiError("Verrou requis", 409, undefined, "LOCK_REQUIRED");

describe("settings write retry belongs to its document lifetime", () => {
  it("does not reacquire a new visit's lock after the old write is refused", async () => {
    const lifetime = documentLifetime();
    const firstWrite = deferred<string>();
    const error = lockError();
    const persist = vi.fn().mockReturnValueOnce(firstWrite.promise).mockResolvedValue("wrong retry");
    const recoverLock = vi.fn().mockResolvedValue(true);
    const saving = persistEstimateSettingsWithLockRecovery({ persist, recoverLock, isCurrent: lifetime.isCurrent });
    const result = saving.catch((failure: unknown) => failure);
    lifetime.revisit();
    firstWrite.reject(error);
    expect(await result).toBe(error);
    expect(recoverLock).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledOnce();
  });

  it("does not replay old settings when lock recovery completes after A to B to A", async () => {
    const lifetime = documentLifetime();
    const recovery = deferred<boolean>();
    const error = lockError();
    const persist = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("wrong retry");
    const recoverLock = vi.fn(() => recovery.promise);
    const saving = persistEstimateSettingsWithLockRecovery({ persist, recoverLock, isCurrent: lifetime.isCurrent });
    const result = saving.catch((failure: unknown) => failure);
    await Promise.resolve();
    expect(recoverLock).toHaveBeenCalledOnce();
    lifetime.revisit();
    recovery.resolve(true);
    expect(await result).toBe(error);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("retries once on the same document and returns its actual receipt", async () => {
    const lifetime = documentLifetime();
    const receipt = { version: { id: "version", content_revision: 12 } };
    const persist = vi.fn().mockRejectedValueOnce(lockError()).mockResolvedValue(receipt);
    const recoverLock = vi.fn().mockResolvedValue(true);
    await expect(persistEstimateSettingsWithLockRecovery({ persist, recoverLock, isCurrent: lifetime.isCurrent }))
      .resolves.toBe(receipt);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(recoverLock).toHaveBeenCalledOnce();
  });

  it("refuses an old captured callback before its first write", async () => {
    const lifetime = documentLifetime();
    lifetime.revisit();
    const persist = vi.fn();
    const recoverLock = vi.fn();
    await expect(persistEstimateSettingsWithLockRecovery({ persist, recoverLock, isCurrent: lifetime.isCurrent }))
      .rejects.toThrow("Le document a changé");
    expect(persist).not.toHaveBeenCalled();
    expect(recoverLock).not.toHaveBeenCalled();
  });

  it("does not retry an unknown write outcome", async () => {
    const lifetime = documentLifetime();
    const error = new EstimateApiError("Résultat inconnu", 503, undefined, "BATCH_OUTCOME_UNKNOWN");
    const persist = vi.fn().mockRejectedValue(error);
    const recoverLock = vi.fn();
    await expect(persistEstimateSettingsWithLockRecovery({ persist, recoverLock, isCurrent: lifetime.isCurrent }))
      .rejects.toBe(error);
    expect(recoverLock).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledOnce();
  });
});
