import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", async (importOriginal) => {
  const getAuthenticatedContext = vi.fn();
  return {
    ...(await importOriginal<typeof import("@/lib/auth/tenant-context")>()),
    getAuthenticatedContext, getAuthenticatedTenantContext: getAuthenticatedContext,
  };
});
// A DPGF linked from Drive: its download descriptor comes from Drive's metadata, not from storage.
vi.mock("@/lib/affaires/google-drive/content", () => ({
  readLinkedDriveFile: vi.fn(async () => ({ size: "2048", version: null })),
  readLinkedDriveDocument: vi.fn(),
}));

import type { AffaireAccessMode } from "@/lib/affaires/access-server";
import { assertProjectAccessOrThrow } from "@/lib/affaires/import-flow-server";
import { getAffaireIntakeDpgfDownload, readAffaireBriefDraft } from "@/lib/affaires/intake-server";
import { fetchAffaireRegisterSummary, updateAffaireRegisterEntryStatus } from "@/lib/affaires/register-server";
import { findReadableAffaireProject } from "@/lib/affaires/server";
import { listAffaireEstimateVersions } from "@/lib/assistant/estimate-reading-server";
import { AssistantToolError } from "@/lib/assistant/loop";
import { getAuthenticatedContext, type AuthenticatedTenantContext, type TenantRole } from "@/lib/auth/tenant-context";
import { createInMemoryRestApi } from "@/test/in-memory-rest-api";

const TENANT = "7e000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "7e000000-0000-4000-8000-000000000002";
const OWNER = "7e000000-0000-4000-8000-000000000011";
const ACTIVE = "7e000000-0000-4000-8000-000000000101";
const ARCHIVED = "7e000000-0000-4000-8000-000000000102";
const ENTRY = (projectId: string) => `${projectId.slice(0, -3)}201`;
const DPGF = (projectId: string) => `${projectId.slice(0, -3)}301`;

const affaires = [ACTIVE, ARCHIVED];
const { client } = createInMemoryRestApi({
  estimate_projects: affaires.map((id) => ({
    id, tenant_id: TENANT, user_id: OWNER, name: "Affaire fictive", reference: null, client_name: null,
    site_address: null, is_archived: id === ARCHIVED,
  })),
  estimate_versions: affaires.map((projectId) => ({
    id: `${projectId.slice(0, -3)}401`, tenant_id: TENANT, project_id: projectId, version_number: 1, variant_label: null,
    title: "Chiffrage fictif", status: "draft", updated_at: "2026-11-20T09:00:00.000Z",
  })),
  affaire_register_entries: affaires.map((projectId) => ({
    id: ENTRY(projectId), tenant_id: TENANT, project_id: projectId, version_id: null, source_document_id: null,
    kind: "assumption", code: null, text: "Hypothèse fictive", severity: "info", status: "open", origin_kind: "manual",
    scope_type: "project", scope_id: null, scope_ref: null, scope_label: "Affaire", source_file_name: null,
    sync_key: null, is_active: true, metadata: {}, created_by: OWNER, updated_by: OWNER,
    created_at: "2026-11-20T09:00:00.000Z", updated_at: "2026-11-20T09:00:00.000Z",
  })),
  affaire_intake_documents: affaires.map((projectId) => ({
    id: DPGF(projectId), tenant_id: TENANT, project_id: projectId, file_name: "dpgf-fictive.xlsx",
    mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 2048,
    storage_path: null, drive_connection_id: "drive-connection", drive_file_id: "drive-file",
    upload_status: "uploaded", classification_status: "classified", document_kind: "dpgf",
    deleted_at: null, deletion_token: null,
  })),
});

type Member = "owner" | "admin" | "director" | "other member" | "member of another tenant";

const MEMBERS: Record<Member, { userId: string; tenantId: string; tenantRole: TenantRole }> = {
  owner: { userId: OWNER, tenantId: TENANT, tenantRole: "engineer" },
  admin: { userId: "7e000000-0000-4000-8000-000000000012", tenantId: TENANT, tenantRole: "admin" },
  director: { userId: "7e000000-0000-4000-8000-000000000013", tenantId: TENANT, tenantRole: "director" },
  "other member": { userId: "7e000000-0000-4000-8000-000000000014", tenantId: TENANT, tenantRole: "engineer" },
  // An admin elsewhere: no role reaches the affaire of another tenant.
  "member of another tenant": { userId: "7e000000-0000-4000-8000-000000000015", tenantId: OTHER_TENANT, tenantRole: "admin" },
};

/** The decided rule, on an active affaire of the tenant. An archived affaire is refused to everyone. */
const ALLOWED: Record<Member, Record<AffaireAccessMode, boolean>> = {
  owner: { read: true, write: true },
  admin: { read: true, write: true },
  director: { read: true, write: false },
  "other member": { read: false, write: false },
  "member of another tenant": { read: false, write: false },
};

function contextOf(member: Member) {
  const { userId, tenantId, tenantRole } = MEMBERS[member];
  return { supabase: client, userId, tenantId, tenantRole, isTenantAdmin: tenantRole === "admin" } as unknown as AuthenticatedTenantContext;
}

const allowed = () => "allowed";

/**
 * One production function per former copy of the rule. Each keeps the answer its callers had: the
 * register its own wording, the list filter no row at all, the assistant a refusal told to the model.
 */
const ENTRIES: Array<{
  copy: string; mode: AffaireAccessMode; run: (projectId: string, member: Member) => Promise<string>;
  refused: { missing: string; role: string };
}> = [
  {
    copy: "intake", mode: "read", run: (projectId) => readAffaireBriefDraft(projectId).then(allowed),
    refused: { missing: "404 Affaire introuvable.", role: "403 Accès refusé à cette affaire." },
  },
  {
    copy: "intake", mode: "write", run: (projectId) => getAffaireIntakeDpgfDownload(projectId, DPGF(projectId)).then(allowed),
    refused: { missing: "404 Affaire introuvable.", role: "403 Accès refusé à cette affaire." },
  },
  {
    copy: "register", mode: "read", run: (projectId) => fetchAffaireRegisterSummary({ projectId }).then(allowed),
    refused: { missing: "404 Affaire introuvable.", role: "403 Accès refusé à ce registre affaire." },
  },
  {
    copy: "register", mode: "write",
    // Setting the status it already has writes nothing once access is granted.
    run: (projectId) => updateAffaireRegisterEntryStatus({ projectId, entryId: ENTRY(projectId), status: "open" }).then(allowed),
    refused: { missing: "404 Affaire introuvable.", role: "403 Accès refusé à ce registre affaire." },
  },
  {
    copy: "affaire list filter", mode: "read",
    run: async (projectId, member) => (await findReadableAffaireProject(contextOf(member), projectId)) ? "allowed" : "no row",
    refused: { missing: "no row", role: "no row" },
  },
  ...(["read", "write"] as const).map((mode) => ({
    copy: "import and takeoff preparation filter", mode,
    run: (projectId: string, member: Member) =>
      assertProjectAccessOrThrow({ supabase: client, projectId, ...MEMBERS[member], mode }).then(allowed),
    refused: { missing: "undefined Projet cible introuvable ou non autorise.", role: "undefined Projet cible introuvable ou non autorise." },
  })),
  {
    copy: "assistant estimate tools", mode: "read", run: (projectId) => listAffaireEstimateVersions(projectId).then(allowed),
    refused: { missing: "Vous n’avez pas accès aux devis de cette affaire.", role: "Vous n’avez pas accès aux devis de cette affaire." },
  },
];

async function outcome(run: () => Promise<string>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AssistantToolError) return error.message;
    const { status, message } = error as { status?: number; message?: string };
    return `${status} ${message}`;
  }
}

const cases = ENTRIES.flatMap((entry) => (Object.keys(MEMBERS) as Member[]).flatMap((member) =>
  (["active", "archived"] as const).map((state) => {
    const missing = state === "archived" || member === "member of another tenant";
    const expected = missing ? entry.refused.missing : ALLOWED[member][entry.mode] ? "allowed" : entry.refused.role;
    return { name: `${entry.copy} (${entry.mode}), ${member}, ${state} affaire: ${expected}`, entry, member, state, expected };
  })));

describe("one access rule for an affaire, whichever module asks", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each(cases)("$name", async ({ entry, member, state, expected }) => {
    vi.mocked(getAuthenticatedContext).mockResolvedValue(contextOf(member));
    const projectId = state === "active" ? ACTIVE : ARCHIVED;
    expect(await outcome(() => entry.run(projectId, member))).toBe(expected);
  });
});
