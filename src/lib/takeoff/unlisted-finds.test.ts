import { describe, expect, it } from "vitest";
import { designationKey, findCommandSchema, listMismatchesPlan } from "./unlisted-finds";

describe("unlisted find decisions", () => {
  it("matches case, combining accents and Unicode spacing, preserving punctuation and word boundaries", () => {
    expect(designationKey("  RÉSEAU\u0085 d’eau\u202f ")).toBe(designationKey("re\u0301seau d’eau"));
    expect(designationKey("CE-01")).not.toBe(designationKey("CE 01"));
    expect(designationKey("A B")).not.toBe(designationKey("AB"));
  });
  it("requires a strict majority of the sealed list and at least one reported find", () => {
    const facts = { planKey: "plan", planName: "Plan fictif", total: 4, missing: 2, outside: 3, truncated: false };
    expect(listMismatchesPlan(facts)).toBe(false);
    expect(listMismatchesPlan({ ...facts, missing: 3 })).toBe(true);
    expect(listMismatchesPlan({ ...facts, missing: 4, outside: 0 })).toBe(false);
  });
  it("takes the member and tenant exclusively from the session", () => {
    const uuid = "c0000000-0000-4000-8000-000000000001";
    const command = { kind: "dismiss", jobId: uuid, index: 0, intentKey: uuid, reason: "outside_scope" };
    expect(findCommandSchema.safeParse(command).success).toBe(true);
    for (const name of ["actor","tenantId","p_actor","p_tenant_id"]) {
      expect(findCommandSchema.safeParse({ ...command,[name]: uuid }).success).toBe(false);
    }
  });
});
