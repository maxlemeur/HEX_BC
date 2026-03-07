import type {
  GeneratedOuvrageCandidate,
  GeneratedOuvrageCandidateSource,
  GeneratedOuvrageRiskSignal,
  GeneratedOuvrageSubdetailComponent,
  GeneratedOuvrageSubdetailResult,
} from "@/lib/estimates/generated-ouvrages";

export type { GeneratedOuvrageCandidateSource };

export type CandidateEdits = {
  designation: string;
  unit: string | null;
  quantity: number | null;
  lotId: string | null;
};

export type UiGeneratedOuvrageCandidate = GeneratedOuvrageCandidate & {
  selected: boolean;
  isEditing: boolean;
  editedDesignation: string;
  editedUnit: string | null;
  editedQuantity: number | null;
  editedLotId: string | null;
  subdetailStatus: GeneratedOuvrageSubdetailResult["status"] | null;
  subdetailReviewed: boolean;
};

export type GeneratedOuvrageParentReadiness = {
  isReady: boolean;
  missingFields: Array<"designation" | "unit" | "quantity">;
};

export type GeneratedOuvrageSubdetailEditorComponent = {
  componentId: string | null;
  status: GeneratedOuvrageSubdetailComponent["status"];
  costType: GeneratedOuvrageSubdetailComponent["costType"];
  designation: string;
  unit: string | null;
  quantity: number;
  unitCostHtCents: number;
  lossCoeffBp: number;
  yieldValue: number | null;
  yieldUnit: string | null;
  confidence: number;
  sourceLabel: string | null;
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  riskSignals: GeneratedOuvrageRiskSignal[];
  sources: Array<{
    sourceFragmentId: string;
    evidenceKind: "fact" | "hypothesis" | "inference";
    note: string | null;
  }>;
};

export type GeneratedOuvrageSubdetailUiState = {
  status: "idle" | "loading" | "saving" | "error";
  data: GeneratedOuvrageSubdetailResult | null;
  errorMessage: string | null;
};

export type ExistingSection = {
  id: string;
  path: string;
  hierarchyLevel: number;
  parentId: string | null;
  title: string;
};

export const GENERATED_OUVRAGE_FALLBACK_SECTION_LABEL = "A classer (par defaut)";

export function formatGeneratedOuvrageLotLabel(input: {
  lotId: string | null;
  existingSections: ExistingSection[];
}) {
  if (!input.lotId) {
    return GENERATED_OUVRAGE_FALLBACK_SECTION_LABEL;
  }

  return (
    input.existingSections.find((section) => section.id === input.lotId)?.path ??
    "Lot inconnu"
  );
}

export function initUiCandidates(
  candidates: GeneratedOuvrageCandidate[],
  existingUi?: UiGeneratedOuvrageCandidate[]
): UiGeneratedOuvrageCandidate[] {
  const existingById = new Map(
    (existingUi ?? []).map((c) => [c.candidateId, c])
  );

  return candidates.map((c) => {
    const existing = existingById.get(c.candidateId);
    if (existing && c.resolutionStatus === "pending") {
      return {
        ...c,
        selected: existing.selected,
        isEditing: existing.isEditing,
        editedDesignation: existing.editedDesignation,
        editedUnit: existing.editedUnit,
        editedQuantity: existing.editedQuantity,
        editedLotId: existing.editedLotId,
        subdetailStatus: existing.subdetailStatus,
        subdetailReviewed: existing.subdetailReviewed,
      };
    }
    return {
      ...c,
      selected: false,
      isEditing: false,
      editedDesignation: c.designation,
      editedUnit: c.unit,
      editedQuantity: c.quantity,
      editedLotId: c.suggestedLotId,
      subdetailStatus: null,
      subdetailReviewed: false,
    };
  });
}

export function getGeneratedOuvrageParentReadiness(
  candidate: Pick<
    UiGeneratedOuvrageCandidate,
    "editedDesignation" | "editedUnit" | "editedQuantity"
  >
): GeneratedOuvrageParentReadiness {
  const missingFields: GeneratedOuvrageParentReadiness["missingFields"] = [];

  if (!candidate.editedDesignation.trim()) {
    missingFields.push("designation");
  }

  if (!candidate.editedUnit?.trim()) {
    missingFields.push("unit");
  }

  if (
    candidate.editedQuantity == null ||
    !Number.isFinite(candidate.editedQuantity) ||
    candidate.editedQuantity <= 0
  ) {
    missingFields.push("quantity");
  }

  return {
    isReady: missingFields.length === 0,
    missingFields,
  };
}

export function describeGeneratedOuvrageMissingFields(
  missingFields: GeneratedOuvrageParentReadiness["missingFields"]
) {
  return missingFields
    .map((field) => {
      if (field === "designation") return "designation";
      if (field === "unit") return "unite";
      return "quantite";
    })
    .join(", ");
}

export function isGeneratedOuvrageReadyForInsert(
  candidate: Pick<
    UiGeneratedOuvrageCandidate,
    "editedDesignation" | "editedUnit" | "editedQuantity" | "subdetailReviewed"
  >
) {
  return (
    getGeneratedOuvrageParentReadiness(candidate).isReady &&
    candidate.subdetailReviewed
  );
}
