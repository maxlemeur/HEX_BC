import { randomUUID } from "crypto";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import {
  detectImportSourceFormat,
  normalizeRowsFromJson,
  parseImportFile,
  type ImportSourceFormat,
  type NormalizedImportRow,
} from "./parser";

const DPGF_IMPORTS_BUCKET = "dpgf-imports";
const MAX_IMPORT_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const IMPORT_ROWS_BATCH_SIZE = 500;

type Supabase = SupabaseClient<Database>;
type ImportRow = Database["public"]["Tables"]["dpgf_imports"]["Row"];
type ImportInsert = Database["public"]["Tables"]["dpgf_imports"]["Insert"];
type ImportUpdate = Database["public"]["Tables"]["dpgf_imports"]["Update"];
type RawRowInsert = Database["public"]["Tables"]["dpgf_rows_raw"]["Insert"];
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role"
>;
type JsonRecord = Record<string, unknown>;
type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  isTenantAdmin: boolean;
};

type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INTERNAL_ERROR";

type ApiErrorBody = {
  code: ApiErrorCode | string;
  message: string;
  details?: unknown;
};

export type ApiSuccessResponse<T> = {
  ok: true;
  data: T;
};

export type ApiFailureResponse = {
  ok: false;
  error: ApiErrorBody;
};

const IMPORT_SELECT_COLUMNS = [
  "id",
  "created_at",
  "updated_at",
  "user_id",
  "filename",
  "source_format",
  "status",
  "row_count",
  "error_message",
  "parse_mode",
  "storage_path",
  "file_size_bytes",
].join(", ");

export class ImportsApiError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 415 | 500;
  readonly code: ApiErrorCode | string;
  readonly details?: unknown;

  constructor({
    status,
    code,
    message,
    details,
  }: {
    status: 400 | 401 | 403 | 404 | 409 | 415 | 500;
    code: ApiErrorCode | string;
    message: string;
    details?: unknown;
  }) {
    super(message);
    this.name = "ImportsApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok<T>(data: T, status: 200 | 201 = 200) {
  return NextResponse.json<ApiSuccessResponse<T>>(
    {
      ok: true,
      data,
    },
    { status }
  );
}

export function badRequest(message: string, details?: unknown, code = "BAD_REQUEST") {
  return new ImportsApiError({
    status: 400,
    code,
    message,
    details,
  });
}

function unauthorized(message = "Unauthorized") {
  return new ImportsApiError({
    status: 401,
    code: "UNAUTHORIZED",
    message,
  });
}

function forbidden(message = "Acces refuse.", details?: unknown, code = "FORBIDDEN") {
  return new ImportsApiError({
    status: 403,
    code,
    message,
    details,
  });
}

function notFound(message: string, details?: unknown, code = "NOT_FOUND") {
  return new ImportsApiError({
    status: 404,
    code,
    message,
    details,
  });
}

function conflict(message: string, details?: unknown, code = "CONFLICT") {
  return new ImportsApiError({
    status: 409,
    code,
    message,
    details,
  });
}

export function unsupportedMediaType(message: string, details?: unknown) {
  return new ImportsApiError({
    status: 415,
    code: "UNSUPPORTED_MEDIA_TYPE",
    message,
    details,
  });
}

function internalError(
  message = "Une erreur interne est survenue.",
  details?: unknown,
  code: ApiErrorCode | string = "INTERNAL_ERROR"
) {
  return new ImportsApiError({
    status: 500,
    code,
    message,
    details,
  });
}

function mapSupabaseError(error: PostgrestError, fallbackMessage: string): ImportsApiError {
  const normalizedMessage = (error.message ?? "").toLowerCase();

  if (error.code === "42501" || normalizedMessage.includes("row-level security")) {
    return forbidden("Acces refuse.", error, "FORBIDDEN");
  }

  if (error.code === "PGRST116") {
    return notFound("Ressource introuvable.", error, "NOT_FOUND");
  }

  if (error.code === "23505") {
    return conflict("Conflit de donnees.", error, "CONFLICT");
  }

  if (error.code === "23503" || error.code === "23514" || error.code === "22P02") {
    return badRequest(fallbackMessage, error, "BAD_REQUEST");
  }

  return badRequest(fallbackMessage, error, "BAD_REQUEST");
}

export function toErrorResponse(error: unknown) {
  let apiError: ImportsApiError;

  if (error instanceof ImportsApiError) {
    apiError = error;
  } else {
    console.error("Unexpected imports API error", error);
    apiError = internalError();
  }

  const body: ApiFailureResponse = {
    ok: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      details: apiError.details,
    },
  };

  return NextResponse.json(body, { status: apiError.status });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toSafeErrorMessage(error: unknown) {
  if (error instanceof ImportsApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Erreur inconnue.";
}

function toOptionalNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeFilename(filename: string) {
  const normalized = filename
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized.length > 0 ? normalized : "import";
}

function parseFileSizeBytes(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw badRequest("fileSizeBytes invalide.");
  }

  return Math.trunc(numeric);
}

function normalizeSourceFormat(value: unknown, fallback: ImportSourceFormat): ImportSourceFormat {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "json" || normalized === "csv" || normalized === "xlsx") {
    return normalized;
  }

  return fallback;
}

function resolveSourceFormatInput(input: JsonRecord): ImportSourceFormat {
  const direct =
    input.sourceFormat ??
    input.source_format ??
    input.parser ??
    null;

  return normalizeSourceFormat(direct, "json");
}

function getUploadContentType(file: File) {
  const trimmedType = file.type ? file.type.trim() : "";
  return trimmedType.length > 0 ? trimmedType : undefined;
}

function buildStoragePath(userId: string, filename: string) {
  const safeFilename = sanitizeFilename(filename);
  return `${userId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeFilename}`;
}

function validateImportFile(file: File) {
  if (file.size <= 0) {
    throw badRequest("Le fichier est vide.");
  }

  if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
    throw badRequest("Le fichier depasse 50 Mo.");
  }
}

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  const membership = await getCurrentMembershipOrThrow(supabase, user.id);

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    isTenantAdmin: membership.role === "admin",
  };
}

async function getCurrentMembershipOrThrow(
  supabase: Supabase,
  userId: string
): Promise<TenantMembershipRow> {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le tenant courant.");
  }

  const membership = data?.[0] as TenantMembershipRow | undefined;

  if (!membership) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return membership;
}

async function createImportRecord(
  supabase: Supabase,
  payload: ImportInsert
): Promise<ImportRow> {
  const { data, error } = await supabase
    .from("dpgf_imports")
    .insert(payload)
    .select(IMPORT_SELECT_COLUMNS)
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible de creer l'import.");
  }

  if (!data) {
    throw internalError("Impossible de creer l'import.");
  }

  return data as unknown as ImportRow;
}

async function updateImportRecord(
  supabase: Supabase,
  importId: string,
  payload: ImportUpdate,
  fallbackMessage: string
): Promise<ImportRow> {
  const { data, error } = await supabase
    .from("dpgf_imports")
    .update(payload)
    .eq("id", importId)
    .select(IMPORT_SELECT_COLUMNS)
    .single();

  if (error) {
    throw mapSupabaseError(error, fallbackMessage);
  }

  if (!data) {
    throw internalError(fallbackMessage);
  }

  return data as unknown as ImportRow;
}

async function markImportAsFailed(
  supabase: Supabase,
  importId: string,
  errorMessage: string
) {
  await supabase
    .from("dpgf_imports")
    .update({
      status: "failed",
      error_message: errorMessage.slice(0, 1000),
    })
    .eq("id", importId);
}

async function insertRawRows(
  supabase: Supabase,
  importId: string,
  rows: NormalizedImportRow[]
) {
  if (rows.length === 0) return;

  for (let offset = 0; offset < rows.length; offset += IMPORT_ROWS_BATCH_SIZE) {
    const rowsBatch = rows.slice(offset, offset + IMPORT_ROWS_BATCH_SIZE);
    const payload: RawRowInsert[] = rowsBatch.map((row, index) => ({
      import_id: importId,
      row_index: offset + index,
      payload: row,
    }));

    const { error } = await supabase.from("dpgf_rows_raw").insert(payload);
    if (error) {
      throw mapSupabaseError(error, "Impossible d'enregistrer les lignes importees.");
    }
  }
}

function formatUnexpectedImportError(error: unknown): ImportsApiError {
  if (error instanceof ImportsApiError) {
    return error;
  }

  if (error instanceof Error) {
    return badRequest(error.message);
  }

  return internalError();
}

export async function listUserImports() {
  const { supabase, userId, tenantId, isTenantAdmin } = await getAuthenticatedContext();

  let query = supabase
    .from("dpgf_imports")
    .select(IMPORT_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (!isTenantAdmin) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;

  if (error) {
    throw mapSupabaseError(error, "Impossible de recuperer les imports.");
  }

  return data ?? [];
}

export async function createImportFromJsonBody(body: unknown) {
  const input = asRecord(body);
  if (!input) {
    throw badRequest("Payload JSON invalide.");
  }

  const rawRows = input.rows;
  if (!Array.isArray(rawRows)) {
    throw badRequest("Le champ rows est requis et doit etre un tableau.");
  }

  const filename = sanitizeFilename(
    toOptionalNonEmptyString(input.filename) ??
      toOptionalNonEmptyString(input.fileName) ??
      "import.json"
  );
  const sourceFormat = resolveSourceFormatInput(input);
  const storagePath = toOptionalNonEmptyString(input.storagePath);
  const fileSizeBytes = parseFileSizeBytes(input.fileSizeBytes);
  const { supabase, userId, tenantId } = await getAuthenticatedContext();

  let importRecord: ImportRow | null = null;

  try {
    const normalizedRows = normalizeRowsFromJson(rawRows);

    importRecord = await createImportRecord(supabase, {
      tenant_id: tenantId,
      user_id: userId,
      filename,
      source_format: sourceFormat,
      status: "parsing",
      row_count: 0,
      parse_mode: "worker",
      storage_path: storagePath,
      file_size_bytes: fileSizeBytes,
    });

    await insertRawRows(supabase, importRecord.id, normalizedRows);

    return await updateImportRecord(
      supabase,
      importRecord.id,
      {
        status: "completed",
        row_count: normalizedRows.length,
        error_message: null,
      },
      "Impossible de finaliser l'import JSON."
    );
  } catch (error) {
    if (importRecord) {
      await markImportAsFailed(supabase, importRecord.id, toSafeErrorMessage(error));
    }

    throw formatUnexpectedImportError(error);
  }
}

export async function createImportFromMultipartFormData(formData: FormData) {
  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    throw badRequest("Aucun fichier fourni.");
  }

  validateImportFile(fileEntry);

  const { supabase, userId, tenantId } = await getAuthenticatedContext();
  const filename = sanitizeFilename(
    toOptionalNonEmptyString(formData.get("filename")) ??
      toOptionalNonEmptyString(fileEntry.name) ??
      "import"
  );
  const sourceFormat = detectImportSourceFormat(fileEntry.name, fileEntry.type);
  const storagePath = buildStoragePath(userId, filename);

  const { error: uploadError } = await supabase.storage
    .from(DPGF_IMPORTS_BUCKET)
    .upload(storagePath, fileEntry, {
      contentType: getUploadContentType(fileEntry),
      upsert: false,
    });

  if (uploadError) {
    throw badRequest("Impossible de televerser le fichier.", uploadError);
  }

  let importRecord: ImportRow | null = null;

  try {
    importRecord = await createImportRecord(supabase, {
      tenant_id: tenantId,
      user_id: userId,
      filename,
      source_format: sourceFormat,
      status: "parsing",
      row_count: 0,
      parse_mode: "server",
      storage_path: storagePath,
      file_size_bytes: fileEntry.size,
    });

    const parsed = await parseImportFile(fileEntry);
    await insertRawRows(supabase, importRecord.id, parsed.rows);

    return await updateImportRecord(
      supabase,
      importRecord.id,
      {
        status: "completed",
        row_count: parsed.rows.length,
        source_format: parsed.sourceFormat,
        error_message: null,
      },
      "Impossible de finaliser l'import du fichier."
    );
  } catch (error) {
    if (importRecord) {
      await markImportAsFailed(supabase, importRecord.id, toSafeErrorMessage(error));
    } else {
      await supabase.storage.from(DPGF_IMPORTS_BUCKET).remove([storagePath]);
    }

    throw formatUnexpectedImportError(error);
  }
}
