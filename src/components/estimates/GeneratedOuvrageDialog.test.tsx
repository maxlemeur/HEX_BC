import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

import type {
  GeneratedOuvrageCandidate,
  GeneratedOuvrageDraftResult,
  GeneratedOuvrageSubdetailResult,
  InsertGeneratedOuvragesResult,
  RejectGeneratedOuvrageDraftResult,
} from "@/lib/estimates/generated-ouvrages";

const mockGenerateOuvragesFromText = vi.fn();
const mockFetchGeneratedOuvrageDraft = vi.fn();
const mockFetchGeneratedOuvrageSubdetailDraft = vi.fn();
const mockInsertGeneratedOuvrages = vi.fn();
const mockRejectGeneratedOuvrageDraft = vi.fn();
const mockUpdateGeneratedOuvrageSubdetailDraft = vi.fn();

vi.mock("@/app/dashboard/affaires/_actions/generated-ouvrages", () => ({
  generateOuvragesFromText: (...args: unknown[]) =>
    mockGenerateOuvragesFromText(...args),
  fetchGeneratedOuvrageDraft: (...args: unknown[]) =>
    mockFetchGeneratedOuvrageDraft(...args),
  fetchGeneratedOuvrageSubdetailDraft: (...args: unknown[]) =>
    mockFetchGeneratedOuvrageSubdetailDraft(...args),
  insertGeneratedOuvrages: (...args: unknown[]) =>
    mockInsertGeneratedOuvrages(...args),
  rejectGeneratedOuvrageDraft: (...args: unknown[]) =>
    mockRejectGeneratedOuvrageDraft(...args),
  updateGeneratedOuvrageSubdetailDraft: (...args: unknown[]) =>
    mockUpdateGeneratedOuvrageSubdetailDraft(...args),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    push: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import {
  GeneratedOuvrageDialog,
  type GeneratedOuvrageDialogProps,
} from "./GeneratedOuvrageDialog";

function makeDraftResult(
  overrides?: Partial<GeneratedOuvrageDraftResult>,
  candidatesOverride?: GeneratedOuvrageCandidate[]
): GeneratedOuvrageDraftResult {
  const candidates: GeneratedOuvrageCandidate[] = candidatesOverride ?? [
    {
      candidateId: "c1",
      suggestedLotId: null,
      lotLabel: null,
      designation: "Mur en beton",
      unit: "m2",
      quantity: 50,
      confidence: 0.95,
      status: "certain",
      resolutionStatus: "pending",
      reasoning: "Identified from CCTP section 3.1",
      sources: [
        {
          sourceFragmentId: "sf1",
          sourceDocumentId: null,
          type: "text",
          label: "Source 1",
          excerpt: "Mur en beton arme...",
          sourceFileName: null,
          sourcePageFrom: null,
          sourcePageTo: null,
          selectionLabel: null,
        },
      ],
    },
    {
      candidateId: "c2",
      suggestedLotId: null,
      lotLabel: null,
      designation: "Enduit de facade",
      unit: "m2",
      quantity: 100,
      confidence: 0.7,
      status: "plausible",
      resolutionStatus: "pending",
      reasoning: null,
      sources: [],
    },
    {
      candidateId: "c3",
      suggestedLotId: null,
      lotLabel: null,
      designation: "Cloison a verifier",
      unit: null,
      quantity: null,
      confidence: 0.3,
      status: "question",
      resolutionStatus: "pending",
      reasoning: "Needs clarification",
      sources: [],
    },
  ];

  return {
    draftId: "draft-1",
    versionId: "v1",
    projectId: "p1",
    sourceKind: "free_text",
    preferredLotId: null,
    status: "pending",
    summary: {
      totalCandidates: candidates.length,
      certainCount: candidates.filter((c) => c.status === "certain").length,
      plausibleCount: candidates.filter((c) => c.status === "plausible").length,
      questionCount: candidates.filter((c) => c.status === "question").length,
      pendingCount: candidates.filter(
        (c) => c.resolutionStatus === "pending"
      ).length,
      insertedCount: candidates.filter(
        (c) => c.resolutionStatus === "inserted"
      ).length,
      rejectedCount: candidates.filter(
        (c) => c.resolutionStatus === "rejected"
      ).length,
    },
    generatedAt: new Date().toISOString(),
    candidates,
    ...overrides,
  };
}

function makeSubdetailResult(
  candidate: GeneratedOuvrageCandidate,
  overrides?: Partial<GeneratedOuvrageSubdetailResult>
): GeneratedOuvrageSubdetailResult {
  return {
    draftId: "draft-1",
    candidateId: candidate.candidateId,
    versionId: "v1",
    projectId: "p1",
    status: "pending_review",
    humanValidationRequired: true,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    summary: {
      componentCount: 2,
      dsCents: 4500,
      indicativeTargetPriceCents: 5850,
      confidence: 0.72,
      pricingSource: "heuristic_review_draft",
      riskSignals: [],
      facts: ["Ouvrage parent: Mur en beton"],
      hypotheses: [],
      inferences: [],
    },
    components: [
      {
        componentId: "comp-1",
        status: "suggested",
        costType: "material",
        designation: candidate.designation,
        unit: candidate.unit,
        quantity: 1,
        unitCostHtCents: 3000,
        lossCoeffBp: 500,
        yieldValue: null,
        yieldUnit: null,
        confidence: 0.7,
        sourceLabel: "Source 1",
        dsCents: 3150,
        facts: ["Ouvrage parent: Mur en beton"],
        hypotheses: [],
        inferences: [],
        riskSignals: [],
        sources: [
          {
            sourceFragmentId: "sf1",
            sourceDocumentId: null,
            type: "text",
            label: "Source 1",
            excerpt: "Mur en beton arme...",
            sourceFileName: null,
            sourcePageFrom: null,
            sourcePageTo: null,
            selectionLabel: null,
            evidenceKind: "fact",
            note: "Source primaire du besoin parent",
          },
        ],
      },
      {
        componentId: "comp-2",
        status: "suggested",
        costType: "labor",
        designation: `Main d'oeuvre - ${candidate.designation}`,
        unit: "h",
        quantity: 1,
        unitCostHtCents: 1350,
        lossCoeffBp: 0,
        yieldValue: 0.45,
        yieldUnit: "h/m2",
        confidence: 0.66,
        sourceLabel: "Source 1",
        dsCents: 1350,
        facts: [],
        hypotheses: ["Rendement MO estime a partir du type d'ouvrage et doit etre valide."],
        inferences: ["Presence de pose -> besoin de main d'oeuvre."],
        riskSignals: [],
        sources: [],
      },
    ],
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const defaultProps: GeneratedOuvrageDialogProps = {
  isOpen: true,
  targetVersionId: "v1",
  projectId: "p1",
  existingSections: [
    {
      id: "lot1",
      path: "Lot 1 - Gros oeuvre",
      hierarchyLevel: 1,
      parentId: null,
      title: "Lot 1 - Gros oeuvre",
    },
  ],
  onClose: vi.fn(),
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function reviewSubdetailForCandidate(user: ReturnType<typeof userEvent.setup>, candidateId = "c1") {
  const candidate = makeDraftResult().candidates.find((entry) => entry.candidateId === candidateId);
  if (!candidate) {
    throw new Error("Candidate introuvable.");
  }

  mockFetchGeneratedOuvrageSubdetailDraft.mockResolvedValueOnce(
    makeSubdetailResult(candidate)
  );
  mockUpdateGeneratedOuvrageSubdetailDraft.mockResolvedValueOnce(
    makeSubdetailResult(candidate, { status: "reviewed" })
  );

  const card = screen.getByTestId(`candidate-card-${candidateId}`);
  await user.click(
    within(card).getByRole("button", { name: /Valider le sous-detail/i })
  );
  await waitFor(() => {
    expect(mockFetchGeneratedOuvrageSubdetailDraft).toHaveBeenCalled();
  });
  const subdetailEditor = await screen.findByText("Sous-detail compose");
  await waitFor(() => {
    expect(subdetailEditor).toBeInTheDocument();
  });
  await user.click(
    within(subdetailEditor.closest("section") as HTMLElement).getByRole(
      "button",
      { name: /^Valider le sous-detail$/i }
    )
  );
  await waitFor(() => {
    expect(mockUpdateGeneratedOuvrageSubdetailDraft).toHaveBeenCalled();
  });
}

describe("GeneratedOuvrageDialog", () => {
  it("shows input form initially", () => {
    render(<GeneratedOuvrageDialog {...defaultProps} />);
    expect(screen.getByLabelText("Texte source")).toBeInTheDocument();
    expect(
      screen.getByTestId("generated-ouvrage-generate-button")
    ).toBeInTheDocument();
  });

  it("renders in a body portal so dashboard stacking contexts cannot cover it", () => {
    const stackingContext = document.createElement("div");
    document.body.appendChild(stackingContext);

    const { unmount } = render(<GeneratedOuvrageDialog {...defaultProps} />, {
      container: stackingContext,
    });
    const dialog = screen.getByRole("dialog", { name: "Generer des ouvrages" });

    expect(document.body).toContainElement(dialog);
    expect(stackingContext).not.toContainElement(dialog);

    unmount();
    stackingContext.remove();
  });

  it("generates from free text and displays candidates", async () => {
    const draftResult = makeDraftResult();
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Texte source"),
      "Construction de murs en beton"
    );
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Mur en beton")).toBeInTheDocument();
    });

    // Verify all three status badges are visible
    expect(screen.getByText("Certain")).toBeInTheDocument();
    expect(screen.getByText("Plausible")).toBeInTheDocument();
    expect(screen.getByText("A clarifier")).toBeInTheDocument();
  });

  it("shows CCTP source with document metadata in provenance", async () => {
    const candidateWithCctp: GeneratedOuvrageCandidate[] = [
      {
        candidateId: "c1",
        suggestedLotId: null,
        lotLabel: null,
        designation: "Isolation thermique",
        unit: "m2",
        quantity: 200,
        confidence: 0.9,
        status: "certain",
        resolutionStatus: "pending",
        reasoning: null,
        sources: [
          {
            sourceFragmentId: "sf1",
            sourceDocumentId: "doc1",
            type: "cctp",
            label: "CCTP Article 4.2",
            excerpt: "Isolation thermique par l'exterieur...",
            sourceFileName: "CCTP_Lot4.pdf",
            sourcePageFrom: 12,
            sourcePageTo: 14,
            selectionLabel: null,
          },
        ],
      },
    ];

    const draftResult = makeDraftResult(
      { sourceKind: "cctp_excerpt" },
      candidateWithCctp
    );
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Texte source"), "Extrait CCTP");
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Isolation thermique")).toBeInTheDocument();
    });

    // Expand provenance
    await user.click(screen.getByText("Voir les sources (1)"));

    expect(screen.getByText("CCTP")).toBeInTheDocument();
    expect(screen.getByText("CCTP Article 4.2")).toBeInTheDocument();
    expect(
      screen.getByText(/CCTP_Lot4\.pdf/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/p\. 12-14/)
    ).toBeInTheDocument();
  });

  it("edits candidate then sends edited values to insertGeneratedOuvrages", async () => {
    const draftResult = makeDraftResult();
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    const insertResult: InsertGeneratedOuvragesResult = {
      ok: true,
      insertedCount: 1,
      draftStatus: "applied",
      projectId: "p1",
      versionId: "v1",
    };
    mockInsertGeneratedOuvrages.mockResolvedValueOnce(insertResult);

    const reloadedDraft = makeDraftResult({
      status: "applied",
    }, [
      {
        ...draftResult.candidates[0],
        resolutionStatus: "inserted",
      },
      {
        ...draftResult.candidates[1],
        resolutionStatus: "rejected",
      },
      {
        ...draftResult.candidates[2],
        resolutionStatus: "rejected",
      },
    ]);
    mockFetchGeneratedOuvrageDraft.mockResolvedValueOnce(reloadedDraft);

    render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Texte source"),
      "Construction"
    );
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Mur en beton")).toBeInTheDocument();
    });

    // Start editing candidate c1
    const card = screen.getByTestId("candidate-card-c1");
    const editButton = within(card).getByText("Modifier");
    await user.click(editButton);

    // Edit designation
    const designationInput = screen.getByTestId("edit-designation");
    await user.clear(designationInput);
    await user.type(designationInput, "Mur en beton arme modifie");
    await user.click(screen.getByRole("button", { name: /Valider la ligne/i }));

    // Select the edited candidate
    const checkbox = within(
      screen.getByTestId("candidate-card-c1")
    ).getByRole("checkbox");
    await user.click(checkbox);

    await reviewSubdetailForCandidate(user, "c1");

    expect(mockUpdateGeneratedOuvrageSubdetailDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: "c1",
        reviewedCandidate: {
          designation: "Mur en beton arme modifie",
          unit: "m2",
          quantity: 50,
        },
      })
    );

    // Insert
    await user.click(screen.getByTestId("generated-ouvrage-insert-button"));

    await waitFor(() => {
      expect(mockInsertGeneratedOuvrages).toHaveBeenCalledWith(
        expect.objectContaining({
          acceptedCandidates: [
            expect.objectContaining({
              candidateId: "c1",
              designation: "Mur en beton arme modifie",
            }),
          ],
        })
      );
    });
  });

  it("invalidates reviewed subdetail when reviewed candidate values change", async () => {
    const draftResult = makeDraftResult();
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Texte source"), "Construction");
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Mur en beton")).toBeInTheDocument();
    });

    await reviewSubdetailForCandidate(user, "c1");

    const checkbox = within(
      screen.getByTestId("candidate-card-c1")
    ).getByRole("checkbox");
    await user.click(checkbox);

    expect(
      screen.getByText(/1 ouvrage\(s\) selectionne\(s\) pret\(s\) a inserer\./i)
    ).toBeInTheDocument();

    const card = screen.getByTestId("candidate-card-c1");
    await user.click(within(card).getByText("Modifier"));
    await user.clear(screen.getByTestId("edit-quantity"));
    await user.type(screen.getByTestId("edit-quantity"), "80");
    await user.click(screen.getByRole("button", { name: /Valider la ligne/i }));

    expect(
      screen.getByText(
        /Les modifications du parent imposent une nouvelle validation du sous-detail\./i
      )
    ).toBeInTheDocument();
    const updatedCard = screen.getByTestId("candidate-card-c1");
    expect(
      within(updatedCard).getByText(
        /Ligne complete\. Validez le sous-detail pour debloquer l'insertion\./i
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId("generated-ouvrage-insert-button")).toBeDisabled();
  });

  it("blocks selection when parent inputs are incomplete and guides the user", async () => {
    const draftResult = makeDraftResult();
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Texte source"), "Test");
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Cloison a verifier")).toBeInTheDocument();
    });

    const incompleteCard = screen.getByTestId("candidate-card-c3");
    expect(
      within(incompleteCard).getByText(/Cet ouvrage n'est pas pret a etre insere\./i)
    ).toBeInTheDocument();
    expect(within(incompleteCard).getByRole("checkbox")).toBeDisabled();
    expect(
      within(incompleteCard).getByRole("button", { name: /Completer la ligne/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Selectionnez un ouvrage pret a inserer\. Unite, quantite et sous-detail valide sont requis\./i
      )
    ).toBeInTheDocument();
  });

  it("keeps the insert CTA name stable across review states", async () => {
    const draftResult = makeDraftResult();
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Texte source"), "Test");
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Mur en beton")).toBeInTheDocument();
    });

    const insertButton = screen.getByRole("button", {
      name: /Inserer les ouvrages selectionnes/i,
    });
    expect(insertButton).toBeDisabled();

    const checkbox = within(
      screen.getByTestId("candidate-card-c1")
    ).getByRole("checkbox");
    await user.click(checkbox);
    expect(
      screen.getByRole("button", {
        name: /Inserer les ouvrages selectionnes/i,
      })
    ).toBeDisabled();

    await reviewSubdetailForCandidate(user, "c1");

    expect(
      screen.getByRole("button", {
        name: /Inserer les ouvrages selectionnes/i,
      })
    ).toBeEnabled();
  });

  it("shows sources for incomplete candidates in review mode", async () => {
    const baseDraft = makeDraftResult();
    const draftResult = makeDraftResult(undefined, [
      baseDraft.candidates[0],
      baseDraft.candidates[1],
      {
        ...baseDraft.candidates[2],
        sources: [
          {
            sourceFragmentId: "sf-incomplete",
            sourceDocumentId: null,
            type: "text",
            label: "Source incomplete",
            excerpt: "Quantite et unite absentes dans l'extrait.",
            sourceFileName: null,
            sourcePageFrom: null,
            sourcePageTo: null,
            selectionLabel: null,
          },
        ],
      },
    ]);
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Texte source"), "Test");
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Cloison a verifier")).toBeInTheDocument();
    });

    const incompleteCard = screen.getByTestId("candidate-card-c3");
    await user.click(
      within(incompleteCard).getByRole("button", {
        name: /Voir les sources \(1\)/i,
      })
    );

    expect(within(incompleteCard).getByText("Source incomplete")).toBeInTheDocument();
    expect(
      within(incompleteCard).getByText(/Quantite et unite absentes dans l'extrait\./i)
    ).toBeInTheDocument();
  });

  it("rejects a candidate and calls fetchGeneratedOuvrageDraft after", async () => {
    const draftResult = makeDraftResult();
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    const rejectResult: RejectGeneratedOuvrageDraftResult = {
      ok: true,
      draftStatus: "pending",
      projectId: "p1",
      versionId: "v1",
    };
    mockRejectGeneratedOuvrageDraft.mockResolvedValueOnce(rejectResult);

    const reloadedDraft = makeDraftResult({}, [
      draftResult.candidates[0],
      draftResult.candidates[1],
      {
        ...draftResult.candidates[2],
        resolutionStatus: "rejected",
      },
    ]);
    reloadedDraft.summary.rejectedCount = 1;
    reloadedDraft.summary.pendingCount = 2;
    mockFetchGeneratedOuvrageDraft.mockResolvedValueOnce(reloadedDraft);

    render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Texte source"), "Test");
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Cloison a verifier")).toBeInTheDocument();
    });

    // Reject candidate c3
    const card3 = screen.getByTestId("candidate-card-c3");
    const rejectBtn = within(card3).getByText("Rejeter");
    await user.click(rejectBtn);

    await waitFor(() => {
      expect(mockRejectGeneratedOuvrageDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          draftId: "draft-1",
          candidateId: "c3",
        })
      );
    });

    await waitFor(() => {
      expect(mockFetchGeneratedOuvrageDraft).toHaveBeenCalled();
    });
  });

  it("shows discarded state when all candidates are rejected", async () => {
    const draftResult = makeDraftResult({}, [
      {
        candidateId: "c1",
        suggestedLotId: null,
        lotLabel: null,
        designation: "Ouvrage unique",
        unit: null,
        quantity: null,
        confidence: 0.5,
        status: "plausible",
        resolutionStatus: "pending",
        reasoning: null,
        sources: [],
      },
    ]);
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    const rejectResult: RejectGeneratedOuvrageDraftResult = {
      ok: true,
      draftStatus: "discarded",
      projectId: "p1",
      versionId: "v1",
    };
    mockRejectGeneratedOuvrageDraft.mockResolvedValueOnce(rejectResult);

    const reloadedDraft = makeDraftResult(
      { status: "discarded" },
      [
        {
          ...draftResult.candidates[0],
          resolutionStatus: "rejected",
        },
      ]
    );
    reloadedDraft.summary = {
      totalCandidates: 1,
      certainCount: 0,
      plausibleCount: 0,
      questionCount: 0,
      pendingCount: 0,
      insertedCount: 0,
      rejectedCount: 1,
    };
    mockFetchGeneratedOuvrageDraft.mockResolvedValueOnce(reloadedDraft);

    render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Texte source"), "Test");
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Ouvrage unique")).toBeInTheDocument();
    });

    const card = screen.getByTestId("candidate-card-c1");
    await user.click(within(card).getByText("Rejeter"));

    await waitFor(() => {
      expect(mockFetchGeneratedOuvrageDraft).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Toutes les propositions ont ete rejetees ou ecartees\./i)
      ).toBeInTheDocument();
    });
  });

  it("partial insertion keeps dialog open and calls fetchGeneratedOuvrageDraft", async () => {
    const draftResult = makeDraftResult();
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    const insertResult: InsertGeneratedOuvragesResult = {
      ok: true,
      insertedCount: 1,
      draftStatus: "partially_applied",
      projectId: "p1",
      versionId: "v1",
    };
    mockInsertGeneratedOuvrages.mockResolvedValueOnce(insertResult);

    const reloadedDraft = makeDraftResult(
      { status: "partially_applied" },
      [
        {
          ...draftResult.candidates[0],
          resolutionStatus: "inserted",
        },
        draftResult.candidates[1],
        draftResult.candidates[2],
      ]
    );
    reloadedDraft.summary.insertedCount = 1;
    reloadedDraft.summary.pendingCount = 2;
    mockFetchGeneratedOuvrageDraft.mockResolvedValueOnce(reloadedDraft);

    const onClose = vi.fn();
    render(
      <GeneratedOuvrageDialog {...defaultProps} onClose={onClose} />
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Texte source"), "Test");
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Mur en beton")).toBeInTheDocument();
    });

    // Select first candidate
    const checkbox = within(
      screen.getByTestId("candidate-card-c1")
    ).getByRole("checkbox");
    await user.click(checkbox);

    await reviewSubdetailForCandidate(user, "c1");

    await user.click(screen.getByTestId("generated-ouvrage-insert-button"));

    await waitFor(() => {
      expect(mockFetchGeneratedOuvrageDraft).toHaveBeenCalled();
    });

    // Dialog stays open - onClose not called
    expect(onClose).not.toHaveBeenCalled();

    // Inserted candidate now shown as locked
    await waitFor(() => {
      expect(screen.getByText("Insere")).toBeInTheDocument();
    });
  });

  it("shows the explicit fallback section when lotId is null", async () => {
    const draftResult = makeDraftResult();
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Texte source"), "Test");
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Mur en beton")).toBeInTheDocument();
    });

    const card = screen.getByTestId("candidate-card-c1");
    expect(within(card).getByText(/A classer/)).toBeInTheDocument();
  });

  it("shows already-inserted candidates as locked", async () => {
    const draftResult = makeDraftResult({}, [
      {
        candidateId: "c1",
        suggestedLotId: null,
        lotLabel: null,
        designation: "Deja insere",
        unit: "m2",
        quantity: 10,
        confidence: 0.9,
        status: "certain",
        resolutionStatus: "inserted",
        reasoning: null,
        sources: [],
      },
    ]);
    draftResult.summary.insertedCount = 1;
    draftResult.summary.pendingCount = 0;
    mockGenerateOuvragesFromText.mockResolvedValueOnce(draftResult);

    render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Texte source"), "Test");
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(screen.getByText("Insere")).toBeInTheDocument();
    });

    // No checkbox should be visible
    const card = screen.getByTestId("candidate-card-c1");
    expect(within(card).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    render(
      <GeneratedOuvrageDialog {...defaultProps} isOpen={false} />
    );
    expect(
      screen.queryByRole("dialog")
    ).not.toBeInTheDocument();
  });

  it("ignores completed generation requests after the dialog closes", async () => {
    const deferred = createDeferred<GeneratedOuvrageDraftResult>();
    mockGenerateOuvragesFromText.mockReturnValueOnce(deferred.promise);

    const { rerender } = render(<GeneratedOuvrageDialog {...defaultProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Texte source"), "Construction");
    await user.click(screen.getByTestId("generated-ouvrage-generate-button"));

    await waitFor(() => {
      expect(mockGenerateOuvragesFromText).toHaveBeenCalledTimes(1);
    });

    rerender(<GeneratedOuvrageDialog {...defaultProps} isOpen={false} />);

    await act(async () => {
      deferred.resolve(makeDraftResult());
      await deferred.promise;
    });

    rerender(<GeneratedOuvrageDialog {...defaultProps} isOpen />);

    await waitFor(() => {
      expect(screen.getByLabelText("Texte source")).toBeInTheDocument();
    });
    expect(screen.queryByText("Mur en beton")).not.toBeInTheDocument();
  });
});
