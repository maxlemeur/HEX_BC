/** Human-reviewed values retained verbatim for an idempotent application. */
export type GeneratedOuvrageAcceptedCandidate = {
  candidateId: string;
  designation: string;
  unit: string;
  quantity: number;
  lotId: string | null;
  reviewToken: string;
};

export type GeneratedOuvrageRequest = {
  versionId: string;
  draftId: string;
  operationKey: string;
  expectedUpdatedAt: string;
  acceptedCandidates: GeneratedOuvrageAcceptedCandidate[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export function canonicalGeneratedOuvrageCandidates(value: unknown): GeneratedOuvrageAcceptedCandidate[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new Error("Sélection d'ouvrages invalide.");
  const candidates = value.map((entry): GeneratedOuvrageAcceptedCandidate => {
    if (!record(entry) || !id(entry.candidateId) ||
      typeof entry.designation !== "string" || !entry.designation.trim() || entry.designation.trim().length > 500 ||
      typeof entry.unit !== "string" || !entry.unit.trim() || entry.unit.trim().length > 64 ||
      typeof entry.quantity !== "number" || !Number.isFinite(entry.quantity) || entry.quantity < 0 ||
      !(entry.lotId == null || id(entry.lotId)) ||
      typeof entry.reviewToken !== "string" || !/^[a-f0-9]{64}$/i.test(entry.reviewToken)) {
      throw new Error("Relisez et validez le sous-détail de chaque ouvrage avant l'application.");
    }
    return { candidateId: entry.candidateId.toLowerCase(), designation: entry.designation.trim().replace(/\s+/g, " "),
      unit: entry.unit.trim(), quantity: entry.quantity, lotId: entry.lotId?.toLowerCase() ?? null,
      reviewToken: entry.reviewToken.toLowerCase() };
  });
  if (new Set(candidates.map((entry) => entry.candidateId)).size !== candidates.length) {
    throw new Error("Un ouvrage ne peut apparaître qu'une fois dans la sélection.");
  }
  return candidates;
}

export function readGeneratedOuvrageRequest(value: unknown): GeneratedOuvrageRequest {
  if (!record(value) || !id(value.versionId) || !id(value.draftId) || !id(value.operationKey) ||
    typeof value.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(value.expectedUpdatedAt)) ||
    Object.keys(value).some((key) => !["versionId", "draftId", "operationKey", "expectedUpdatedAt", "acceptedCandidates"].includes(key))) {
    throw new Error("Demande d'application d'ouvrages invalide.");
  }
  return { versionId: value.versionId.toLowerCase(), draftId: value.draftId.toLowerCase(),
    operationKey: value.operationKey.toLowerCase(), expectedUpdatedAt: value.expectedUpdatedAt,
    acceptedCandidates: canonicalGeneratedOuvrageCandidates(value.acceptedCandidates) };
}
