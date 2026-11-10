// Adds one file to the dossier of an affaire from the browser, through the
// route the dropzone posts to. For a file made on the page, such as the
// plotted PDF of a CAD original.

export type DossierAddition = { ok: true; documentId: string; fileName: string } | { ok: false; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function refusal(payload: unknown, status: number): string {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") return payload.error;
    if (isRecord(payload.error) && typeof payload.error.message === "string") return payload.error.message;
  }
  return `Erreur serveur (${status})`;
}

export async function addFileToDossier(projectId: string, file: File): Promise<DossierAddition> {
  const body = new FormData();
  body.append("files", file);
  let response: Response;
  try {
    response = await fetch(`/api/affaires/${projectId}/intake/files`, { method: "POST", body });
  } catch {
    return { ok: false, message: "Erreur réseau. Vérifiez votre connexion." };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, message: refusal(payload, response.status) };

  const data = isRecord(payload) && payload.ok === true && isRecord(payload.data) ? payload.data : payload;
  const added = isRecord(data) && typeof data.uploadId === "string" && Array.isArray(data.files) ? data.files[0] : null;
  if (!isRecord(added) || typeof added.documentId !== "string" || typeof added.fileName !== "string") return { ok: false, message: "Réponse upload invalide." };
  if (added.status !== "uploaded") {
    return { ok: false, message: typeof added.rejectionReason === "string" && added.rejectionReason ? added.rejectionReason : "Le dossier a refusé ce fichier." };
  }
  return { ok: true, documentId: added.documentId, fileName: added.fileName };
}
