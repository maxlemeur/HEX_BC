import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/affaires/intake-server", () => ({
  reclassifyAffaireDocument: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import { reclassifyAffaireDocument } from "@/app/dashboard/affaires/_actions/intake";
import { reclassifyAffaireDocument as reclassifyAffaireDocumentServer } from "@/lib/affaires/intake-server";

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
});
