import {
  MATERIAL_REQUEST_FILE_MAX_BYTES,
  MATERIAL_REQUEST_MAX_FILES,
  type MaterialRequestLine,
} from "@/lib/material-requests/contracts";

/** « 2026-11-12 » → « 12/11/2026 », without a time zone in the way. */
export function formatDateOnly(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** How a line is named to the operator outside its row: its type and size, else the technician's words. */
export function lineTitle(line: MaterialRequestLine): string {
  const type = text(line.product_type);
  if (type) return [type, text(line.dimension)].filter(Boolean).join(" ");
  const original = text(line.original_text);
  return original ? `« ${original} »` : "Sans désignation";
}

export function formatQuantity(quantity: number | null): string {
  return quantity === null ? "" : String(quantity).replace(".", ",");
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

export function materialRequestsHref(projectId: string): string {
  return `/dashboard/affaires/${projectId}/demandes-materiel`;
}

export function materialRequestHref(projectId: string, requestId: string): string {
  return `${materialRequestsHref(projectId)}/${requestId}`;
}

/** Refuses on the spot what the server would refuse after a long upload. */
export function checkPhotoSelection(files: readonly File[], alreadyThere: number): string | null {
  if (alreadyThere + files.length > MATERIAL_REQUEST_MAX_FILES) {
    return `${MATERIAL_REQUEST_MAX_FILES} photos au plus par demande.`;
  }
  const tooBig = files.find((file) => file.size > MATERIAL_REQUEST_FILE_MAX_BYTES);
  return tooBig ? `« ${tooBig.name} » dépasse 20 Mo.` : null;
}
