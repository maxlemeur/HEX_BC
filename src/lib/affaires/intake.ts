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

export const affaireIntakeClassificationSourceSchema = z.enum(["ai", "manual"]);
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

export type AffaireIntakeWorkspaceDocumentSummary = {
  uploadStatus: AffaireIntakeDocumentUploadStatus;
  classificationStatus: AffaireIntakeClassificationStatus;
  documentKind: AffaireIntakeDocumentKind;
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
      .filter((document) => document.classificationStatus !== "failed")
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
