import { isEstimateApiError } from "@/lib/estimates/client-errors";
import { requestJsonUncoordinated } from "@/lib/estimates/client-http";

import {
  MATERIAL_REQUEST_FILE_REJECTED,
  MATERIAL_REQUEST_LINE_CHANGED,
  MATERIAL_REQUEST_PRESUMPTION_CHANGED,
  type BulkUpdateMaterialRequestLinesInput,
  type CompleteMaterialRequestFilesInput,
  type CreateMaterialRequestInput,
  type CreateMaterialRequestLineArticleInput,
  type LinkMaterialRequestLineArticleInput,
  type MaterialRequestArticleCandidate,
  type MaterialRequestDetail,
  type MaterialRequestLineArticleResult,
  type MaterialRequestFile,
  type MaterialRequestFileRejection,
  type MaterialRequestFileRotation,
  type MaterialRequestFileUploads,
  type MaterialRequestLine,
  type MaterialRequestLineInput,
  type MaterialRequestSummary,
  type MaterialRequestTechnician,
  type MaterialRequestUpdateResult,
  type PrepareMaterialRequestFilesInput,
  type UpdateMaterialRequestInput,
} from "./contracts";
import type { LineSupplierProposal } from "./supplier-contracts";

/**
 * Browser-side calls of the material request screens (TI-690). Each function is one HTTP request and
 * returns what the server answered: the screens show that answer, never their own guess of it.
 */

export type MaterialRequestSupplierOption = { id: string; name: string };

export type MaterialRequestList = {
  items: MaterialRequestSummary[];
  technicians: MaterialRequestTechnician[];
  canWrite: boolean;
};

export type MaterialRequestEditorData = MaterialRequestDetail & {
  canWrite: boolean;
  materialOptions: string[];
  supplierOptions: MaterialRequestSupplierOption[];
};

export type MaterialRequestHistoryEntry = {
  request: MaterialRequestSummary & { project_name: string };
  lines: MaterialRequestLine[];
};

export type MaterialRequestBlockedLine = { id: string; codes: string[] };

export const MATERIAL_REQUEST_LINES_BLOCKED = "MATERIAL_REQUEST_LINES_BLOCKED";

export function isLineChanged(error: unknown): boolean {
  return isEstimateApiError(error) && error.code === MATERIAL_REQUEST_LINE_CHANGED;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function requestsPath(projectId: string, ...segments: string[]): string {
  return ["/api/affaires", ...[projectId, "material-requests", ...segments].map(encodeURIComponent)].join("/");
}

function techniciansPath(...segments: string[]): string {
  return ["/api/material-request-technicians", ...segments.map(encodeURIComponent)].join("/");
}

function read<T>(path: string, fallback: string, signal?: AbortSignal): Promise<T> {
  return requestJsonUncoordinated<T>(path, { method: "GET", cache: "no-store", signal }, fallback);
}

function write<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body: unknown, fallback: string): Promise<T> {
  return requestJsonUncoordinated<T>(
    path,
    body === undefined ? { method } : { method, headers: JSON_HEADERS, body: JSON.stringify(body) },
    fallback,
  );
}

export function materialRequestErrorMessage(error: unknown, fallback: string): string {
  if (isEstimateApiError(error) && error.message.trim().length > 0) return error.message;
  return fallback;
}

/**
 * A confirmation the server refused because the presumed material or supplier is no longer the one the
 * screen showed (changed from another session): nothing was written.
 */
export function isPresumptionChanged(error: unknown): boolean {
  return isEstimateApiError(error) && error.code === MATERIAL_REQUEST_PRESUMPTION_CHANGED;
}

/** The lines the server refused to validate, when that is what the error says; null otherwise. */
export function readBlockedLines(error: unknown): MaterialRequestBlockedLine[] | null {
  if (!isEstimateApiError(error) || error.code !== MATERIAL_REQUEST_LINES_BLOCKED) return null;
  const details = error.details;
  const blocked =
    details !== null && typeof details === "object" && "blocked" in details
      ? (details as { blocked: unknown }).blocked
      : null;
  if (!Array.isArray(blocked)) return [];
  return blocked.flatMap((entry: unknown) => {
    if (entry === null || typeof entry !== "object") return [];
    const { id, codes } = entry as { id?: unknown; codes?: unknown };
    if (typeof id !== "string") return [];
    return [{ id, codes: Array.isArray(codes) ? codes.filter((code): code is string => typeof code === "string") : [] }];
  });
}

export function fetchMaterialRequests(projectId: string, signal?: AbortSignal): Promise<MaterialRequestList> {
  return read(requestsPath(projectId), "Les demandes de matériel n’ont pas pu être chargées.", signal);
}

export function createMaterialRequest(
  projectId: string,
  input: CreateMaterialRequestInput,
): Promise<MaterialRequestDetail> {
  return write(requestsPath(projectId), "POST", input, "La demande n’a pas pu être créée.");
}

export function fetchMaterialRequest(
  projectId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<MaterialRequestEditorData> {
  return read(requestsPath(projectId, requestId), "La demande n’a pas pu être chargée.", signal);
}

/** The saved header, and the validated lines the change returned to draft (an empty list when none). */
export function updateMaterialRequest(
  projectId: string,
  requestId: string,
  input: UpdateMaterialRequestInput,
): Promise<MaterialRequestUpdateResult> {
  return write(requestsPath(projectId, requestId), "PATCH", input, "La demande n’a pas pu être enregistrée.");
}

export async function deleteMaterialRequest(projectId: string, requestId: string): Promise<void> {
  await write(requestsPath(projectId, requestId), "DELETE", undefined, "La demande n’a pas pu être supprimée.");
}

/**
 * First step of an upload: the server checks what is declared and answers one signed upload per photo.
 * The photos are not listed on the request before `completeMaterialRequestFiles` answers.
 */
export function prepareMaterialRequestFiles(
  projectId: string,
  requestId: string,
  input: PrepareMaterialRequestFilesInput,
): Promise<MaterialRequestFileUploads> {
  return write(requestsPath(projectId, requestId, "files"), "POST", input, "Les photos n’ont pas pu être préparées.");
}

/** Last step: the server checks what was really stored. A rejection discards the whole batch. */
export async function completeMaterialRequestFiles(
  projectId: string,
  requestId: string,
  input: CompleteMaterialRequestFilesInput,
): Promise<MaterialRequestFile[]> {
  const { files } = await write<{ files: MaterialRequestFile[] }>(
    requestsPath(projectId, requestId, "files", "complete"),
    "POST",
    input,
    "Les photos n’ont pas pu être vérifiées.",
  );
  return files;
}

/** The photos the server refused at `complete`, when that is what the error says; null otherwise. */
export function readRejectedFiles(error: unknown): MaterialRequestFileRejection[] | null {
  if (!isEstimateApiError(error) || error.code !== MATERIAL_REQUEST_FILE_REJECTED) return null;
  const details = error.details;
  const rejected =
    details !== null && typeof details === "object" && "rejected" in details
      ? (details as { rejected: unknown }).rejected
      : null;
  if (!Array.isArray(rejected)) return [];
  return rejected.flatMap((entry: unknown) => {
    if (entry === null || typeof entry !== "object") return [];
    const { id, reason } = entry as { id?: unknown; reason?: unknown };
    if (typeof id !== "string") return [];
    return [{ id, reason: reason === "size" || reason === "type" ? reason : "missing" }];
  });
}

/**
 * Drops a prepared photo that will never be completed. Best effort and silent: it also runs while the
 * page is being left (`keepalive`), when nobody is there to read an error.
 */
export function discardPreparedMaterialRequestFile(projectId: string, requestId: string, fileId: string): Promise<void> {
  return fetch(requestsPath(projectId, requestId, "files", fileId), {
    method: "DELETE",
    credentials: "same-origin",
    keepalive: true,
  }).then(
    () => undefined,
    () => undefined,
  );
}

export function materialRequestFileUrl(projectId: string, requestId: string, fileId: string): string {
  return requestsPath(projectId, requestId, "files", fileId);
}

/** The image bytes of an original; the caller turns them into an object URL and revokes it. */
export async function fetchMaterialRequestFileBlob(
  projectId: string,
  requestId: string,
  fileId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(materialRequestFileUrl(projectId, requestId, fileId), {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: unknown } } | null;
    const message = payload?.error?.message;
    throw new Error(typeof message === "string" && message.trim() ? message : "Impossible d’ouvrir cette photo.");
  }
  return response.blob();
}

export async function rotateMaterialRequestFile(
  projectId: string,
  requestId: string,
  fileId: string,
  rotation: MaterialRequestFileRotation,
): Promise<MaterialRequestFile> {
  const { file } = await write<{ file: MaterialRequestFile }>(
    requestsPath(projectId, requestId, "files", fileId),
    "PATCH",
    { rotation },
    "La rotation n’a pas pu être enregistrée.",
  );
  return file;
}

export async function deleteMaterialRequestFile(projectId: string, requestId: string, fileId: string): Promise<void> {
  await write(
    requestsPath(projectId, requestId, "files", fileId),
    "DELETE",
    undefined,
    "La photo n’a pas pu être retirée.",
  );
}

export async function createMaterialRequestLines(
  projectId: string,
  requestId: string,
  lines: MaterialRequestLineInput[],
): Promise<MaterialRequestLine[]> {
  const { lines: created } = await write<{ lines: MaterialRequestLine[] }>(
    requestsPath(projectId, requestId, "lines"),
    "POST",
    { lines },
    "Les lignes n’ont pas pu être ajoutées.",
  );
  return created;
}

export async function updateMaterialRequestLine(
  projectId: string,
  requestId: string,
  lineId: string,
  patch: MaterialRequestLineInput,
): Promise<MaterialRequestLine> {
  const { line } = await write<{ line: MaterialRequestLine }>(
    requestsPath(projectId, requestId, "lines", lineId),
    "PATCH",
    patch,
    "La ligne n’a pas pu être enregistrée.",
  );
  return line;
}

export async function deleteMaterialRequestLine(projectId: string, requestId: string, lineId: string): Promise<void> {
  await write(
    requestsPath(projectId, requestId, "lines", lineId),
    "DELETE",
    undefined,
    "La ligne n’a pas pu être supprimée.",
  );
}

export async function bulkUpdateMaterialRequestLines(
  projectId: string,
  requestId: string,
  input: BulkUpdateMaterialRequestLinesInput,
): Promise<MaterialRequestLine[]> {
  const { lines } = await write<{ lines: MaterialRequestLine[] }>(
    requestsPath(projectId, requestId, "lines"),
    "PATCH",
    input,
    "La modification n’a pas pu être appliquée à la sélection.",
  );
  return lines;
}

/** Throws an error `readBlockedLines` understands when a line is held back: nothing is validated then. */
export async function validateMaterialRequestLines(
  projectId: string,
  requestId: string,
  ids: string[],
): Promise<MaterialRequestLine[]> {
  const { lines } = await write<{ lines: MaterialRequestLine[] }>(
    requestsPath(projectId, requestId, "lines", "validate"),
    "POST",
    { ids },
    "Les lignes n’ont pas pu être validées.",
  );
  return lines;
}

export async function reopenMaterialRequestLines(
  projectId: string,
  requestId: string,
  ids: string[],
): Promise<MaterialRequestLine[]> {
  const { lines } = await write<{ lines: MaterialRequestLine[] }>(
    requestsPath(projectId, requestId, "lines", "reopen"),
    "POST",
    { ids },
    "Les lignes n’ont pas pu être rouvertes.",
  );
  return lines;
}

/** Proposals for every line of the request that has no article yet, best first; nothing is linked. */
export async function fetchMaterialRequestCandidates(
  projectId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<Record<string, MaterialRequestArticleCandidate[]>> {
  const { lines } = await read<{ lines: Record<string, MaterialRequestArticleCandidate[]> }>(
    requestsPath(projectId, requestId, "candidates"),
    "Les propositions d’articles n’ont pas pu être chargées.",
    signal,
  );
  return lines ?? {};
}

/**
 * The proposed supplier of every line that has an article and no supplier yet (TI-691), null when there is
 * none; nothing is set. The line's supplier is set with the line PATCH.
 */
export async function fetchMaterialRequestSupplierProposals(
  projectId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<Record<string, LineSupplierProposal | null>> {
  const { lines } = await read<{ lines: Record<string, LineSupplierProposal | null> }>(
    requestsPath(projectId, requestId, "supplier-proposals"),
    "Les fournisseurs proposés n’ont pas pu être chargés.",
    signal,
  );
  return lines ?? {};
}

/** Proposals for one line; `query` replaces the line's type words for a search by hand. */
export async function fetchMaterialRequestLineCandidates(
  projectId: string,
  requestId: string,
  lineId: string,
  query: string,
  signal?: AbortSignal,
): Promise<MaterialRequestArticleCandidate[]> {
  const q = query.trim();
  const path = requestsPath(projectId, requestId, "lines", lineId, "candidates");
  const { candidates } = await read<{ candidates: MaterialRequestArticleCandidate[] }>(
    q ? `${path}?${new URLSearchParams({ q }).toString()}` : path,
    "La recherche dans le catalogue n’a pas abouti.",
    signal,
  );
  return candidates ?? [];
}

/** The server fills the line's columns from the article and may return a validated line to draft. */
export function linkMaterialRequestLineArticle(
  projectId: string,
  requestId: string,
  lineId: string,
  input: LinkMaterialRequestLineArticleInput,
): Promise<MaterialRequestLineArticleResult> {
  return write(
    requestsPath(projectId, requestId, "lines", lineId, "article"),
    "PUT",
    input,
    "L’article n’a pas pu être rattaché.",
  );
}

export async function unlinkMaterialRequestLineArticle(
  projectId: string,
  requestId: string,
  lineId: string,
): Promise<MaterialRequestLine> {
  const { line } = await write<{ line: MaterialRequestLine }>(
    requestsPath(projectId, requestId, "lines", lineId, "article"),
    "DELETE",
    undefined,
    "L’article n’a pas pu être délié.",
  );
  return line;
}

/** Creates a draft article of the catalogue from the line and links it. 403 and 409 carry a sentence. */
export function createMaterialRequestLineArticle(
  projectId: string,
  requestId: string,
  lineId: string,
  input: CreateMaterialRequestLineArticleInput,
): Promise<MaterialRequestLineArticleResult> {
  return write(
    requestsPath(projectId, requestId, "lines", lineId, "article"),
    "POST",
    input,
    "L’article n’a pas pu être créé.",
  );
}

export type MaterialRequestSupplyType = { id: string; code: string; name: string };

export async function fetchSupplyTypes(signal?: AbortSignal): Promise<MaterialRequestSupplyType[]> {
  const { items } = await read<{ items: MaterialRequestSupplyType[] }>(
    "/api/catalogue/supply-types",
    "Les types de fourniture n’ont pas pu être chargés.",
    signal,
  );
  return items ?? [];
}

export async function fetchMaterialRequestTechnicians(signal?: AbortSignal): Promise<MaterialRequestTechnician[]> {
  const { items } = await read<{ items: MaterialRequestTechnician[] }>(
    techniciansPath(),
    "La liste des techniciens n’a pas pu être chargée.",
    signal,
  );
  return items;
}

export async function createMaterialRequestTechnician(name: string): Promise<MaterialRequestTechnician> {
  const { item } = await write<{ item: MaterialRequestTechnician }>(
    techniciansPath(),
    "POST",
    { name },
    "Le technicien n’a pas pu être ajouté.",
  );
  return item;
}

export async function fetchTechnicianRequestHistory(
  technicianId: string,
  signal?: AbortSignal,
): Promise<MaterialRequestHistoryEntry[]> {
  const { items } = await read<{ items: MaterialRequestHistoryEntry[] }>(
    `${techniciansPath(technicianId, "requests")}?limit=10`,
    "Les demandes précédentes n’ont pas pu être chargées.",
    signal,
  );
  return items;
}
