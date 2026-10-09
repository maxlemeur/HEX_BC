import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workflows/durable-recovery", () => ({
  recoverDurableWorkflows: vi.fn(),
}));

import { GET } from "@/app/api/internal/workflows/recover/route";
import { recoverDurableWorkflows } from "@/lib/workflows/durable-recovery";

describe("GET /api/internal/workflows/recover", () => {
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
    const response = await GET(
      new Request("http://localhost/api/internal/workflows/recover")
    );

    expect(response.status).toBe(401);
    expect(recoverDurableWorkflows).not.toHaveBeenCalled();
  });
});
