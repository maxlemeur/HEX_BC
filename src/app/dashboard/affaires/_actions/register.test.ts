import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/affaires/register-server", () => ({
  createAffaireRegisterEntry: vi.fn(),
  updateAffaireRegisterEntryStatus: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import {
  createAffaireRegisterEntryAction,
  updateAffaireRegisterEntryStatusAction,
} from "@/app/dashboard/affaires/_actions/register";
import {
  createAffaireRegisterEntry,
  updateAffaireRegisterEntryStatus,
} from "@/lib/affaires/register-server";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ENTRY_ID = "33333333-3333-4333-8333-333333333333";

describe("affaire register server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an entry and revalidates affaire and estimate paths", async () => {
    vi.mocked(createAffaireRegisterEntry).mockResolvedValue({
      ok: true,
      entry: {
        id: ENTRY_ID,
        kind: "assumption",
        code: null,
        text: "Le phasage reste a confirmer.",
        severity: "warning",
        status: "open",
        originKind: "manual",
        scopeType: "project",
        scopeId: null,
        scopeRef: null,
        scopeLabel: "Affaire test",
        versionId: null,
        sourceDocumentId: null,
        sourceFileName: null,
        createdBy: null,
        createdByName: null,
        updatedBy: null,
        updatedByName: null,
        createdAt: "2026-03-06T10:00:00.000Z",
        updatedAt: "2026-03-06T10:00:00.000Z",
        history: [],
      },
    });

    const result = await createAffaireRegisterEntryAction({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      kind: "assumption",
      text: " Le phasage reste a confirmer. ",
      severity: "warning",
      scopeType: "project",
      scopeId: null,
      scopeRef: null,
      scopeLabel: null,
      sourceFileName: " note client.pdf ",
    });

    expect(vi.mocked(createAffaireRegisterEntry)).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      kind: "assumption",
      text: "Le phasage reste a confirmer.",
      severity: "warning",
      scopeType: "project",
      scopeId: null,
      scopeRef: null,
      scopeLabel: null,
      sourceFileName: "note client.pdf",
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/dashboard/affaires");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}`
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/estimates/${VERSION_ID}`
    );
    expect(result.ok).toBe(true);
  });

  it("updates an entry status and revalidates the register pages", async () => {
    vi.mocked(updateAffaireRegisterEntryStatus).mockResolvedValue({
      ok: true,
      entry: {
        id: ENTRY_ID,
        kind: "missing_piece",
        code: "cctp",
        text: "CCTP complet",
        severity: "critical",
        status: "validated",
        originKind: "system",
        scopeType: "project",
        scopeId: null,
        scopeRef: null,
        scopeLabel: "Affaire test",
        versionId: VERSION_ID,
        sourceDocumentId: null,
        sourceFileName: null,
        createdBy: null,
        createdByName: null,
        updatedBy: null,
        updatedByName: null,
        createdAt: "2026-03-06T10:00:00.000Z",
        updatedAt: "2026-03-06T10:05:00.000Z",
        history: [],
      },
    });

    const result = await updateAffaireRegisterEntryStatusAction({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      entryId: ENTRY_ID,
      status: "validated",
      comment: "Piece fournie par le client.",
    });

    expect(vi.mocked(updateAffaireRegisterEntryStatus)).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      entryId: ENTRY_ID,
      status: "validated",
      comment: "Piece fournie par le client.",
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/dashboard/affaires");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}`
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/estimates/${VERSION_ID}`
    );
    expect(result.ok).toBe(true);
  });
});
