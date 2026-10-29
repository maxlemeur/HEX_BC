import { describe, expect, it } from "vitest";

import { buildEstimateApprovalDecisionJournalCsv } from "@/lib/estimates/rules-engine";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

describe("approval decision journal", () => {
  it("neutralizes formula-like values in the csv export", () => {
    const csv = buildEstimateApprovalDecisionJournalCsv({
      events: [
        {
          id: "event-3",
          estimateVersionId: VERSION_ID,
          occurredAt: "2026-03-06T11:00:00.000Z",
          createdAt: "2026-03-06T11:00:00.000Z",
          actorUserId: USER_ID,
          actorName: "=HYPERLINK(\"https://example.com\")",
          decision: "approved",
          approvalOutcome: "approved",
          cycleId: "cycle-3",
          cycleNumber: 3,
          commentCount: 1,
          scopeCount: 1,
          perimeterLabel: "@Lot CFO",
          scopes: [
            {
              scopeType: "lot",
              scopeId: "lot-3",
              scopeLabel: "+Lot CFO",
            },
          ],
          comments: [
            {
              scopeType: "lot",
              scopeId: "lot-3",
              scopeLabel: "=Lot CFO",
              comment: "@Confirmer la variante",
            },
          ],
          rulesTriggered: [
            {
              ruleId: "rule-3",
              label: "-Seuil montant HT",
              signalKey: "total_ht_cents",
              message: "Le montant HT depasse le seuil.",
              thresholdValue: 300000,
              actualValue: 350000,
              sourceState: "ready",
              approvalStatus: "pending",
            },
          ],
        },
      ],
    });

    expect(csv).toContain("\"'=HYPERLINK(\"\"https://example.com\"\")\"");
    expect(csv).toContain("'@Lot CFO");
    expect(csv).toContain("'=Lot CFO: @Confirmer la variante");
    expect(csv).toContain("'-Seuil montant HT");
  });
});
