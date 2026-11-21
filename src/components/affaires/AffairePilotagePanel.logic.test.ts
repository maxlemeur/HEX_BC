import { describe, expect, it } from "vitest";

import { buildPilotageExceptions, buildPilotageSteps } from "./AffairePilotagePanel.logic";

const plansSummary = {
  planSetCount: 1, latestJob: { id: "job-1", status: "action_required", label: "Échec à corriger" },
  failureReasonLabel: "Délai dépassé.", exceptionCount: null, coveragePercent: null,
} as never;

// Fix round 2, point 1: the overview does not know the member's resume decision; it says what happened and links to the
// takeoff's activity, which gives the decision, instead of telling everyone to relaunch.
describe("the affaire overview of a stopped analysis", () => {
  it("names the failure without telling to relaunch it", () => {
    const exceptions = buildPilotageExceptions({ projectId: "p", intakeWorkspace: null as never, dpgfSource: {} as never,
      plansSummary, registerSummary: null, approvalSummary: null });
    const takeoff = exceptions.find((exception) => exception.id === "takeoff-action-required");
    expect(takeoff).toMatchObject({ summary: "Délai dépassé.", action: { href: "/dashboard/affaires/p/takeoff" } });
    expect(takeoff?.title).not.toMatch(/Relancer|corriger/i);
  });

  it("gives no instruction when the failure has no reason", () => {
    const exceptions = buildPilotageExceptions({ projectId: "p", intakeWorkspace: null as never, dpgfSource: {} as never,
      plansSummary: { ...(plansSummary as object), failureReasonLabel: null } as never, registerSummary: null, approvalSummary: null });
    expect(exceptions.find((exception) => exception.id === "takeoff-action-required")?.summary).not.toMatch(/action de votre part/);
    const steps = buildPilotageSteps({ intakeWorkspace: null as never, dpgfSource: {} as never,
      plansSummary: { ...(plansSummary as object), failureReasonLabel: null } as never, approvalSummary: null,
      currentVersion: null as never, lineCount: 0, takeoffEnabled: true });
    const metre = steps.find((step) => step.key === "metre");
    expect(metre?.summary).not.toMatch(/Une action est requise/);
  });
});
