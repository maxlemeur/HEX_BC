import net from "node:net";

import { describe, expect, it } from "vitest";

import { findAvailablePort } from "./local-supabase-ci";

describe("isolated Supabase listener ports", () => {
  it.each([
    { name: "native service backends", first: 10000, last: 19999 },
    { name: "automatically assigned public listeners", first: 20000, last: 32767 },
  ])("refuses a host exposing only CLI-owned $name ports", async ({ first, last }) => {
    await expect(findAvailablePort(new Set(), [[1, first - 1], [last + 1, 65535]]))
      .rejects.toThrow("No non-ephemeral Supabase port is available");
  });

  it("can still allocate an external listener without using a reserved port", async () => {
    const port = await findAvailablePort(new Set([61000]), [[1, 60999], [62001, 65535]]);
    expect(port).toBeGreaterThan(61000);
    expect(port).toBeLessThanOrEqual(62000);
  });

  // A prebuilt Army build bakes in its backend origin: a shard takes that API port when it is free, and only then.
  it("takes a preferred port only when it is a free candidate", async () => {
    const ranges = [[1, 60999]];
    expect(await findAvailablePort(new Set(), ranges, 64000)).toBe(64000);
    // Reserved, CLI-owned, ephemeral or browser-restricted: the random search runs as before.
    for (const [reserved, preferred] of [[new Set([64000]), 64000], [new Set<number>(), 15000], [new Set<number>(), 40000], [new Set<number>(), 6000]] as const) {
      const port = await findAvailablePort(reserved, ranges, preferred);
      expect(port).not.toBe(preferred);
      expect(port).toBeGreaterThanOrEqual(61000);
    }
    const busy = net.createServer();
    await new Promise<void>((resolve) => busy.listen({ port: 0, host: "127.0.0.1", exclusive: true }, resolve));
    try {
      const taken = (busy.address() as net.AddressInfo).port;
      const port = await findAvailablePort(new Set(), [[1, 1023]], taken);
      expect(port).not.toBe(taken);
    } finally {
      await new Promise((resolve) => busy.close(resolve));
    }
  });
});
