import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withAiAccessLock } from "@/lib/ai/access/api-key-store";

// The lock of a member's key record, across server processes. Failure modes (review round 2, item E):
// - two waiters both judge a lock dead; one takes it over, the other then removes that fresh lock on its earlier
//   decision, and both run at once;
// - a holder whose lock was taken over removes the new holder's lock when it releases.

const OWNER = { userId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222" };
const lockPath = (directory: string) =>
  path.join(directory, `${createHash("sha256").update(JSON.stringify([OWNER.userId, OWNER.tenantId])).digest("hex")}.lock`);
/** A pid no process holds on this machine. */
const DEAD_PID = 2 ** 22 + 12_345;

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "ai-access-lock-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function deadLock() {
  await mkdir(lockPath(directory), { recursive: true });
  await writeFile(path.join(lockPath(directory), "owner.json"), JSON.stringify({ pid: DEAD_PID, token: "dead-holder" }));
}

describe("withAiAccessLock", () => {
  it("lets only one of two waiters take over a dead lock, even when both judged it dead", async () => {
    await deadLock();
    let inside = 0;
    let most = 0;
    let bothJudged!: () => void;
    const judged = new Promise<void>((resolve) => { bothJudged = resolve; });
    let judgements = 0;
    const judge = () => { judgements += 1; if (judgements === 2) bothJudged(); return judged; };
    let firstInside!: () => void;
    const firstEntered = new Promise<void>((resolve) => { firstInside = resolve; });
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((resolve) => { releaseFirst = resolve; });
    // The first waiter takes the dead lock over and enters; only then does the second act on its earlier judgement.
    const first = withAiAccessLock(directory, OWNER, async () => {
      inside += 1; most = Math.max(most, inside); firstInside(); await firstHolds; inside -= 1;
    }, { onStaleLock: judge, deadlineMs: 5_000 });
    const second = withAiAccessLock(directory, OWNER, async () => {
      inside += 1; most = Math.max(most, inside); await new Promise((resolve) => setTimeout(resolve, 30)); inside -= 1;
    }, { onStaleLock: async () => { await judge(); await firstEntered; }, deadlineMs: 5_000 });
    await firstEntered;
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseFirst();
    await Promise.all([first, second]);
    expect(most).toBe(1);
  });

  it("releases only a lock that carries its own token", async () => {
    await withAiAccessLock(directory, OWNER, async () => {
      // Meanwhile another process took the lock over (as it would after judging this one dead).
      const lock = lockPath(directory);
      await rename(lock, `${lock}.moved`);
      await mkdir(lock);
      await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, token: "another-holder" }));
    });
    expect(JSON.parse(await readFile(path.join(lockPath(directory), "owner.json"), "utf8"))).toMatchObject({ token: "another-holder" });
  });
});
