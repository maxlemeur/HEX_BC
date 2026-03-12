import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/affaires/intake-server", () => ({
  confirmAffaireBrief: vi.fn(),
  reclassifyAffaireDocument: vi.fn(),
  setAffaireDocumentAsPrimary: vi.fn(),
  updateAffaireBrief: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import {
  confirmAffaireBrief,
  reclassifyAffaireDocument,
  setAffaireDocumentAsPrimary,
  updateAffaireBrief,
} from "@/app/dashboard/affaires/_actions/intake";
import {
  confirmAffaireBrief as confirmAffaireBriefServer,
  reclassifyAffaireDocument as reclassifyAffaireDocumentServer,
  setAffaireDocumentAsPrimary as setAffaireDocumentAsPrimaryServer,
  updateAffaireBrief as updateAffaireBriefServer,
} from "@/lib/affaires/intake-server";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";

describe("affaire intake server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reclassifies a document and revalidates the affaire paths", async () => {
    vi.mocked(reclassifyAffaireDocumentServer).mockResolvedValue({ ok: true });

    const result = await reclassifyAffaireDocument({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      category: "cctp",
    });

    expect(vi.mocked(reclassifyAffaireDocumentServer)).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      category: "cctp",
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/dashboard/affaires");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}`
    );
    expect(result).toEqual({ ok: true });
  });

  it("updates a brief and revalidates the affaire paths", async () => {
    vi.mocked(updateAffaireBriefServer).mockResolvedValue({
      ok: true,
      status: "a_confirmer",
    });

    const result = await updateAffaireBrief({
      projectId: PROJECT_ID,
      summary: "Synthese revisee",
      scope: ["Lot gros oeuvre", "Lot facade"],
      vigilancePoints: ["Verifier les plans d execution"],
      assumptions: ["Le phasage reste a confirmer"],
    });

    expect(vi.mocked(updateAffaireBriefServer)).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      summary: "Synthese revisee",
      scope: ["Lot gros oeuvre", "Lot facade"],
      vigilancePoints: ["Verifier les plans d execution"],
      assumptions: ["Le phasage reste a confirmer"],
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/dashboard/affaires");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}`
    );
    expect(result).toEqual({
      ok: true,
      status: "a_confirmer",
    });
  });

  it("promotes a document as primary and revalidates the affaire paths", async () => {
    vi.mocked(setAffaireDocumentAsPrimaryServer).mockResolvedValue({
      ok: true,
      documentPriority: "primary",
    });

    const result = await setAffaireDocumentAsPrimary({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });

    expect(vi.mocked(setAffaireDocumentAsPrimaryServer)).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/dashboard/affaires");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}`
    );
    expect(result).toEqual({
      ok: true,
      documentPriority: "primary",
    });
  });

  it("confirms a brief and revalidates the affaire paths", async () => {
    vi.mocked(confirmAffaireBriefServer).mockResolvedValue({
      ok: true,
      status: "confirme",
    });

    const result = await confirmAffaireBrief({
      projectId: PROJECT_ID,
    });

    expect(vi.mocked(confirmAffaireBriefServer)).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/dashboard/affaires");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}`
    );
    expect(result).toEqual({
      ok: true,
      status: "confirme",
    });
  });
});
