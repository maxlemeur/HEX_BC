import type { EstimateEngineVersion } from "@/lib/estimates/engine/capabilities";
import type { StoredDpgfComposition } from "@/lib/takeoff/dpgf-composition";
import type { Poste } from "@/lib/takeoff/poste-list";

/** An item of the plan's sealed list revision. */
export type ItemSendListItem = Pick<Poste, "id" | "label" | "expectedUnit" | "measurementBasis" | "qualifiers" | "sections" | "origin"
  | "referenceQuantity">;

/** An observation of a stored answer (lot 4 PR 3a): only a contribution counts. */
export type ItemSendObservation = {
  observationId: string;
  role: "contribution" | "candidate" | "alternative";
  source: "model" | "vector";
  quantity: number | null;
  unit: string | null;
  /** The plan's original page, 1-based. */
  page: number | null;
  measurementBasis: string | null;
};

export type ItemSendSource = "measured" | "entered" | "verified_count";
export type ItemSendCountProof = { quantity: number; unit: string; pages: readonly number[]; marksRevision: number };
export type CorrectedCountProof = { part_id: string; sent_revision: number; current_revision: number };
export type ItemSendCountTotal = ItemSendCountProof & { correctedProof?: CorrectedCountProof; jobId: string; answerId: string | null; readingRevision: number | null };
export type ItemSendHeldQuantity = Omit<ItemSendCountTotal, "marksRevision"> & { source: "measured" | "entered" };

/** The stored answer of one item on this plan, with its review decision and the entry of this plan's scope (lot 4 PR 4). */
export type ItemSendAnswer = {
  itemId: string;
  answerId: string;
  /** Compared as is: the writer refuses a plan whose answers moved. */
  revision: string;
  outcome: "measured" | "uncertain" | "not_found";
  observations: readonly ItemSendObservation[];
  /** Taken on this very revision of the answer; the reader gives none taken on an earlier one. */
  decision: { kind: "accepted" | "set_aside"; revision: number } | null;
  /** A quantity a member entered for this plan; an hypothesis counts only once included by its own decision. */
  entry: { revision: number; quantity: number; unit: string; category: string; included: boolean } | null;
  /**
   * The pages its reading searched (B1): what a confirmation covers on its plan, with the held pages it decides. Absent:
   * every page of the plan's unit.
   */
  searchedPages?: readonly number[];
  quantitySource?: "verified_count";
  verifiedCount?: ItemSendCountProof | null;
  readingRevision?: number;
  /** False when a later reading of the same plan replaced this answer: nothing of it is sent (B2's current answer). */
  current?: boolean;
};

export type ItemSendLocationField = { value: string | null; state: "proposed" | "confirmed" | "corrected" | "unknown" | "multiple" };
/** The plan revision's location (lot 3): only a value an operator confirmed or set places a part. */
export type ItemSendPlanLocation = { building: ItemSendLocationField; level: ItemSendLocationField; generation: number | null };

export type ItemSendDraftSection = { id: string; parentId: string | null; position: number | null; title: string | null };

export type ItemSendDraftLine = {
  id: string;
  parentId: string | null;
  title: string | null;
  unitCode: string | null;
  pricingStatus: string | null;
  quantity: number;
  updatedAt: string;
  /**
   * A DPGF line: the import and raw row its provenance proves (null when nothing proves them: no automatic target), its
   * DPGF quantity as imported, and what it holds of earlier takeoffs.
   */
  dpgf: {
    importId: string | null;
    /** The import the line's provenance names (source_metadata.import_id): the line is of that import. Absent: importId. */
    metadataImportId?: string | null;
    mappedRowId: string | null;
    rawRowId: string | null;
    reference: number | null;
    composition: StoredDpgfComposition;
  } | null;
};

export type ItemSendDestinationState =
  | { kind: "first_draft"; engine: EstimateEngineVersion | null; maxSectionDepth: number }
  | { kind: "existing_draft"; versionId: string; engine: EstimateEngineVersion | null; maxSectionDepth: number;
    sections: readonly ItemSendDraftSection[]; lines: readonly ItemSendDraftLine[] }
  | { kind: "unresolved"; reason: "choose_destination" | "issued_only" };
