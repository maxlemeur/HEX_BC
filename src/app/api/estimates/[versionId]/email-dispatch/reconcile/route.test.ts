import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: vi.fn(),
}));

vi.mock("@/lib/email/estimate-email-outbox", () => ({
  getEstimateEmailDispatchForReconciliation: vi.fn(),
  reconcileEstimateEmailDispatch: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/email-dispatch/reconcile/route";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  getEstimateEmailDispatchForReconciliation,
  reconcileEstimateEmailDispatch,
} from "@/lib/email/estimate-email-outbox";

const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VERSION_ID = "44444444-4444-4444-8444-444444444444";
const DISPATCH_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const TENANT_ID = "tenant-1";

function request(body: unknown) {
  return new Request("http://localhost/api/estimates/v/email-dispatch/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/estimates/[versionId]/email-dispatch/reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue({
      userId: USER_ID,
      tenantId: TENANT_ID,
      isTenantAdmin: true,
    } as Awaited<ReturnType<typeof getAuthenticatedTenantContext>>);
    vi.mocked(getEstimateEmailDispatchForReconciliation).mockResolvedValue({
      id: DISPATCH_ID,
      tenant_id: TENANT_ID,
      version_id: VERSION_ID,
      status: "unknown",
    });
  });

  it("returns 404 when the dispatch belongs to another version", async () => {
    vi.mocked(getEstimateEmailDispatchForReconciliation).mockResolvedValue({
      id: DISPATCH_ID,
      tenant_id: TENANT_ID,
      version_id: OTHER_VERSION_ID,
      status: "unknown",
    });

    const response = await POST(
      request({ dispatchId: DISPATCH_ID, resolution: "sent", providerId: "x" }),
      { params: Promise.resolve({ versionId: VERSION_ID }) }
    );

    expect(response.status).toBe(404);
    expect(reconcileEstimateEmailDispatch).not.toHaveBeenCalled();
  });

  it("returns 404 when the dispatch belongs to another tenant", async () => {
    vi.mocked(getEstimateEmailDispatchForReconciliation).mockResolvedValue({
      id: DISPATCH_ID,
      tenant_id: "tenant-2",
      version_id: VERSION_ID,
      status: "unknown",
    });

    const response = await POST(
      request({ dispatchId: DISPATCH_ID, resolution: "sent", providerId: "x" }),
      { params: Promise.resolve({ versionId: VERSION_ID }) }
    );

    expect(response.status).toBe(404);
    expect(reconcileEstimateEmailDispatch).not.toHaveBeenCalled();
  });

  it("requires a tenant admin", async () => {
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue({
      userId: USER_ID,
      tenantId: TENANT_ID,
      isTenantAdmin: false,
    } as Awaited<ReturnType<typeof getAuthenticatedTenantContext>>);

    const response = await POST(
      request({ dispatchId: DISPATCH_ID, resolution: "sent", providerId: "x" }),
      { params: Promise.resolve({ versionId: VERSION_ID }) }
    );

    expect(response.status).toBe(403);
    expect(getEstimateEmailDispatchForReconciliation).not.toHaveBeenCalled();
    expect(reconcileEstimateEmailDispatch).not.toHaveBeenCalled();
  });
});
