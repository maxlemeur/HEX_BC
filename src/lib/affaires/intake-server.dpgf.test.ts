import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/affaires/google-drive/content", () => ({ readLinkedDriveDocument: vi.fn(), readLinkedDriveFile: vi.fn() }));

import { readLinkedDriveDocument, readLinkedDriveFile } from "@/lib/affaires/google-drive/content";
import { DriveError } from "@/lib/affaires/google-drive/errors";
import { getAffaireIntakeDpgfDownload, readAffaireIntakeDpgfFile } from "@/lib/affaires/intake-server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { ApiError } from "@/lib/estimates/errors";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOCUMENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const driveDocument = {
  id: DOCUMENT_ID, tenant_id: TENANT_ID, file_name: "DPGF lot 1.xlsx", mime_type: MIME, size_bytes: 11,
  storage_path: null, drive_connection_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", drive_file_id: "drive-dpgf",
};

function supabaseWith(document: Record<string, unknown> | null) {
  const storage = { from: vi.fn(() => ({ createSignedUrl: vi.fn(), download: vi.fn() })) };
  const documents = {
    select: vi.fn(() => documents), eq: vi.fn(() => documents), is: vi.fn(() => documents),
    maybeSingle: vi.fn(async () => ({ data: document, error: null })),
  };
  const projects = {
    select: vi.fn(() => projects), eq: vi.fn(() => projects),
    maybeSingle: vi.fn(async () => ({ data: { id: PROJECT_ID, tenant_id: TENANT_ID, user_id: USER_ID, is_archived: false }, error: null })),
  };
  return {
    storage, documents,
    from: vi.fn((table: string) => {
      if (table === "estimate_projects") return projects;
      if (table === "affaire_intake_documents") return documents;
      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

function signIn(supabase: ReturnType<typeof supabaseWith>) {
  vi.mocked(getAuthenticatedContext).mockResolvedValue({
    userId: USER_ID, tenantId: TENANT_ID, tenantRole: "member", supabase,
  } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);
}

describe("dossier DPGF linked from Google Drive", () => {
  beforeEach(() => vi.clearAllMocks());

  it("describes a Drive piece with Drive's current size and no download URL or stored copy", async () => {
    const supabase = supabaseWith(driveDocument);
    signIn(supabase);
    vi.mocked(readLinkedDriveFile).mockResolvedValue({ size: "14" } as never);

    await expect(getAffaireIntakeDpgfDownload(PROJECT_ID, DOCUMENT_ID)).resolves.toEqual({
      documentId: DOCUMENT_ID, fileName: "DPGF lot 1.xlsx", mimeType: MIME, sizeBytes: 14, downloadUrl: null,
    });
    expect(readLinkedDriveFile).toHaveBeenCalledWith(driveDocument);
    expect(supabase.storage.from).not.toHaveBeenCalled();
    expect(supabase.documents.select).toHaveBeenCalledWith(expect.stringContaining("drive_file_id"));
    expect(supabase.documents.eq).toHaveBeenCalledWith("document_kind", "dpgf");
    expect(supabase.documents.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("reads the Drive bytes for the import, with the account that linked the piece", async () => {
    signIn(supabaseWith(driveDocument));
    vi.mocked(readLinkedDriveDocument).mockResolvedValue({ bytes: Buffer.from("drive bytes"), file: {} } as never);

    const file = await readAffaireIntakeDpgfFile(PROJECT_ID, DOCUMENT_ID);
    expect(file.name).toBe("DPGF lot 1.xlsx");
    expect(file.type).toBe(MIME);
    expect(await file.text()).toBe("drive bytes");
    expect(readLinkedDriveDocument).toHaveBeenCalledWith(driveDocument);
  });

  it("reports a Drive refusal as an API error the dossier can show", async () => {
    signIn(supabaseWith(driveDocument));
    vi.mocked(readLinkedDriveDocument).mockRejectedValue(new DriveError(422, "DRIVE_CONNECTION_REMOVED", "Compte retiré."));

    const failure = await readAffaireIntakeDpgfFile(PROJECT_ID, DOCUMENT_ID).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 422, code: "DRIVE_CONNECTION_REMOVED", message: "Compte retiré." });
  });

  it("refuses a piece with neither a stored copy nor a Drive link", async () => {
    signIn(supabaseWith({ ...driveDocument, drive_file_id: null, drive_connection_id: null }));

    await expect(getAffaireIntakeDpgfDownload(PROJECT_ID, DOCUMENT_ID)).rejects.toMatchObject({ status: 404 });
    expect(readLinkedDriveFile).not.toHaveBeenCalled();
  });
});
