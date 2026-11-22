import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AffaireDossierOverview, affaireSectionFromLocation } from "@/components/affaires/AffaireWorkbench";
import type { DossierDocument } from "@/lib/affaires/document-triage";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-workspace-server";

const { reclassify, refresh } = vi.hoisted(() => ({ reclassify: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/dashboard/affaires/_actions/intake", () => ({ reclassifyAffaireDocument: reclassify }));

function document(id: string, overrides: Partial<DossierDocument> = {}): DossierDocument {
  return {
    documentId: id, fileName: `${id}.pdf`, uploadStatus: "uploaded",
    detectedCategory: "plans", classificationStatus: "classified", classificationSource: "ai",
    confidence: 0.99, issues: [],
    extractedMetadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
    ...overrides,
  };
}

function show(documents: DossierDocument[], isReadOnly = false) {
  const workspace: AffaireIntakeWorkspace = {
    projectId: "project", uploadId: null, canManageDocuments: true,
    documents, missingPieces: [], briefDraft: null,
  };
  return render(<AffaireDossierOverview workspace={workspace} clientName={null} registerSummary={null}
    registerEntries={[]} isReadOnly={isReadOnly} onOpenDocuments={vi.fn()} onAddDocuments={vi.fn()}
    onOpenDocument={vi.fn()} onReviewBrief={vi.fn()} onOpenRegister={vi.fn()} estimateHref={null} versionLabel="V1" />);
}

describe("dossier selection validation", () => {
  beforeEach(() => { vi.clearAllMocks(); reclassify.mockReset().mockResolvedValue(undefined); });

  it("requires an explicit click and a category for every selected eligible document", async () => {
    const user = userEvent.setup();
    show([
      document("plan"), document("cctp", { detectedCategory: "cctp" }),
      document("unknown", { detectedCategory: "a_classer", classificationStatus: "ambiguous" }),
      document("upload", { uploadStatus: "pending" }), document("deleted", { isBeingDeleted: true }),
    ]);
    await user.click(screen.getByRole("checkbox", { name: "Sélectionner les pièces affichées" }));
    expect(screen.getByRole("checkbox", { name: "Sélectionner upload.pdf" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sélectionner deleted.pdf" })).not.toBeChecked();
    const validate = screen.getByRole("button", { name: "Valider la sélection" });
    expect(validate).toBeDisabled();
    expect(reclassify).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Catégorie de unknown.pdf" }), "annexes");
    await user.click(validate);
    await waitFor(() => expect(reclassify).toHaveBeenCalledTimes(3));
    expect(reclassify.mock.calls.map(([input]) => [input.documentId, input.category])).toEqual([
      ["plan", "plans"], ["cctp", "cctp"], ["unknown", "annexes"],
    ]);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Sélectionner plan.pdf" })).not.toBeChecked());
    // Each classification re-renders the page in its own response. A refresh after them held the
    // saved state back until its own render had landed (TI-722).
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps only failed documents selected and retains their category for a retry", async () => {
    const user = userEvent.setup();
    reclassify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Enregistrement indisponible"));
    show([document("first"), document("retry")]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Catégorie de retry.pdf" }), "cctp");
    await user.click(screen.getByRole("checkbox", { name: "Sélectionner les pièces affichées" }));
    await user.click(screen.getByRole("button", { name: "Valider la sélection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enregistrement indisponible");
    expect(screen.getByRole("checkbox", { name: "Sélectionner first.pdf" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sélectionner retry.pdf" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Catégorie de retry.pdf" })).toHaveValue("cctp");
    await user.click(screen.getByRole("button", { name: "Valider la sélection" }));
    await waitFor(() => expect(reclassify).toHaveBeenCalledTimes(3));
    expect(reclassify).toHaveBeenLastCalledWith({ projectId: "project", documentId: "retry", category: "cctp" });
  });

  it("offers no bulk controls in a read-only dossier", () => {
    show([document("plan")], true);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Valider la sélection" })).not.toBeInTheDocument();
  });
});

describe("affaireSectionFromLocation", () => {
  // The takeoff's zone sits in « Vue d’ensemble » and « Chiffrage »: its anchor lands on one of them, never on the dossier.
  it("opens the takeoff's zone from its anchor, in the overview unless the link names « Chiffrage »", () => {
    expect(affaireSectionFromLocation(new URLSearchParams(), "#metre")).toBe("overview");
    expect(affaireSectionFromLocation(new URLSearchParams("view=estimate"), "#metre")).toBe("estimate");
    expect(affaireSectionFromLocation(new URLSearchParams("view=dossier"), "#metre")).toBe("overview");
  });
});

// While the dossier waits on its analysis the brief says so; past the server's limits it offers to read again.
describe("the brief while the dossier's analysis runs", () => {
  const workspace: AffaireIntakeWorkspace = { projectId: "project", uploadId: "upload-1", canManageDocuments: true,
    documents: [document("plan")], missingPieces: [], briefDraft: null };
  const overview = (follow: "idle" | "waiting" | "overdue", onRefresh = vi.fn()) => render(<AffaireDossierOverview workspace={workspace}
    clientName={null} registerSummary={null} registerEntries={[]} isReadOnly={false} onOpenDocuments={vi.fn()} onAddDocuments={vi.fn()}
    onOpenDocument={vi.fn()} onReviewBrief={vi.fn()} onOpenRegister={vi.fn()} estimateHref={null} versionLabel="V1"
    dossierFollow={{ state: follow, onRefresh }} />);

  it("says the brief is being prepared while the analysis runs", () => {
    overview("waiting");
    const brief = screen.getByRole("region", { name: "Résumé du brief" });
    expect(brief).toHaveTextContent("Analyse des pièces en cours : le brief est en préparation.");
    expect(screen.queryByRole("button", { name: "Actualiser" })).not.toBeInTheDocument();
  });

  it("says the brief may be ready and reads again on « Actualiser » past the server's limits", async () => {
    const onRefresh = vi.fn();
    overview("overdue", onRefresh);
    expect(screen.getByRole("region", { name: "Résumé du brief" }))
      .toHaveTextContent("L’analyse dure plus longtemps que prévu : le brief est peut-être prêt.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Actualiser" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("says nothing once the server recorded the end of the analysis", () => {
    overview("idle");
    expect(screen.queryByText(/le brief est en préparation|peut-être prêt/)).not.toBeInTheDocument();
  });
});
