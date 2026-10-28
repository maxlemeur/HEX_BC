import { z } from "zod";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  validateFileForUpload,
} from "@/lib/file-validation";
import { resolveTakeoffPdfMimeType, validateTakeoffPdfUploadMetadata } from "@/lib/takeoff/pdf-validation";
import {
  TAKEOFF_LEVELS,
  type TakeoffJobResponse,
  type TakeoffLevel,
  type TakeoffProvider,
} from "@/lib/takeoff/types";
import { createHash } from "node:crypto";

const TAKEOFF_STRUCTURED_ALLOWED_EXTENSIONS = ["csv", "xlsx", "xls"];

const TAKEOFF_STRUCTURED_ALLOWED_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const TAKEOFF_PDF_ALLOWED_EXTENSIONS = ["pdf"];

const TAKEOFF_PDF_ALLOWED_MIME_TYPES = ["application/pdf"];

export const TAKEOFF_PLAN_SET_LEVEL: TakeoffLevel = "B";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const takeoffJobResponseSchema: z.ZodType<TakeoffJobResponse> = z.object({
  id: z.string().uuid(),
  status: z.string(),
  level: z.string(),
  source_file_name: z.string().nullable(),
  estimate_version_id: z.string().uuid(),
  created_at: z.string(),
});

export type TakeoffJobRow = TakeoffJobResponse & {
  source_file_path?: string | null;
};

export type TakeoffJobCreateResponse = TakeoffJobResponse;

function isUuid(value: string) {
  return UUID_REGEX.test(value);
}

function sanitizeFilename(filename: string) {
  const normalized = filename
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized.length > 0 ? normalized : "upload";
}

/** The exact source identity is shared by the initial attempt and every replay. */
export function prepareTakeoffUploadSource(input: {
  file: Pick<File, "name" | "type" | "size">;
  content: Buffer;
  estimateVersionId: string;
  level: TakeoffLevel;
  provider: TakeoffProvider;
}) {
  const sourceFileType = input.level === "A"
    ? input.file.type
    : resolveTakeoffPdfMimeType({
        fileName: input.file.name,
        mimeType: input.file.type,
      }) ?? input.file.type;

  const payloadFingerprint = toHexSha256(JSON.stringify({
    estimate_version_id: input.estimateVersionId,
    level: input.level,
    // Omitting the default retains receipts created before provider selection existed.
    ...(input.provider !== "auto" ? { provider: input.provider } : {}),
    file_name: input.file.name,
    file_type: sourceFileType,
    file_size_bytes: input.file.size,
    file_content_hash: toHexSha256(input.content),
  }));

  return { sourceFileType, payloadFingerprint };
}

export function buildTakeoffUploadPath(input: {
  tenantId: string;
  jobId: string;
  payloadFingerprint: string;
  attemptId: string;
  sourceFileName: string;
}) {
  return `${input.tenantId}/${input.jobId}/${input.payloadFingerprint}-${input.attemptId}-${sanitizeFilename(input.sourceFileName)}`;
}

export function normalizeIdempotencyKey(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new TakeoffError({
      status: 400,
      code: TakeoffErrorCode.IDEMPOTENCY_KEY_INVALID,
      message: "La valeur de l'en-tête Idempotency-Key est invalide.",
      retryable: false,
    });
  }

  if (trimmed.length > 255) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.IDEMPOTENCY_KEY_INVALID,
      message: "La valeur de l'en-tête Idempotency-Key est trop longue.",
      retryable: false,
    });
  }

  return trimmed;
}

export function deriveDeterministicJobId(tenantId: string, idempotencyKey: string) {
  const seed = toHexSha256(`${tenantId}:${idempotencyKey}`);
  const bytes = Buffer.from(seed.slice(0, 32), "hex");

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function extractPayloadFingerprint(path: string | null | undefined) {
  const normalizedPath = typeof path === "string" ? path.trim().replace(/\/+$/g, "") : "";
  if (!normalizedPath) return null;

  const patterns = [
    /(?:^|\/)([a-f0-9]{64})-[^/]+$/i,
    /(?:^|\/)([a-f0-9]{64})\/[^/]+$/i,
    /(?:^|\/)([a-f0-9]{64})$/i,
  ];

  for (const pattern of patterns) {
    const match = normalizedPath.match(pattern);
    const fingerprint = match?.[1];
    if (fingerprint) {
      return fingerprint.toLowerCase();
    }
  }

  return null;
}

export function normalizeTakeoffJobRow(row: TakeoffJobRow): TakeoffJobCreateResponse {
  return takeoffJobResponseSchema.parse({
    id: row.id,
    status: row.status,
    level: row.level,
    source_file_name: row.source_file_name,
    estimate_version_id: row.estimate_version_id,
    created_at: row.created_at,
  });
}

function resolveTakeoffUploadValidation(level: TakeoffLevel) {
  if (level === "A") {
    return {
      allowedExtensions: TAKEOFF_STRUCTURED_ALLOWED_EXTENSIONS,
      allowedMimeTypes: TAKEOFF_STRUCTURED_ALLOWED_MIME_TYPES,
    };
  }

  return {
    allowedExtensions: TAKEOFF_PDF_ALLOWED_EXTENSIONS,
    allowedMimeTypes: TAKEOFF_PDF_ALLOWED_MIME_TYPES,
  };
}

export function assertTakeoffFileIsValid(file: File, level: TakeoffLevel) {
  if (level !== "A") {
    const validation = validateTakeoffPdfUploadMetadata({
      fileName: file.name,
      mimeType: file.type,
      fileSizeBytes: file.size,
      maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
      maxFileSizeLabel: MAX_FILE_SIZE_LABEL,
    });

    if (validation.valid) {
      return;
    }

    if (validation.reason === "too_large") {
      throw new TakeoffError({
        status: 413,
        code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
        message: validation.message,
        retryable: false,
      });
    }

    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: validation.message,
      retryable: false,
    });
  }

  const validationConfig = resolveTakeoffUploadValidation(level);
  const validation = validateFileForUpload(file, {
    allowedExtensions: validationConfig.allowedExtensions,
    allowedMimeTypes: validationConfig.allowedMimeTypes,
    allowEmptyMimeType: true,
  });

  if (validation.valid) return;

  if (validation.error.includes("depasse")) {
    throw new TakeoffError({
      status: 413,
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      message: validation.error,
      retryable: false,
    });
  }

  if (
    validation.error.includes("Extension") ||
    validation.error.includes("MIME")
  ) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: validation.error,
      retryable: false,
    });
  }

  throw new TakeoffError({
    status: 400,
    code: TakeoffErrorCode.BAD_REQUEST,
    message: validation.error,
    retryable: false,
  });
}

export function parseEstimateVersionId(formData: FormData) {
  const value = formData.get("estimate_version_id");

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TakeoffError({
      status: 400,
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "Le champ estimate_version_id est requis.",
      retryable: false,
    });
  }

  const estimateVersionId = value.trim();

  if (!isUuid(estimateVersionId)) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_ESTIMATE_VERSION_ID_INVALID,
      message: "Le champ estimate_version_id doit être un UUID valide.",
      retryable: false,
    });
  }

  return estimateVersionId;
}

export function parseTakeoffLevel(formData: FormData) {
  const value = formData.get("level");

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TakeoffError({
      status: 400,
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "Le champ level est requis.",
      retryable: false,
    });
  }

  const normalized = value.trim().toUpperCase();

  if (!TAKEOFF_LEVELS.includes(normalized as TakeoffLevel)) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
      message: "Le niveau Takeoff doit être l'un des niveaux supportes: A, B ou C.",
      retryable: false,
    });
  }

  return normalized as TakeoffLevel;
}

function toHexSha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
