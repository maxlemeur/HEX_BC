import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/test-data/purge", () => ({
  purgeTestTenantDrafts: vi.fn(),
}));

import { GET } from "@/app/api/internal/test-data/purge/route";
import { purgeTestTenantDrafts } from "@/lib/test-data/purge";

const url = "http://localhost/api/internal/test-data/purge";
const authorized = { headers: { authorization: "Bearer cron-test-secret" } };

describe("GET /api/internal/test-data/purge", () => {
  const previousSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-test-secret";
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previousSecret;
    }
  });

  it("rejects requests without the cron bearer secret", async () => {
    for (const init of [undefined, { headers: { authorization: "Bearer wrong-secret" } }]) {
      const response = await GET(new Request(url, init));
      expect(response.status).toBe(401);
    }
    delete process.env.CRON_SECRET;
    expect((await GET(new Request(url, authorized))).status).toBe(401);
    expect(purgeTestTenantDrafts).not.toHaveBeenCalled();
  });

  it("deletes by default and lists only with dryRun=1", async () => {
    const counters = { dryRun: false, eligible: 0, deleted: 3, failed: 0, remaining: false };
    vi.mocked(purgeTestTenantDrafts).mockResolvedValue(counters);

    const response = await GET(new Request(url, authorized));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(counters);
    await GET(new Request(`${url}?dryRun=1`, authorized));

    expect(vi.mocked(purgeTestTenantDrafts).mock.calls).toEqual([[{ dryRun: false }], [{ dryRun: true }]]);
  });
});
