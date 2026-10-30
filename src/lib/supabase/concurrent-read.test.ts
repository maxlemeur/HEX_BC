import { describe, expect, it } from "vitest";

import { startConcurrentRead } from "./concurrent-read";

describe("startConcurrentRead", () => {
  it("starts a thenable at once and resolves to its value", async () => {
    let started = false;
    const read = startConcurrentRead({
      then<TResult1 = number, TResult2 = never>(
        onfulfilled?: ((value: number) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) {
        started = true;
        return Promise.resolve(42).then(onfulfilled, onrejected);
      },
    });
    await Promise.resolve();
    expect(started).toBe(true);
    await expect(read).resolves.toBe(42);
  });

  it("keeps a rejection for the caller without an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const read = startConcurrentRead(Promise.reject(new Error("lecture refusée")));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
      await expect(read).rejects.toThrow("lecture refusée");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
