import { z } from "zod";

export const AFFAIRE_INTAKE_BUCKET = "affaire-intake";
export const AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL = "50 Mo";

export const AFFAIRE_INTAKE_ALLOWED_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "txt",
  "csv",
  "eml",
  "xls",
  "xlsx",
  "doc",
  "docx",
] as const;

export const AFFAIRE_INTAKE_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "message/rfc822",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const affaireIntakeDocumentKindSchema = z.enum([
  "dpgf",
  "plans",
  "cctp",
  "bpu_dqe",
  "annexes",
  "emails",
  "a_classer",
]);

export const affaireIntakeUploadStatusSchema = z.enum([
  "queued",
  "processing",
  "ready",
  "partial_failure",
  "failed",
]);

export const affaireIntakeDocumentUploadStatusSchema = z.enum([
  "pending",
  "uploaded",
  "rejected",
]);

export const affaireIntakeClassificationStatusSchema = z.enum([
  "queued",
  "processing",
  "classified",
  "ambiguous",
  "failed",
]);

export const affaireIntakeClassificationSourceSchema = z.enum([
  "ai",
  "heuristic",
  "manual",
]);
export const affaireIntakeDocumentPrioritySchema = z.enum([
  "primary",
  "secondary",
]);
export const affaireIntakeBriefStatusSchema = z.enum([
  "a_confirmer",
  "confirme",
]);
export const affaireIntakeBriefBlockKeySchema = z.enum([
  "summary",
  "project_object",
  "scope",
  "lots",
  "received_pieces",
  "assumptions",
  "vigilance_points",
  "missing_elements",
]);

export const affaireIntakeExtractedMetadataSchema = z
  .object({
    projectName: z.string().trim().max(255).nullable(),
    clientName: z.string().trim().max(255).nullable(),
    deadlineAt: z.string().datetime({ offset: true }).nullable(),
    detectedLots: z.array(z.string().trim().min(1).max(160)).max(20),
    detectedVariants: z.array(z.string().trim().min(1).max(160)).max(20),
  })
  .strict();

export const affaireIntakeClassificationResultSchema = z
  .object({
    documentKind: affaireIntakeDocumentKindSchema,
    confidence: z.number().min(0).max(1),
    issues: z.array(z.string().trim().min(1).max(240)).max(10).default([]),
    extractedMetadata: affaireIntakeExtractedMetadataSchema.default({
      projectName: null,
      clientName: null,
      deadlineAt: null,
      detectedLots: [],
      detectedVariants: [],
    }),
  })
  .strict();

export type AffaireIntakeDocumentKind = z.infer<
  typeof affaireIntakeDocumentKindSchema
>;
export type AffaireIntakeUploadStatus = z.infer<
  typeof affaireIntakeUploadStatusSchema
>;
export type AffaireIntakeDocumentUploadStatus = z.infer<
  typeof affaireIntakeDocumentUploadStatusSchema
>;
export type AffaireIntakeClassificationStatus = z.infer<
  typeof affaireIntakeClassificationStatusSchema
>;
export type AffaireIntakeClassificationSource = z.infer<
  typeof affaireIntakeClassificationSourceSchema
>;
export type AffaireIntakeDocumentPriority = z.infer<
  typeof affaireIntakeDocumentPrioritySchema
>;
export type AffaireIntakeBriefStatus = z.infer<
  typeof affaireIntakeBriefStatusSchema
>;
export type AffaireIntakeBriefBlockKey = z.infer<
  typeof affaireIntakeBriefBlockKeySchema
>;
export type AffaireIntakeExtractedMetadata = z.infer<
  typeof affaireIntakeExtractedMetadataSchema
>;
export type AffaireIntakeClassificationResult = z.infer<
  typeof affaireIntakeClassificationResultSchema
>;

export type AffaireIntakeWorkspaceMissingPiece = {
  code: string;
  label: string;
  severity: "info" | "warning" | "critical";
};

export type AffaireIntakeReadinessImpact = "none" | "warning" | "critical";
export type AffaireIntakeDominantAction = "none" | "review" | "missing";

export type AffaireIntakeReadinessSnapshot = {
  reviewDocumentsCount: number;
  missingPiecesCount: number;
  criticalMissingPiecesCount: number;
  provisionalMissingPiecesCount: number;
  provisionalCriticalMissingPiecesCount: number;
  confirmedMissingPiecesCount: number;
  confirmedCriticalMissingPiecesCount: number;
  reviewCouldLiftCriticalMissing: boolean;
  reviewBeforeMissing: boolean;
  dominantAction: AffaireIntakeDominantAction;
  hubReadinessImpact: AffaireIntakeReadinessImpact;
};

export type AffaireIntakeWorkspaceDocumentSummary = {
  uploadStatus: AffaireIntakeDocumentUploadStatus;
  classificationStatus: AffaireIntakeClassificationStatus;
  documentKind: AffaireIntakeDocumentKind;
  documentPriority?: AffaireIntakeDocumentPriority | null;
};

export type AffaireIntakeReviewableDocument = {
  fileName?: string | null;
  uploadStatus?: AffaireIntakeDocumentUploadStatus | null;
  classificationStatus?: AffaireIntakeClassificationStatus | null;
  detectedCategory?: AffaireIntakeDocumentKind | null;
  documentKind?: AffaireIntakeDocumentKind | null;
  confidence?: number | null;
  issues?: string[] | null;
};

const AFFAIRE_INTAKE_MISSING_PIECE_KIND_BY_CODE: Record<
  string,
  Exclude<AffaireIntakeDocumentKind, "annexes" | "emails" | "a_classer">
> = {
  missing_dpgf: "dpgf",
  missing_plans: "plans",
  missing_cctp: "cctp",
  missing_bpu_dqe: "bpu_dqe",
};

export const AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS: Record<
  AffaireIntakeDocumentKind,
  string
> = {
  dpgf: "DPGF",
  plans: "Plans",
  cctp: "CCTP",
  bpu_dqe: "BPU / DQE",
  annexes: "Annexes",
  emails: "Emails / courriers",
  a_classer: "A classer",
};

export const AFFAIRE_INTAKE_DOCUMENT_PRIORITY_LABELS: Record<
  AffaireIntakeDocumentPriority,
  string
> = {
  primary: "Principal",
  secondary: "Complementaire",
};

export const AFFAIRE_INTAKE_BRIEF_BLOCK_LABELS: Record<
  AffaireIntakeBriefBlockKey,
  string
> = {
  summary: "Synthese",
  project_object: "Objet du projet",
  scope: "Perimetre detecte",
  lots: "Lots concernes",
  received_pieces: "Pieces recues",
  assumptions: "Hypotheses initiales",
  vigilance_points: "Points de vigilance",
  missing_elements: "Elements manquants",
};

export const affaireIntakeBriefSourceSchema = z
  .object({
    blockKey: affaireIntakeBriefBlockKeySchema,
    entryIndex: z.number().int().min(0),
    sourceDocumentId: z.string().uuid(),
    sourceFileName: z.string().trim().min(1).max(255),
    rationale: z.string().trim().max(240).nullable(),
  })
  .strict();

export const affaireIntakeBriefDraftSchema = z
  .object({
    status: affaireIntakeBriefStatusSchema,
    summary: z.string().trim().min(1).max(900),
    projectObject: z.string().trim().min(1).max(400),
    scope: z.array(z.string().trim().min(1).max(280)).max(12),
    lots: z.array(z.string().trim().min(1).max(160)).max(20),
    receivedPieces: z.array(z.string().trim().min(1).max(255)).max(20),
    assumptions: z.array(z.string().trim().min(1).max(280)).max(12),
    vigilancePoints: z.array(z.string().trim().min(1).max(280)).max(12),
    missingElements: z.array(z.string().trim().min(1).max(280)).max(12),
    sources: z.array(affaireIntakeBriefSourceSchema).max(120),
    uploadId: z.string().uuid().nullable(),
    lastGeneratedAt: z.string().datetime({ offset: true }).nullable(),
    confirmedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type AffaireIntakeBriefSource = z.infer<
  typeof affaireIntakeBriefSourceSchema
>;
export type AffaireIntakeBriefDraft = z.infer<
  typeof affaireIntakeBriefDraftSchema
>;

export type AffairePreliminaryStructureSourceKind =
  | "confirmed_brief"
  | "primary_cctp";

export type AffairePreliminaryStructureSource = {
  kind: AffairePreliminaryStructureSourceKind;
  availability: "ready" | "limited";
  label: string;
  detail: string;
  availableLots: string[];
  documentId: string | null;
  fileName: string | null;
};

export type AffairePreliminaryStructureCapability = {
  canOpen: boolean;
  primarySourceKind: AffairePreliminaryStructureSourceKind | null;
  availableLots: string[];
  sources: AffairePreliminaryStructureSource[];
};

type AffairePreliminaryStructureWorkspaceDocument = {
  documentId?: string | null;
  fileName?: string | null;
  detectedCategory?: AffaireIntakeDocumentKind | null;
  documentPriority?: AffaireIntakeDocumentPriority | null;
  extractedMetadata?: AffaireIntakeExtractedMetadata | null;
};

type AffairePreliminaryStructureBrief = Pick<
  AffaireIntakeBriefDraft,
  "status" | "lots"
>;

const DEFAULT_EXTRACTED_METADATA: AffaireIntakeExtractedMetadata = {
  projectName: null,
  clientName: null,
  deadlineAt: null,
  detectedLots: [],
  detectedVariants: [],
};

const DIRECT_EXTENSION_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  eml: "message/rfc822",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function isAffaireIntakePrimaryEligibleKind(
  kind: AffaireIntakeDocumentKind,
) {
  return kind === "dpgf" || kind === "cctp";
}

export function getDefaultAffaireIntakeDocumentPriority(input: {
  documentKind: AffaireIntakeDocumentKind;
  hasExistingPrimary: boolean;
}): AffaireIntakeDocumentPriority {
  if (!isAffaireIntakePrimaryEligibleKind(input.documentKind)) {
    return "secondary";
  }

  return input.hasExistingPrimary ? "secondary" : "primary";
}

const DOCUMENT_KIND_HINTS: Array<{
  kind: Exclude<AffaireIntakeDocumentKind, "annexes" | "a_classer">;
  patterns: RegExp[];
  defaultConfidence: number;
}> = [
  {
    kind: "emails",
    patterns: [/\bmail\b/i, /\bemail\b/i, /\bcourrier\b/i, /\.eml$/i],
    defaultConfidence: 0.96,
  },
  {
    kind: "dpgf",
    patterns: [
      /\bdpgf\b/i,
      /\bdecomposition\b/i,
      /\bdecompte\b/i,
      /\bquantitatif\b/i,
      /\bestimatif\b/i,
    ],
    defaultConfidence: 0.92,
  },
  {
    kind: "bpu_dqe",
    patterns: [
      /\bbpu\b/i,
      /\bdqe\b/i,
      /\bbordereau\b/i,
      /\bdevis quantitatif\b/i,
    ],
    defaultConfidence: 0.91,
  },
  {
    kind: "cctp",
    patterns: [
      /\bcctp\b/i,
      /\bcahier\b/i,
      /\bclauses techniques\b/i,
      /\bdescriptif\b/i,
    ],
    defaultConfidence: 0.89,
  },
  {
    kind: "plans",
    patterns: [
      /\bplan\b/i,
      /\bcoupe\b/i,
      /\bfaçade\b/i,
      /\bfacade\b/i,
      /\belevation\b/i,
      /\brdc\b/i,
    ],
    defaultConfidence: 0.84,
  },
];

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function createEmptyAffaireIntakeExtractedMetadata(): AffaireIntakeExtractedMetadata {
  return {
    projectName: DEFAULT_EXTRACTED_METADATA.projectName,
    clientName: DEFAULT_EXTRACTED_METADATA.clientName,
    deadlineAt: DEFAULT_EXTRACTED_METADATA.deadlineAt,
    detectedLots: [],
    detectedVariants: [],
  };
}

export function normalizeAffaireIntakeExtractedMetadata(
  value: unknown
): AffaireIntakeExtractedMetadata {
  const parsed = affaireIntakeExtractedMetadataSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  return createEmptyAffaireIntakeExtractedMetadata();
}

export function getAffaireIntakeFileExtension(fileName: string): string {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return "";
  }

  return trimmed.slice(lastDot + 1).trim().toLowerCase();
}

export function inferAffaireIntakeMimeType(fileName: string): string | null {
  const extension = getAffaireIntakeFileExtension(fileName);
  return DIRECT_EXTENSION_MIME_TYPES[extension] ?? null;
}

export function isMimeTypeSupportedForAiClassification(mimeType: string | null | undefined) {
  const normalized = mimeType?.trim().toLowerCase() ?? "";
  return (
    normalized === "application/pdf" ||
    normalized === "image/png" ||
    normalized === "image/jpeg" ||
    normalized === "image/webp" ||
    normalized === "text/plain" ||
    normalized === "text/csv"
  );
}

export function sanitizeAffaireIntakeFilename(fileName: string) {
  const normalized = fileName
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized.length > 0 ? normalized : "document";
}

export function buildAffaireIntakeStoragePath(input: {
  tenantId: string;
  projectId: string;
  uploadId: string;
  documentId: string;
  fileName: string;
}) {
  return [
    input.tenantId,
    input.projectId,
    input.uploadId,
    input.documentId,
    sanitizeAffaireIntakeFilename(input.fileName),
  ].join("/");
}

export function getHeuristicAffaireDocumentClassification(input: {
  fileName: string;
  mimeType?: string | null;
}): AffaireIntakeClassificationResult {
  const normalizedName = input.fileName.trim().toLowerCase();
  const extension = getAffaireIntakeFileExtension(normalizedName);

  if (
    (input.mimeType?.trim().toLowerCase() ?? "") === "message/rfc822" ||
    extension === "eml"
  ) {
    return {
      documentKind: "emails",
      confidence: 0.99,
      issues: [],
      extractedMetadata: createEmptyAffaireIntakeExtractedMetadata(),
    };
  }

  for (const hint of DOCUMENT_KIND_HINTS) {
    if (hint.patterns.some((pattern) => pattern.test(normalizedName))) {
      return {
        documentKind: hint.kind,
        confidence: hint.defaultConfidence,
        issues: [],
        extractedMetadata: createEmptyAffaireIntakeExtractedMetadata(),
      };
    }
  }

  if (extension === "pdf") {
    return {
      documentKind: "annexes",
      confidence: 0.42,
      issues: ["Classification heuristique faible: piece PDF non identifiee clairement."],
      extractedMetadata: createEmptyAffaireIntakeExtractedMetadata(),
    };
  }

  return {
    documentKind: "a_classer",
    confidence: 0.35,
    issues: ["Aucun signal fort detecte dans le nom du fichier."],
    extractedMetadata: createEmptyAffaireIntakeExtractedMetadata(),
  };
}

export function mergeAffaireDocumentClassificationWithHeuristic(input: {
  aiResult: AffaireIntakeClassificationResult;
  heuristicResult: AffaireIntakeClassificationResult;
}) {
  if (
    input.aiResult.documentKind === "a_classer" &&
    input.heuristicResult.documentKind !== "a_classer" &&
    input.heuristicResult.confidence >= 0.8
  ) {
    return {
      documentKind: input.heuristicResult.documentKind,
      confidence: clampConfidence(
        Math.max(input.aiResult.confidence, input.heuristicResult.confidence)
      ),
      issues: [
        ...input.aiResult.issues,
        "Le nom du fichier a ete retenu comme signal principal pour la categorie.",
      ],
      extractedMetadata: input.aiResult.extractedMetadata,
    } satisfies AffaireIntakeClassificationResult;
  }

  return {
    ...input.aiResult,
    confidence: clampConfidence(input.aiResult.confidence),
  } satisfies AffaireIntakeClassificationResult;
}

export function deriveAffaireIntakeClassificationStatus(input: {
  documentKind: AffaireIntakeDocumentKind;
  confidence: number | null | undefined;
  hasHardFailure?: boolean;
}) {
  if (input.hasHardFailure) {
    return "failed" satisfies AffaireIntakeClassificationStatus;
  }

  const confidence = clampConfidence(input.confidence ?? 0);
  if (input.documentKind === "a_classer") {
    return "ambiguous" satisfies AffaireIntakeClassificationStatus;
  }

  if (confidence < 0.65) {
    return "ambiguous" satisfies AffaireIntakeClassificationStatus;
  }

  return "classified" satisfies AffaireIntakeClassificationStatus;
}

export function isAffaireIntakeDocumentProcessing(
  document: AffaireIntakeReviewableDocument
) {
  if (
    document.classificationStatus === "queued" ||
    document.classificationStatus === "processing"
  ) {
    return true;
  }

  const category = document.detectedCategory ?? document.documentKind ?? "a_classer";
  const issuesCount = document.issues?.length ?? 0;

  return (
    (document.confidence ?? 0) === 0 &&
    category === "a_classer" &&
    issuesCount === 0
  );
}

export function isAffaireIntakeDocumentNeedingReview(
  document: AffaireIntakeReviewableDocument
) {
  if (document.classificationStatus) {
    return (
      !isAffaireIntakeDocumentProcessing(document) &&
      (document.classificationStatus === "ambiguous" ||
        document.classificationStatus === "failed")
    );
  }

  const category = document.detectedCategory ?? document.documentKind ?? "a_classer";
  return (
    !isAffaireIntakeDocumentProcessing(document) &&
    (category === "a_classer" || clampConfidence(document.confidence ?? 0) < 0.65)
  );
}

export function deriveAffaireIntakeUploadStatusFromDocuments(
  documents: AffaireIntakeWorkspaceDocumentSummary[]
) {
  const uploadedDocuments = documents.filter(
    (document) => document.uploadStatus === "uploaded"
  );

  if (uploadedDocuments.length === 0) {
    return "failed" satisfies AffaireIntakeUploadStatus;
  }

  if (
    uploadedDocuments.some(
      (document) =>
        document.classificationStatus === "queued" ||
        document.classificationStatus === "processing"
    )
  ) {
    return "processing" satisfies AffaireIntakeUploadStatus;
  }

  if (
    uploadedDocuments.every(
      (document) => document.classificationStatus === "classified"
    )
  ) {
    return "ready" satisfies AffaireIntakeUploadStatus;
  }

  if (
    uploadedDocuments.every((document) => document.classificationStatus === "failed")
  ) {
    return "failed" satisfies AffaireIntakeUploadStatus;
  }

  return "partial_failure" satisfies AffaireIntakeUploadStatus;
}

export function buildAffaireIntakeMissingPieces(
  documents: AffaireIntakeWorkspaceDocumentSummary[]
): AffaireIntakeWorkspaceMissingPiece[] {
  const presentKinds = new Set(
    documents
      .filter((document) => document.uploadStatus === "uploaded")
      .filter((document) => document.classificationStatus === "classified")
      .map((document) => document.documentKind)
      .filter((kind) => kind !== "a_classer")
  );

  const missingPieces: AffaireIntakeWorkspaceMissingPiece[] = [];

  if (!presentKinds.has("dpgf")) {
    missingPieces.push({
      code: "missing_dpgf",
      label: "DPGF manquant",
      severity: "critical",
    });
  }

  if (!presentKinds.has("plans")) {
    missingPieces.push({
      code: "missing_plans",
      label: "Plans manquants",
      severity: "critical",
    });
  }

  if (!presentKinds.has("cctp")) {
    missingPieces.push({
      code: "missing_cctp",
      label: "CCTP non detecte",
      severity: "warning",
    });
  }

  if (!presentKinds.has("bpu_dqe")) {
    missingPieces.push({
      code: "missing_bpu_dqe",
      label: "BPU / DQE non detecte",
      severity: "warning",
    });
  }

  return missingPieces;
}

function getAffaireIntakeMissingPieceKind(
  piece: Pick<AffaireIntakeWorkspaceMissingPiece, "code">
) {
  return AFFAIRE_INTAKE_MISSING_PIECE_KIND_BY_CODE[piece.code] ?? null;
}

function getAffaireIntakeReviewProbableKinds(
  document: Pick<AffaireIntakeReviewableDocument, "fileName" | "detectedCategory" | "documentKind">
) {
  const kinds = new Set<AffaireIntakeDocumentKind>();
  const persistedKind = document.detectedCategory ?? document.documentKind ?? null;

  if (persistedKind && persistedKind !== "a_classer") {
    kinds.add(persistedKind);
  }

  const extension = document.fileName?.split(".").pop()?.trim().toLowerCase() ?? "";
  if (["xlsx", "xls", "csv"].includes(extension)) {
    kinds.add("dpgf");
    kinds.add("bpu_dqe");
  } else if (extension === "pdf") {
    kinds.add("plans");
    kinds.add("cctp");
  } else if (["doc", "docx"].includes(extension)) {
    kinds.add("cctp");
  } else if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(extension)) {
    kinds.add("plans");
  }

  return [...kinds];
}

function getAffaireIntakeProvisionalMissingPieceIndexes(input: {
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
  reviewDocuments: Pick<
    AffaireIntakeReviewableDocument,
    "fileName" | "detectedCategory" | "documentKind"
  >[];
}) {
  const matchableMissingPieces = input.missingPieces
    .map((piece, index) => {
      const kind = getAffaireIntakeMissingPieceKind(piece);
      return kind
        ? {
            index,
            kind,
            severity: piece.severity,
          }
        : null;
    })
    .filter((piece): piece is NonNullable<typeof piece> => piece !== null);

  if (matchableMissingPieces.length === 0 || input.reviewDocuments.length === 0) {
    return new Set<number>();
  }

  const reviewCandidates = input.reviewDocuments.map((document) => {
    const probableKinds = getAffaireIntakeReviewProbableKinds(document);

    return matchableMissingPieces
      .filter((piece) => probableKinds.includes(piece.kind))
      .sort((left, right) => {
        if (left.severity !== right.severity) {
          return left.severity === "critical" ? -1 : 1;
        }

        const leftRank = probableKinds.indexOf(left.kind);
        const rightRank = probableKinds.indexOf(right.kind);
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return left.index - right.index;
      });
  });

  type MatchScore = {
    matchedCount: number;
    criticalMatchedCount: number;
    matchedIndexes: number[];
  };

  const cache = new Map<string, MatchScore>();

  const compareScores = (left: MatchScore, right: MatchScore) => {
    if (left.matchedCount !== right.matchedCount) {
      return left.matchedCount - right.matchedCount;
    }

    if (left.criticalMatchedCount !== right.criticalMatchedCount) {
      return left.criticalMatchedCount - right.criticalMatchedCount;
    }

    return 0;
  };

  const solve = (reviewIndex: number, usedMask: number): MatchScore => {
    if (reviewIndex >= reviewCandidates.length) {
      return {
        matchedCount: 0,
        criticalMatchedCount: 0,
        matchedIndexes: [],
      };
    }

    const cacheKey = `${reviewIndex}:${usedMask}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let bestScore = solve(reviewIndex + 1, usedMask);

    for (const candidate of reviewCandidates[reviewIndex]) {
      const bit = 1 << candidate.index;
      if ((usedMask & bit) !== 0) {
        continue;
      }

      const nextScore = solve(reviewIndex + 1, usedMask | bit);
      const candidateScore: MatchScore = {
        matchedCount: nextScore.matchedCount + 1,
        criticalMatchedCount:
          nextScore.criticalMatchedCount +
          (candidate.severity === "critical" ? 1 : 0),
        matchedIndexes: [candidate.index, ...nextScore.matchedIndexes],
      };

      if (compareScores(candidateScore, bestScore) > 0) {
        bestScore = candidateScore;
      }
    }

    cache.set(cacheKey, bestScore);
    return bestScore;
  };

  return new Set(solve(0, 0).matchedIndexes);
}

export function buildAffaireIntakeReadinessSnapshot(input: {
  documents: AffaireIntakeReviewableDocument[];
  missingPieces?: AffaireIntakeWorkspaceMissingPiece[];
}): AffaireIntakeReadinessSnapshot {
  const uploadedDocuments = input.documents.filter(
    (document) => (document.uploadStatus ?? "uploaded") === "uploaded"
  );
  const missingPieces =
    input.missingPieces ??
    buildAffaireIntakeMissingPieces(
      uploadedDocuments.map((document) => ({
        uploadStatus: document.uploadStatus ?? "uploaded",
        classificationStatus: document.classificationStatus ?? "ambiguous",
        documentKind:
          document.detectedCategory ?? document.documentKind ?? "a_classer",
      }))
    );
  const reviewDocuments = uploadedDocuments.filter((document) =>
    isAffaireIntakeDocumentNeedingReview(document)
  );
  const provisionalMissingPieceIndexes = getAffaireIntakeProvisionalMissingPieceIndexes({
    missingPieces,
    reviewDocuments,
  });
  const provisionalMissingPieces = missingPieces.filter((_, index) =>
    provisionalMissingPieceIndexes.has(index)
  );
  const criticalMissingPiecesCount = missingPieces.filter(
    (piece) => piece.severity === "critical"
  ).length;
  const provisionalCriticalMissingPiecesCount = provisionalMissingPieces.filter(
    (piece) => piece.severity === "critical"
  ).length;
  const reviewDocumentsCount = reviewDocuments.length;
  const missingPiecesCount = missingPieces.length;
  const provisionalMissingPiecesCount = provisionalMissingPieces.length;
  const confirmedMissingPiecesCount =
    missingPiecesCount - provisionalMissingPiecesCount;
  const confirmedCriticalMissingPiecesCount =
    criticalMissingPiecesCount - provisionalCriticalMissingPiecesCount;
  const reviewCouldLiftCriticalMissing =
    provisionalCriticalMissingPiecesCount > 0;

  return {
    reviewDocumentsCount,
    missingPiecesCount,
    criticalMissingPiecesCount,
    provisionalMissingPiecesCount,
    provisionalCriticalMissingPiecesCount,
    confirmedMissingPiecesCount,
    confirmedCriticalMissingPiecesCount,
    reviewCouldLiftCriticalMissing,
    reviewBeforeMissing: reviewDocumentsCount > 0 && reviewCouldLiftCriticalMissing,
    dominantAction:
      reviewDocumentsCount > 0
        ? "review"
        : missingPiecesCount > 0
          ? "missing"
          : "none",
    hubReadinessImpact:
      criticalMissingPiecesCount > 0
        ? "critical"
        : missingPiecesCount > 0
          ? "warning"
          : "none",
  };
}

export function normalizeAffaireIntakeTextList(
  values: ReadonlyArray<string | null | undefined>,
  options: {
    maxItems: number;
    maxLength: number;
  }
) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawValue of values) {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value) {
      continue;
    }

    const nextValue = value.slice(0, options.maxLength).trim();
    const dedupeKey = nextValue.toLowerCase();
    if (!nextValue || seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push(nextValue);

    if (normalized.length >= options.maxItems) {
      break;
    }
  }

  return normalized;
}

export function resolveAffairePreliminaryStructureCapability(input: {
  briefDraft?: AffairePreliminaryStructureBrief | null;
  documents?: ReadonlyArray<AffairePreliminaryStructureWorkspaceDocument> | null;
}): AffairePreliminaryStructureCapability {
  const briefDraft = input.briefDraft ?? null;
  const documents = [...(input.documents ?? [])];
  const sources: AffairePreliminaryStructureSource[] = [];
  const briefLots =
    briefDraft?.status === "confirme"
      ? normalizeAffaireIntakeTextList(briefDraft.lots, {
          maxItems: 20,
          maxLength: 160,
        })
      : [];

  if (briefDraft?.status === "confirme") {
    sources.push({
      kind: "confirmed_brief",
      availability: "ready",
      label: "Brief confirme",
      detail:
        briefLots.length > 0
          ? `${briefLots.length} lot(s) du brief restent reutilisables pour ouvrir une structure preliminaire.`
          : "Le brief confirme reste la reference de travail, meme sans lot explicite.",
      availableLots: briefLots,
      documentId: null,
      fileName: null,
    });
  }

  const primaryCctp =
    documents.find(
      (document) =>
        document.detectedCategory === "cctp" &&
        document.documentPriority === "primary"
    ) ??
    documents.find((document) => document.detectedCategory === "cctp") ??
    null;

  if (primaryCctp) {
    const cctpLots = normalizeAffaireIntakeTextList(
      primaryCctp.extractedMetadata?.detectedLots ?? [],
      {
        maxItems: 20,
        maxLength: 160,
      }
    );

    sources.push({
      kind: "primary_cctp",
      availability: cctpLots.length > 0 ? "ready" : "limited",
      label: "CCTP principal",
      detail:
        cctpLots.length > 0
          ? `${primaryCctp.fileName ?? "CCTP principal"} expose ${cctpLots.length} lot(s) detecte(s) reutilisables pour une structure preliminaire.`
          : `${primaryCctp.fileName ?? "CCTP principal"} est bien principal, mais ne remonte pas encore de lot defendable pour ouvrir la structure automatiquement.`,
      availableLots: cctpLots,
      documentId: primaryCctp.documentId ?? null,
      fileName: primaryCctp.fileName ?? null,
    });
  }

  const availableLots = normalizeAffaireIntakeTextList(
    sources.flatMap((source) => source.availableLots),
    {
      maxItems: 20,
      maxLength: 160,
    }
  );
  const readySources = sources.filter((source) => source.availability === "ready");

  return {
    canOpen: readySources.length > 0,
    primarySourceKind: readySources[0]?.kind ?? null,
    availableLots,
    sources,
  };
}
