import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/estimates/generated-ouvrages", () => ({
  fetchGeneratedOuvrageDraft: vi.fn(),
  generateOuvragesFromText: vi.fn(),
  insertGeneratedOuvrages: vi.fn(),
  rejectGeneratedOuvrageDraft: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import {
  fetchGeneratedOuvrageDraft,
  generateOuvragesFromText,
  insertGeneratedOuvrages,
  rejectGeneratedOuvrageDraft,
} from "@/app/dashboard/affaires/_actions/generated-ouvrages";
import {
  fetchGeneratedOuvrageDraft as fetchGeneratedOuvrageDraftServer,
  generateOuvragesFromText as generateOuvragesFromTextServer,
  insertGeneratedOuvrages as insertGeneratedOuvragesServer,
  rejectGeneratedOuvrageDraft as rejectGeneratedOuvrageDraftServer,
} from "@/lib/estimates/generated-ouvrages";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";

describe("generated ouvrage server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revalidates affaire and estimate paths after generation", async () => {
    vi.mocked(generateOuvragesFromTextServer).mockResolvedValue({
      draftId: DRAFT_ID,
      versionId: VERSION_ID,
      projectId: PROJECT_ID,
      sourceKind: "free_text",
      preferredLotId: null,
      status: "pending",
      summary: {
        totalCandidates: 1,
        certainCount: 0,
        plausibleCount: 1,
        questionCount: 0,
        pendingCount: 1,
        insertedCount: 0,
        rejectedCount: 0,
      },
      generatedAt: "2026-03-07T09:00:00.000Z",
      candidates: [],
    });

    const result = await generateOuvragesFromText({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      sourceKind: "free_text",
      sourceText: "Pose de faux plafond 120 m2.",
    });

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/dashboard/affaires");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}`
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/estimates/${VERSION_ID}`
    );
    expect(result.draftId).toBe(DRAFT_ID);
  });

  it("passes through draft fetch without extra invalidation", async () => {
    vi.mocked(fetchGeneratedOuvrageDraftServer).mockResolvedValue({
      draftId: DRAFT_ID,
      versionId: VERSION_ID,
      projectId: PROJECT_ID,
      sourceKind: "free_text",
      preferredLotId: null,
      status: "pending",
      summary: {
        totalCandidates: 1,
        certainCount: 0,
        plausibleCount: 1,
        questionCount: 0,
        pendingCount: 1,
        insertedCount: 0,
        rejectedCount: 0,
      },
      generatedAt: "2026-03-07T09:00:00.000Z",
      candidates: [],
    });

    const result = await fetchGeneratedOuvrageDraft({
      versionId: VERSION_ID,
      draftId: DRAFT_ID,
    });

    expect(result.draftId).toBe(DRAFT_ID);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("revalidates after insertion", async () => {
    vi.mocked(insertGeneratedOuvragesServer).mockResolvedValue({
      ok: true,
      insertedCount: 1,
      draftStatus: "applied",
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
    });

    const result = await insertGeneratedOuvrages({
      versionId: VERSION_ID,
      draftId: DRAFT_ID,
      acceptedCandidates: [
        {
          candidateId: "44444444-4444-4444-8444-444444444444",
          designation: "Pose de faux plafond",
          unit: "m2",
          quantity: 120,
          lotId: null,
        },
      ],
    });

    expect(result.insertedCount).toBe(1);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/dashboard/affaires");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}`
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/estimates/${VERSION_ID}`
    );
  });

  it("revalidates after rejection", async () => {
    vi.mocked(rejectGeneratedOuvrageDraftServer).mockResolvedValue({
      ok: true,
      draftStatus: "discarded",
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
    });

    const result = await rejectGeneratedOuvrageDraft({
      draftId: DRAFT_ID,
      candidateId: "44444444-4444-4444-8444-444444444444",
      reason: "A clarifier",
    });

    expect(result.draftStatus).toBe("discarded");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/dashboard/affaires");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}`
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/estimates/${VERSION_ID}`
    );
  });
});
