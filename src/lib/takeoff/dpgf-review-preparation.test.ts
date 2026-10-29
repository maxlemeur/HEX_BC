import { describe, expect, it } from "vitest";

import {
  buildTakeoffDpgfManualLinkPlan,
  buildTakeoffDpgfReviewDecisionPlan,
  buildTakeoffDpgfReviewTargetReference,
  requireTakeoffDpgfReviewTarget,
  type TakeoffDpgfReviewDecisionTarget,
} from "@/lib/takeoff/dpgf-review-preparation";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const LINE_ID = "55555555-5555-4555-8555-555555555555";
const SOURCE_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const ORIGINAL_VERSION_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_JOB_ID = "88888888-8888-4888-8888-888888888888";
const NOW = "2026-10-28T10:00:00.000Z";
const SOURCE_UPDATED_AT = "2026-10-25T09:00:00.000Z";
const CARRIED_AT = "2026-10-21T08:00:00.000Z";

function itemId(index: number) {
  return `99999999-9999-4999-8999-${String(index).padStart(12, "0")}`;
}

function target(
  overrides: Partial<TakeoffDpgfReviewDecisionTarget> = {}
): TakeoffDpgfReviewDecisionTarget {
  return {
    id: LINE_ID,
    tenant_id: TENANT_ID,
    version_id: VERSION_ID,
    item_type: "line",
    source_provider: "dpgf",
    source_file_name: "DPGF ventilation.xlsx",
    source_page: 12,
    position: 3,
    title: "Faux plafond acoustique",
    description: "Description divergente : 2 heures de montage",
    quantity: 125.5,
    ...overrides,
  };
}

function decisionInput(
  overrides: Partial<Parameters<typeof buildTakeoffDpgfReviewDecisionPlan>[0]> = {}
): Parameters<typeof buildTakeoffDpgfReviewDecisionPlan>[0] {
  return {
    tenantId: TENANT_ID,
    userId: USER_ID,
    jobId: JOB_ID,
    payload: {
      version_id: VERSION_ID,
      estimate_item_id: LINE_ID,
      decision: "keep_takeoff",
      reason: "  Surface contrôlée sur le plan niveau 2.  ",
    },
    estimateItem: target(),
    reviewReference: "dpgf ventilation xlsx row 12",
    decisionTimestamp: NOW,
    existingDecision: null,
    sourceDecision: null,
    linkedFromVersionId: null,
    ...overrides,
  };
}

describe("DPGF review target eligibility", () => {
  it.each([
    ["DPGF provider without a file", { source_file_name: null }],
    ["a legacy source file", { source_provider: null }],
    ["an empty but non-null legacy filename", { source_provider: null, source_file_name: "" }],
  ])("accepts a line with %s", (_name, patch) => {
    const estimateItem = target(patch);
    expect(requireTakeoffDpgfReviewTarget({
      estimateItem, estimateItemId: LINE_ID, versionId: VERSION_ID, jobId: JOB_ID,
    })).toBe(estimateItem);
  });

  it("rejects the wrong version before testing line eligibility", () => {
    expect(() => requireTakeoffDpgfReviewTarget({
      estimateItem: target({ version_id: SOURCE_VERSION_ID, item_type: "section" }),
      estimateItemId: LINE_ID, versionId: VERSION_ID, jobId: JOB_ID,
    })).toThrowError(expect.objectContaining({
      status: 409,
      message: "La ligne DPGF n'appartient pas à la version cible.",
      details: expect.objectContaining({
        version_id: VERSION_ID, estimate_item_version_id: SOURCE_VERSION_ID,
      }),
    }));
  });
});

describe("DPGF manual link preparation", () => {
  it("rejects a selected item from another job when all selections exist", () => {
    expect(() => buildTakeoffDpgfManualLinkPlan({
      jobId: JOB_ID, userId: USER_ID,
      payload: {
        version_id: VERSION_ID, estimate_item_id: LINE_ID, takeoff_item_ids: [itemId(1)],
      },
      takeoffItems: [{ id: itemId(1), tenant_id: TENANT_ID, job_id: OTHER_JOB_ID }],
    })).toThrowError(expect.objectContaining({
      status: 409, code: "CONFLICT",
      details: expect.objectContaining({
        takeoff_item_id: itemId(1), takeoff_job_id: OTHER_JOB_ID, expected_job_id: JOB_ID,
      }),
    }));
  });
});

describe("DPGF review reference preparation", () => {
  it("identifies a source row by file and row even when its title changes", () => {
    expect(buildTakeoffDpgfReviewTargetReference({
      estimateItem: target({ title: "Libellé corrigé après import" }),
      unitByRowIndex: new Map([[12, "m2"]]),
    })).toBe("dpgf ventilation xlsx row 12");
  });

  it("uses the resolved row unit rather than the description without a source file", () => {
    expect(buildTakeoffDpgfReviewTargetReference({
      estimateItem: target({ source_file_name: null }),
      unitByRowIndex: new Map([[11, "h"], [12, "m2"]]),
    })).toBe("3 faux plafond acoustique m2");
  });

  it("omits the unit when the target has no mapped row", () => {
    expect(buildTakeoffDpgfReviewTargetReference({
      estimateItem: target({ source_file_name: null, source_page: null }),
      unitByRowIndex: new Map([[12, "m2"]]),
    })).toBe("3 faux plafond acoustique");
  });
});

describe("DPGF decision preparation", () => {
  it("keeps current null provenance and current audit values despite an inherited source", () => {
    const plan = buildTakeoffDpgfReviewDecisionPlan(decisionInput({
      existingDecision: {
        carried_over_from_version_id: null, carried_over_at: null,
        decision: "manual_fix", reason: "  Motif courant conservé tel quel.  ",
      },
      linkedFromVersionId: SOURCE_VERSION_ID,
      sourceDecision: {
        carried_over_from_version_id: ORIGINAL_VERSION_ID,
        carried_over_at: CARRIED_AT, updated_at: SOURCE_UPDATED_AT,
      },
    }));
    expect(plan.upsertPayload).toMatchObject({
      carried_over_from_version_id: null, carried_over_at: null,
    });
    expect(plan.auditMetadata).toMatchObject({
      previous_decision: "manual_fix", previous_reason: "  Motif courant conservé tel quel.  ",
    });
  });

  it("preserves already recorded provenance when replacing a current decision", () => {
    const plan = buildTakeoffDpgfReviewDecisionPlan(decisionInput({
      existingDecision: {
        carried_over_from_version_id: ORIGINAL_VERSION_ID, carried_over_at: CARRIED_AT,
        decision: "keep_dpgf", reason: "Quantité contractuelle.",
      },
      linkedFromVersionId: SOURCE_VERSION_ID,
    }));
    expect(plan.upsertPayload).toMatchObject({
      carried_over_from_version_id: ORIGINAL_VERSION_ID, carried_over_at: CARRIED_AT,
      decision: "keep_takeoff", decided_at: NOW, updated_at: NOW,
    });
    expect(plan.auditMetadata).toMatchObject({
      previous_decision: "keep_dpgf", previous_reason: "Quantité contractuelle.",
    });
  });

  it.each([
    ["original carry date", CARRIED_AT, SOURCE_UPDATED_AT, CARRIED_AT],
    ["source update date", null, SOURCE_UPDATED_AT, SOURCE_UPDATED_AT],
    ["current save date", null, null, NOW],
  ])("uses the %s when first inheriting a decision", (_name, carriedAt, updatedAt, expectedAt) => {
    const plan = buildTakeoffDpgfReviewDecisionPlan(decisionInput({
      linkedFromVersionId: SOURCE_VERSION_ID,
      sourceDecision: {
        carried_over_from_version_id: null, carried_over_at: carriedAt, updated_at: updatedAt,
      },
    }));
    expect(plan.upsertPayload).toMatchObject({
      carried_over_from_version_id: SOURCE_VERSION_ID, carried_over_at: expectedAt,
      decided_at: NOW, updated_at: NOW,
    });
  });

  it("retains the original source version across a chain and leaves previous audit values empty", () => {
    const sourceDecision = {
      carried_over_from_version_id: ORIGINAL_VERSION_ID,
      carried_over_at: CARRIED_AT, updated_at: SOURCE_UPDATED_AT,
      decision: "out_of_scope", reason: "Motif de la version source.",
    };
    const plan = buildTakeoffDpgfReviewDecisionPlan(decisionInput({
      linkedFromVersionId: SOURCE_VERSION_ID, sourceDecision,
    }));
    expect(plan.upsertPayload).toMatchObject({
      carried_over_from_version_id: ORIGINAL_VERSION_ID, carried_over_at: CARRIED_AT,
    });
    expect(plan.auditMetadata).toMatchObject({ previous_decision: null, previous_reason: null });
  });

  it.each(["no source decision", "no linked version"])("does not invent provenance with %s", (scenario) => {
    const plan = buildTakeoffDpgfReviewDecisionPlan(decisionInput({
      linkedFromVersionId: scenario === "no linked version" ? null : SOURCE_VERSION_ID,
      sourceDecision: scenario === "no source decision" ? null : {
        carried_over_from_version_id: ORIGINAL_VERSION_ID,
        carried_over_at: CARRIED_AT, updated_at: SOURCE_UPDATED_AT,
      },
    }));
    expect(plan.upsertPayload).toMatchObject({
      carried_over_from_version_id: null, carried_over_at: null,
    });
  });
});
