import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/affaires/intake-server", () => ({ requireAffaireProjectReadAccess: vi.fn(), readAffaireBriefDraft: vi.fn() }));
vi.mock("@/lib/affaires/intake-document-preview", () => ({ readAffaireDocumentPreview: vi.fn() }));
vi.mock("@/lib/affaires/register-server", () => ({ fetchAffaireRegisterPage: vi.fn() }));

import { readAffaireBriefDraft, requireAffaireProjectReadAccess } from "@/lib/affaires/intake-server";
import { readAffaireDocumentPreview } from "@/lib/affaires/intake-document-preview";
import { fetchAffaireRegisterPage } from "@/lib/affaires/register-server";
import { listAffaireDocuments, loadAffaireDocument, readAffaireBriefAndRegister } from "@/lib/assistant/affaire-reading-server";
import { AssistantToolError } from "@/lib/assistant/loop";
import { notFound } from "@/lib/estimates/errors";

const AFFAIRE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOCUMENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** A Supabase query that records its filters and answers with `result`. */
function recordingClient(result: { data: unknown; error: unknown }) {
  const filters: Array<[string, string, unknown]> = [];
  const query: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit"]) query[method] = () => query;
  for (const method of ["eq", "is"]) query[method] = (column: string, value: unknown) => { filters.push([method, column, value]); return query; };
  query.maybeSingle = async () => result;
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  const from = vi.fn(() => query);
  return { client: { from }, from, filters };
}

function grantAccess(client: unknown) {
  vi.mocked(requireAffaireProjectReadAccess).mockResolvedValue({
    context: { supabase: client, userId: "director-1", tenantId: "tenant-1", tenantRole: "director" },
    project: { id: AFFAIRE, user_id: "owner-1" },
  } as never);
}

describe("the affaire's documents read by the assistant", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("refuses a document of another affaire before reading any of its bytes", async () => {
    const { client, filters } = recordingClient({ data: null, error: null });
    grantAccess(client);
    const read = loadAffaireDocument({ projectId: AFFAIRE, documentId: DOCUMENT });
    await expect(read).rejects.toBeInstanceOf(AssistantToolError);
    await expect(read).rejects.toThrow("n’appartient pas à l’affaire de cette conversation");
    expect(requireAffaireProjectReadAccess).toHaveBeenCalledWith(AFFAIRE);
    // The lookup is bound to the conversation's affaire and tenant, not to the identifier alone.
    expect(filters).toEqual(expect.arrayContaining([["eq", "project_id", AFFAIRE], ["eq", "tenant_id", "tenant-1"], ["eq", "id", DOCUMENT]]));
    expect(readAffaireDocumentPreview).not.toHaveBeenCalled();
  });

  it("refuses every read once the member cannot read the affaire any more, without saying more", async () => {
    vi.mocked(requireAffaireProjectReadAccess).mockRejectedValue(notFound("Affaire introuvable."));
    await expect(loadAffaireDocument({ projectId: AFFAIRE, documentId: DOCUMENT })).rejects.toThrow("Vous n’avez pas accès aux pièces de cette affaire.");
    await expect(listAffaireDocuments(AFFAIRE)).rejects.toBeInstanceOf(AssistantToolError);
    expect(readAffaireDocumentPreview).not.toHaveBeenCalled();
  });

  it("reads a document of the affaire through the dossier's own preview, with the member's rights", async () => {
    const { client } = recordingClient({ data: { id: DOCUMENT, file_name: "CCTP.pdf", mime_type: "application/pdf; charset=binary", document_kind: "cctp" }, error: null });
    grantAccess(client);
    vi.mocked(readAffaireDocumentPreview).mockResolvedValue({ bytes: new Uint8Array([1, 2]), fileName: "CCTP.pdf", mimeType: "application/octet-stream" });
    const document = await loadAffaireDocument({ projectId: AFFAIRE, documentId: DOCUMENT });
    expect(readAffaireDocumentPreview).toHaveBeenCalledWith(AFFAIRE, DOCUMENT, true);
    expect(document).toEqual({ documentId: DOCUMENT, fileName: "CCTP.pdf", type: "CCTP", mimeType: "application/pdf", bytes: new Uint8Array([1, 2]) });
  });

  it("refuses a format it does not read before fetching any of its bytes", async () => {
    const { client } = recordingClient({ data: { id: DOCUMENT, file_name: "DPGF.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", document_kind: "dpgf" }, error: null });
    grantAccess(client);
    await expect(loadAffaireDocument({ projectId: AFFAIRE, documentId: DOCUMENT })).rejects.toThrow("pas encore lu");
    expect(readAffaireDocumentPreview).not.toHaveBeenCalled();
  });

  it("tells a dossier refusal (gone, too large) to the model as it is worded", async () => {
    const { client } = recordingClient({ data: { id: DOCUMENT, file_name: "CCTP.pdf", mime_type: "application/pdf", document_kind: "cctp" }, error: null });
    grantAccess(client);
    vi.mocked(readAffaireDocumentPreview).mockRejectedValue(notFound("Le fichier n’est plus disponible. Actualisez le dossier."));
    await expect(loadAffaireDocument({ projectId: AFFAIRE, documentId: DOCUMENT })).rejects.toThrow("Le fichier n’est plus disponible.");
  });

  it("lists the affaire's available documents with their type, principal ones first", async () => {
    const { client, filters } = recordingClient({ data: [
      { id: "d-2", file_name: "Plan RDC.pdf", mime_type: "application/octet-stream", size_bytes: 2_000_000, document_kind: "plans", document_priority: "secondary", storage_path: "p/d-2" },
      { id: "d-5", file_name: "Perdu.pdf", mime_type: "application/pdf", size_bytes: 1_000, document_kind: "cctp", document_priority: "primary", storage_path: null, drive_file_id: null },
      { id: "d-1", file_name: "CCTP.pdf", mime_type: "application/pdf", size_bytes: 500_000, document_kind: "cctp", document_priority: "primary", storage_path: null, drive_file_id: "drive-1" },
      { id: "d-3", file_name: "DPGF.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 40_000, document_kind: "dpgf", document_priority: "primary", storage_path: "p/d-3" },
      { id: "d-4", file_name: "Courrier.eml", mime_type: "message/rfc822", size_bytes: 3_000, document_kind: "emails", document_priority: "secondary", storage_path: "p/d-4" },
    ], error: null });
    grantAccess(client);
    const listed = await listAffaireDocuments(AFFAIRE);
    expect(filters).toEqual(expect.arrayContaining([
      ["eq", "project_id", AFFAIRE], ["eq", "tenant_id", "tenant-1"], ["eq", "upload_status", "uploaded"], ["is", "deleted_at", null], ["is", "deletion_token", null],
    ]));
    expect(listed).toEqual({ pieces: [
      { id: "d-1", nom: "CCTP.pdf", type: "CCTP", principale: true, pages: null, lisible: true, taille_ko: 488 },
      { id: "d-3", nom: "DPGF.xlsx", type: "DPGF", principale: true, pages: null, lisible: false, taille_ko: 39 },
      { id: "d-2", nom: "Plan RDC.pdf", type: "Plans", principale: false, pages: null, lisible: true, taille_ko: 1953 },
      { id: "d-4", nom: "Courrier.eml", type: "Emails / courriers", principale: false, pages: null, lisible: false, taille_ko: 3 },
    ] });
  });

  it("gives the brief and the open points of the register, in short", async () => {
    vi.mocked(requireAffaireProjectReadAccess).mockResolvedValue({ context: {}, project: { id: AFFAIRE } } as never);
    vi.mocked(readAffaireBriefDraft).mockResolvedValue({
      status: "confirme", summary: "Rénovation chaufferie", projectObject: "Chaufferie gaz", scope: ["Production"], lots: ["CVC"],
      receivedPieces: ["CCTP"], assumptions: [], vigilancePoints: ["Accès toiture"], missingElements: ["Plans"],
      sources: [], uploadId: null, lastGeneratedAt: null, confirmedAt: "2026-11-01T10:00:00.000Z",
    });
    vi.mocked(fetchAffaireRegisterPage).mockResolvedValue({
      items: [{ id: "r-1", kind: "question", code: "Q1", text: "Type de chaudière ?", severity: "critical", status: "open",
        scopeLabel: "Lot CVC", sourceFileName: "CCTP.pdf", sourceDocumentId: DOCUMENT, history: [] }],
      nextCursor: "next", summary: { openQuestionsCount: 1 },
    } as never);
    const read = await readAffaireBriefAndRegister(AFFAIRE);
    expect(fetchAffaireRegisterPage).toHaveBeenCalledWith(expect.objectContaining({ projectId: AFFAIRE }));
    expect(read).toEqual({
      brief: { statut: "confirme", resume: "Rénovation chaufferie", objet: "Chaufferie gaz", perimetre: ["Production"], lots: ["CVC"],
        pieces_recues: ["CCTP"], hypotheses: [], points_de_vigilance: ["Accès toiture"], elements_manquants: ["Plans"], confirme_le: "2026-11-01T10:00:00.000Z" },
      registre: {
        entrees: [{ id: "r-1", type: "question", code: "Q1", texte: "Type de chaudière ?", gravite: "critical", statut: "open", portee: "Lot CVC",
          piece_source: "CCTP.pdf", piece_source_id: DOCUMENT }],
        autres_entrees: true,
      },
    });
  });
});
