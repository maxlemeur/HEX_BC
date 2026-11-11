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
});
