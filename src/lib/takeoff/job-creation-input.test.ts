import { describe, expect, it } from "vitest";

import { derivePlanSetTakeoffJobId } from "@/lib/takeoff/job-creation-input";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

describe("prepared plan launch identity", () => {
  it("distinguishes tenants and preparation revisions and recovers the same prepared plan launch", () => {
    const plan = { tenantId: TENANT_ID, projectId: "project", planSetId: "plans", estimateVersionId: VERSION_ID, preparationRevision: 2 };
    expect(derivePlanSetTakeoffJobId(plan)).toBe(derivePlanSetTakeoffJobId({ ...plan }));
    expect(derivePlanSetTakeoffJobId(plan)).not.toBe(derivePlanSetTakeoffJobId({ ...plan, tenantId: VERSION_ID }));
    expect(derivePlanSetTakeoffJobId(plan)).not.toBe(derivePlanSetTakeoffJobId({ ...plan, preparationRevision: 3 }));
    expect(derivePlanSetTakeoffJobId({ ...plan, sourceVersionId: VERSION_ID })).toBe(derivePlanSetTakeoffJobId({ ...plan, estimateVersionId: "concurrent-fork", sourceVersionId: VERSION_ID }));
  });
});
