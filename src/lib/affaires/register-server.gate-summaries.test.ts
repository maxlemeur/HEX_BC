import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import {
  fetchAffaireRegisterGateSummaries,
  fetchAffaireRegisterGateSummary,
} from "@/lib/affaires/register-server";
import { createInMemoryRestApi } from "@/test/in-memory-rest-api";

const project = (index: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`;
const version = (index: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`;

let sequence = 0;
function entry(projectId: string, overrides: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    id: `cccccccc-cccc-4ccc-8ccc-${String(sequence).padStart(12, "0")}`, project_id: projectId, kind: "missing_piece",
    code: null, text: `Réserve ${sequence}`, severity: "warning", status: "open", scope_type: "project", scope_id: null,
    scope_ref: null, scope_label: "Affaire", version_id: null, source_document_id: null, source_file_name: null,
    is_active: true, metadata: {}, updated_at: `2026-03-12T09:${String(sequence).padStart(2, "0")}:00.000Z`,
    ...overrides,
  };
}

const rows = [
  // Affaire 1: a critical open reserve, one tied to its current version, one to an older version.
  entry(project(1), { severity: "critical" }),
  entry(project(1), { version_id: version(1), status: "clarify_with_client" }),
  entry(project(1), { version_id: version(9), severity: "critical" }),
  // Affaire 2 has no current version: every active entry counts, whatever its version.
  entry(project(2), { version_id: version(8), kind: "assumption" }),
  entry(project(2), { metadata: { continuationDecision: {
    status: "accepted_with_hypothesis", hypothesisEntryId: null, hypothesisText: "Hypothèse retenue",
    acceptedAt: "2026-03-12T09:00:00.000Z", acceptedByUserId: "11111111-1111-4111-8111-111111111111",
  } } }),
  entry(project(2), { is_active: false, severity: "critical" }),
  // Affaire 3: closed entries only.
  entry(project(3), { status: "validated" }),
  entry(project(3), { text: "   " }),
];
const scopes = [
  { projectId: project(1), versionId: version(1) },
  { projectId: project(2), versionId: null },
  { projectId: project(3), versionId: version(3) },
  { projectId: project(4), versionId: null },
];

describe("fetchAffaireRegisterGateSummaries", () => {
  it("gives each affaire the gate summary its own hub reads", async () => {
    const { client } = createInMemoryRestApi({ affaire_register_entries: rows });

    const summaries = await fetchAffaireRegisterGateSummaries({ supabase: client as never, scopes });

    for (const scope of scopes) {
      const single = await fetchAffaireRegisterGateSummary({ supabase: client as never, ...scope });
      // Entries carry lazy getters: compare what the readiness rules read, the ids of every bucket.
      const ids = (summary: typeof single) => Object.fromEntries(Object.entries(summary).map(([key, value]) =>
        [key, Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : item.id) : value]));
      expect(ids(summaries.get(scope.projectId)!), scope.projectId).toEqual(ids(single));
    }
    expect(summaries.get(project(1))?.criticalOpenEntries).toHaveLength(1);
    expect(summaries.get(project(1))?.clarifyWithClientEntries).toHaveLength(1);
    expect(summaries.get(project(2))?.openAssumptionEntries).toHaveLength(1);
    expect(summaries.get(project(2))?.continuedWithHypothesisEntries).toHaveLength(1);
    expect(summaries.get(project(3))?.openQuestionsCount).toBe(0);
    expect(summaries.get(project(4))?.openQuestionsCount).toBe(0);
  });

  it("reads every affaire in one request", async () => {
    const { client, requests } = createInMemoryRestApi({ affaire_register_entries: rows });

    await fetchAffaireRegisterGateSummaries({ supabase: client as never, scopes });

    expect(requests).toHaveLength(1);
    expect(requests[0].url.searchParams.get("project_id")).toBe(`in.(${scopes.map((scope) => scope.projectId).join(",")})`);
  });
});
