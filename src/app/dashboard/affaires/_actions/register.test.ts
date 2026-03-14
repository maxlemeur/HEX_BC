import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/affaires/register-server", () => ({
  continueAffaireRegisterWithHypothesis: vi.fn(),
  createAffaireRegisterEntry: vi.fn(),
  requestAffaireRegisterRevalidation: vi.fn(),
  updateAffaireRegisterEntryFollowUp: vi.fn(),
  updateAffaireRegisterEntryStatus: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import {
  continueAffaireRegisterWithHypothesisAction,
  createAffaireRegisterEntryAction,
  requestAffaireRegisterRevalidationAction,
  updateAffaireRegisterEntryFollowUpAction,
  updateAffaireRegisterEntryStatusAction,
} from "@/app/dashboard/affaires/_actions/register";
import {
  continueAffaireRegisterWithHypothesis,
  createAffaireRegisterEntry,
  requestAffaireRegisterRevalidation,
  updateAffaireRegisterEntryFollowUp,
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

  it("updates severity, owner and due date and revalidates the register pages", async () => {
    vi.mocked(updateAffaireRegisterEntryFollowUp).mockResolvedValue({
      ok: true,
      entry: {
        id: ENTRY_ID,
        kind: "missing_piece",
        code: "missing_dpgf",
        text: "DPGF manquant",
        severity: "warning",
        status: "open",
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
        severityDecision: {
          mode: "manual",
          canonicalSeverity: "critical",
          overriddenSeverity: "warning",
          updatedAt: "2026-03-06T10:05:00.000Z",
          updatedByUserId: PROJECT_ID,
          comment: "Mode budget assume.",
        },
        followUp: {
          ownerUserId: "44444444-4444-4444-8444-444444444444",
          ownerName: "Marie Curie",
          dueDate: "2026-03-20",
          updatedAt: "2026-03-06T10:05:00.000Z",
          updatedByUserId: PROJECT_ID,
          comment: "Mode budget assume.",
        },
        history: [],
      },
    });

    const result = await updateAffaireRegisterEntryFollowUpAction({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      entryId: ENTRY_ID,
      severity: "warning",
      ownerUserId: "44444444-4444-4444-8444-444444444444",
      dueDate: "2026-03-20",
      comment: " Mode budget assume. ",
    });

    expect(vi.mocked(updateAffaireRegisterEntryFollowUp)).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      entryId: ENTRY_ID,
      severity: "warning",
      ownerUserId: "44444444-4444-4444-8444-444444444444",
      dueDate: "2026-03-20",
      comment: "Mode budget assume.",
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

  it("continues with hypothesis and revalidates affaire and estimate paths", async () => {
    vi.mocked(continueAffaireRegisterWithHypothesis).mockResolvedValue({
      ok: true,
      entry: {
        id: ENTRY_ID,
        kind: "missing_piece",
        code: "missing_dpgf",
        text: "DPGF manquant",
        severity: "critical",
        status: "open",
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
        continuationDecision: {
          status: "accepted_with_hypothesis",
          hypothesisEntryId: "44444444-4444-4444-8444-444444444444",
          hypothesisText:
            "Continuation acceptee sans dpgf manquant. Hypothese documentaire a confirmer avant remise.",
          acceptedAt: "2026-03-06T10:05:00.000Z",
          acceptedByUserId: PROJECT_ID,
          comment: "Budget exploratoire maintenu.",
        },
        history: [],
      },
      hypothesisEntry: null,
    });

    const result = await continueAffaireRegisterWithHypothesisAction({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      entryId: ENTRY_ID,
      comment: " Budget exploratoire maintenu. ",
    });

    expect(vi.mocked(continueAffaireRegisterWithHypothesis)).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      entryId: ENTRY_ID,
      comment: "Budget exploratoire maintenu.",
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

  it("requests revalidation and revalidates affaire and estimate paths", async () => {
    vi.mocked(requestAffaireRegisterRevalidation).mockResolvedValue({
      ok: true,
      entry: {
        id: ENTRY_ID,
        kind: "missing_piece",
        code: "missing_dpgf",
        text: "DPGF manquant",
        severity: "critical",
        status: "open",
        originKind: "system",
        scopeType: "project",
        scopeId: null,
        scopeRef: null,
        scopeLabel: "Affaire test",
        versionId: VERSION_ID,
        sourceDocumentId: null,
        sourceFileName: "additif-lot-c.pdf",
        createdBy: null,
        createdByName: null,
        updatedBy: null,
        updatedByName: null,
        createdAt: "2026-03-06T10:00:00.000Z",
        updatedAt: "2026-03-06T10:05:00.000Z",
        revalidationRequest: {
          status: "required",
          requestedAt: "2026-03-06T10:05:00.000Z",
          requestedByUserId: PROJECT_ID,
          previousStatus: "validated",
          cause: "addendum_received",
          triggerDocumentId: "44444444-4444-4444-8444-444444444444",
          triggerFileName: "additif-lot-c.pdf",
          impactedStages: ["document_review", "submission_readiness"],
          comment: "Verifier le lot C apres additif.",
        },
        history: [],
      },
    });

    const result = await requestAffaireRegisterRevalidationAction({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      entryId: ENTRY_ID,
      cause: "addendum_received",
      impactedStages: ["document_review", "submission_readiness"],
      triggerDocumentId: "44444444-4444-4444-8444-444444444444",
      triggerFileName: " additif-lot-c.pdf ",
      comment: " Verifier le lot C apres additif. ",
    });

    expect(vi.mocked(requestAffaireRegisterRevalidation)).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      entryId: ENTRY_ID,
      cause: "addendum_received",
      impactedStages: ["document_review", "submission_readiness"],
      triggerDocumentId: "44444444-4444-4444-8444-444444444444",
      triggerFileName: "additif-lot-c.pdf",
      comment: "Verifier le lot C apres additif.",
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
