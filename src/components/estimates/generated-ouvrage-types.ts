import type {
  GeneratedOuvrageCandidate,
  GeneratedOuvrageCandidateSource,
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
    };
  });
}
