import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/affaires/intake-server", () => ({ requireAffaireProjectOwnerOrAdmin: vi.fn(), fetchAffaireIntakeWorkspace: vi.fn() }));
vi.mock("@/lib/affaires/server", () => ({ fetchAffaireHubSummary: vi.fn(), fetchAffaireHubPlansSummary: vi.fn() }));
vi.mock("@/lib/affaires/register-server", () => ({ fetchAffaireRegisterSummary: vi.fn() }));
vi.mock("@/lib/cockpit/preferences", () => ({ fetchCockpitCommandPreferences: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/takeoff/feature-flags", () => ({ isTakeoffEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/ai/decisions", () => ({ getOpenAiDecisionsCapability: vi.fn() }));
vi.mock("@/lib/cockpit/decision-assistance", () => ({ suggestCockpitNextAction: vi.fn(), fingerprintCockpitCandidates: vi.fn().mockReturnValue("fixed") }));
vi.mock("@/lib/cockpit/decision-freshness", () => ({ readCockpitDecisionFingerprint: vi.fn() }));
import { requireAffaireProjectOwnerOrAdmin, fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { fetchAffaireHubSummary } from "@/lib/affaires/server";
import { getOpenAiDecisionsCapability } from "@/lib/ai/decisions";
import { suggestCockpitNextAction } from "@/lib/cockpit/decision-assistance";
import { readCockpitDecisionFingerprint } from "@/lib/cockpit/decision-freshness";
import { suggestCockpitNextActionAction } from "@/app/dashboard/affaires/_actions/cockpit-decisions";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOpenAiDecisionsCapability).mockReturnValue({ status: "available" } as never);
  vi.mocked(readCockpitDecisionFingerprint).mockResolvedValue("state-a");
});
it("rejects another tenant's affair before reading its data or using the model", async () => {
  vi.mocked(requireAffaireProjectOwnerOrAdmin).mockRejectedValue(new Error("Affaire non autorisée"));
  await expect(suggestCockpitNextActionAction({ projectId, candidateIds: ["review-intake"] })).rejects.toThrow("non autorisée");
  expect(fetchAffaireIntakeWorkspace).not.toHaveBeenCalled();
  expect(suggestCockpitNextAction).not.toHaveBeenCalled();
});
it("ignores invented client actions and reconstructs admissible candidates from current business data", async () => {
  vi.mocked(requireAffaireProjectOwnerOrAdmin).mockResolvedValue({ context: { userId: "owner", tenantId: "tenant-a", tenantRole: "admin" } } as never);
  vi.mocked(fetchAffaireHubSummary).mockResolvedValue({ currentVersion: null, lineCount: 0 } as never);
  vi.mocked(fetchAffaireIntakeWorkspace).mockResolvedValue({ uploadId: "upload-a", documents: [], missingPieces: [], briefDraft: null } as never);
  vi.mocked(suggestCockpitNextAction).mockResolvedValue({ status: "to_review", action_id: null, message: "Choix manuel", request_fingerprint: null });
  await suggestCockpitNextActionAction({ projectId, candidateIds: ["force-launch-for-other-tenant"] });
  expect(suggestCockpitNextAction).toHaveBeenCalledWith(expect.objectContaining({ owner: { userId: "owner", tenantId: "tenant-a" }, projectId, suggestions: [] }));
});

it("discards advice when a document, version or preference changes during the provider call", async () => {
  vi.mocked(requireAffaireProjectOwnerOrAdmin).mockResolvedValue({ context: { userId: "owner", tenantId: "tenant-a", tenantRole: "admin" } } as never);
  vi.mocked(fetchAffaireHubSummary).mockResolvedValue({ currentVersion: null, lineCount: 0 } as never);
  vi.mocked(fetchAffaireIntakeWorkspace).mockResolvedValue({ uploadId: "upload-a", documents: [], missingPieces: [], briefDraft: null } as never);
  vi.mocked(readCockpitDecisionFingerprint).mockResolvedValueOnce("state-before").mockResolvedValueOnce("state-after");
  vi.mocked(suggestCockpitNextAction).mockResolvedValue({ status: "proposed", action_id: "review-intake", message: "Proposition", request_fingerprint: "request-a" });
  const result = await suggestCockpitNextActionAction({ projectId, candidateIds: ["review-intake"] });
  expect(result).toMatchObject({ status: "to_review", action_id: null, request_fingerprint: null });
  expect(result.message).toContain("ont changé");
  expect(readCockpitDecisionFingerprint).toHaveBeenCalledTimes(2);
});

it("keeps advice only while the same complete business state is still readable", async () => {
  vi.mocked(requireAffaireProjectOwnerOrAdmin).mockResolvedValue({ context: { userId: "owner", tenantId: "tenant-a", tenantRole: "admin" } } as never);
  vi.mocked(fetchAffaireHubSummary).mockResolvedValue({ currentVersion: null, lineCount: 0 } as never);
  vi.mocked(fetchAffaireIntakeWorkspace).mockResolvedValue({ uploadId: "upload-a", documents: [], missingPieces: [], briefDraft: null } as never);
  const advice = { status: "proposed", action_id: "review-intake", message: "Proposition", request_fingerprint: "request-a" } as const;
  vi.mocked(suggestCockpitNextAction).mockResolvedValue(advice);
  expect(await suggestCockpitNextActionAction({ projectId, candidateIds: ["review-intake"] })).toEqual(advice);
  vi.mocked(readCockpitDecisionFingerprint).mockResolvedValueOnce("state-a").mockResolvedValueOnce(null);
  expect((await suggestCockpitNextActionAction({ projectId, candidateIds: ["review-intake"] })).action_id).toBeNull();
});
