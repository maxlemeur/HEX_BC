import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/decisions", () => ({ getOpenAiDecisionsCapability: vi.fn(), callOpenAiDecisions: vi.fn() }));
import { callOpenAiDecisions, getOpenAiDecisionsCapability } from "@/lib/ai/decisions";
import { suggestCockpitNextAction } from "@/lib/cockpit/decision-assistance";
import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

function suggestion(actionId: string, flags = {}): CockpitSuggestion {
  return { actionId, label: actionId, preview: "Point métier", intent: "review_intake", target: { kind: "navigate", href: "/local" },
    requiresConfirmation: true, confirmTone: "warning", priority: 100, isHidden: false, isPinned: false, ...flags };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOpenAiDecisionsCapability).mockReturnValue({ status: "available" } as never);
});
it("proposes only a visible deterministic candidate and preserves pinned preferences", async () => {
  vi.mocked(callOpenAiDecisions).mockResolvedValue({ status: "available", answers: [{ name: "next_action", status: "answered", value: "review" }],
    provenance: { request_fingerprint: "request-a" } } as never);
  const suggestions = [suggestion("review"), suggestion("hidden", { isHidden: true }), suggestion("pinned", { isPinned: true })];
  const before = structuredClone(suggestions);
  const result = await suggestCockpitNextAction({ owner: { userId: "owner", tenantId: "tenant" }, projectId: "project", suggestions, evidenceFingerprint: "fixed" });
  expect(result.action_id).toBe("review");
  expect(suggestions).toEqual(before);
  const question = vi.mocked(callOpenAiDecisions).mock.calls[0][0].questions[0];
  expect(question.type === "choice" && question.choices.map((choice) => choice.value)).toEqual(["review", "unknown"]);
});
it("does not expose a forged or now forbidden action", async () => {
  vi.mocked(callOpenAiDecisions).mockResolvedValue({ status: "available", answers: [{ name: "next_action", status: "answered", value: "launch-forbidden" }],
    provenance: { request_fingerprint: "request-a" } } as never);
  const result = await suggestCockpitNextAction({ owner: { userId: "owner", tenantId: "tenant" }, projectId: "project",
    suggestions: [suggestion("review")], evidenceFingerprint: "fixed" });
  expect(result.action_id).toBeNull();
  expect(result.status).toBe("to_review");
});
