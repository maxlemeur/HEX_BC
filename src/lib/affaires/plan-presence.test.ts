import { describe, expect, it, vi } from "vitest";

import { hasStoredIntakePlan, hasStoredStandalonePlan, readStandalonePlanRowsByProject } from "@/lib/affaires/plan-presence";
import { createInMemoryRestApi } from "@/test/in-memory-rest-api";

type Copy = { file_path: string; file_size_bytes: number; project_id: string; metadata: Record<string, unknown> };

// A plan linked from Google Drive has no bytes in the dossier: it counts through its métré working copy.
function backend(copies: Copy[], stored: Record<string, number>) {
  let projectId = "";
  const contains = vi.fn(async (_column: string, filter: Record<string, unknown>) => ({
    data: copies.filter((copy) => copy.project_id === projectId
      && Object.entries(filter).every(([key, value]) => copy.metadata[key] === value)), error: null }));
  const eq = vi.fn((_column: string, value: string) => { projectId = value; return { contains }; });
  return {
    contains,
    eq,
    supabase: {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
      storage: { from: vi.fn(() => ({ info: vi.fn(async (path: string) => path in stored
        ? { data: { size: stored[path] }, error: null } : { data: null, error: { statusCode: "404" } }) })) },
    } as never,
  };
}

const PROJECT_ID = "project-1";
const drivePlan = { id: "doc-drive", storage_path: null, size_bytes: 5, source_provider: "google_drive",
  drive_file_id: "drive_plan", plan_copy_generation: "generation-1" };
const copy = (overrides: Partial<Copy> = {}): Copy => ({ file_path: "tenant/set/file/plan-drive.pdf", file_size_bytes: 9, project_id: PROJECT_ID,
  metadata: { source: "affaire-intake", intake_document_id: "doc-drive", intake_drive_file_id: "drive_plan", intake_generation: "generation-1" }, ...overrides });
// The caller may read the dossier without takeoff rights: its client sees no plan copy.
const reader = { from: vi.fn(() => { throw new Error("the caller's client cannot read plan copies"); }) } as never;
const present = async (copies: Copy[], stored: Record<string, number>, document = drivePlan) => {
  const server = backend(copies, stored).supabase;
  return hasStoredIntakePlan({ supabase: reader, serverClient: () => server, projectId: PROJECT_ID, documents: [document] });
};

describe("hasStoredIntakePlan for plans linked from Google Drive", () => {
  it("counts a Drive plan whose working copy in this affaire holds complete bytes, for any reader of the dossier", async () => {
    const { supabase, contains, eq } = backend([copy()], { "tenant/set/file/plan-drive.pdf": 9 });
    expect(await hasStoredIntakePlan({ supabase: reader, serverClient: () => supabase, projectId: PROJECT_ID, documents: [drivePlan] })).toBe(true);
    expect(eq).toHaveBeenCalledWith("plan_sets.project_id", PROJECT_ID);
    expect(contains).toHaveBeenCalledWith("metadata", { source: "affaire-intake", intake_document_id: "doc-drive",
      intake_drive_file_id: "drive_plan", intake_generation: "generation-1" });
  });

  it("does not count a Drive plan without a complete copy of its current generation in this affaire", async () => {
    const complete = { "tenant/set/file/plan-drive.pdf": 9 };
    expect(await present([], {})).toBe(false);
    expect(await present([copy()], { "tenant/set/file/plan-drive.pdf": 4 })).toBe(false);
    expect(await present([copy()], {})).toBe(false);
    expect(await present([copy({ metadata: { ...copy().metadata, intake_cleanup_pending: true } })], complete)).toBe(false);
    expect(await present([copy()], complete, { ...drivePlan, plan_copy_generation: "generation-2" })).toBe(false);
    expect(await present([copy({ project_id: "project-2" })], complete)).toBe(false);
  });
});

describe("standalone plan files of a portfolio", () => {
  const TENANT_ID = "22222222-2222-4222-8222-222222222222";
  const planFile = (id: string, projectId: string, overrides: Record<string, unknown> = {}) => ({
    id, tenant_id: TENANT_ID, file_path: `${projectId}/${id}.pdf`, file_size_bytes: 9, metadata: null,
    plan_sets: { project_id: projectId }, ...overrides,
  });
  const files = [
    planFile("file-a1", "project-a"),
    planFile("file-b1", "project-b", { metadata: { source: "affaire-intake" } }),
    planFile("file-b2", "project-b"),
    planFile("file-c1", "project-c", { tenant_id: "another-tenant" }),
    planFile("file-d1", "project-d"),
  ];
  // The embedded filter on the plan set, which the generic fixture does not express.
  const api = () => createInMemoryRestApi({ plan_files: files }, { plan_files: (url, rows) => {
    const projects = url.searchParams.get("plan_sets.project_id")!;
    const wanted = projects.startsWith("in.(") ? projects.slice(4, -1).split(",") : [projects.slice(3)];
    return rows.filter((row) => `eq.${row.tenant_id}` === url.searchParams.get("tenant_id")
      && wanted.includes((row.plan_sets as { project_id: string }).project_id));
  } });
  const storage = (stored: Record<string, number>) => ({ from: () => ({ info: async (path: string) => path in stored
    ? { data: { size: stored[path] }, error: null } : { data: null, error: { statusCode: "404" } } }) });

  it("reads the plan files of every requested affaire of the tenant in one request, grouped by affaire", async () => {
    const { client, requests } = api();

    const rows = await readStandalonePlanRowsByProject({
      supabase: client as never, tenantId: TENANT_ID, projectIds: ["project-a", "project-b", "project-c", "project-e"],
    });

    expect(requests).toHaveLength(1);
    expect(Object.fromEntries([...rows].map(([projectId, group]) => [projectId, group.map((row) => row.id)])))
      .toEqual({ "project-a": ["file-a1"], "project-b": ["file-b1", "file-b2"] });
  });

  it("answers from the rows of a portfolio read as it does from its own read, without reading again", async () => {
    const stored = { "project-a/file-a1.pdf": 9, "project-b/file-b1.pdf": 9, "project-b/file-b2.pdf": 4 };
    for (const projectId of ["project-a", "project-b", "project-e"]) {
      const own = api();
      Object.assign(own.client, { storage: storage(stored) });
      const expected = await hasStoredStandalonePlan({ supabase: own.client as never, projectId, tenantId: TENANT_ID });

      const portfolio = api();
      Object.assign(portfolio.client, { storage: storage(stored) });
      const rows = await readStandalonePlanRowsByProject({
        supabase: portfolio.client as never, tenantId: TENANT_ID, projectIds: ["project-a", "project-b", "project-e"],
      });
      const answer = await hasStoredStandalonePlan({
        supabase: portfolio.client as never, projectId, tenantId: TENANT_ID, rows: rows.get(projectId) ?? [],
      });

      expect(answer, projectId).toBe(expected);
      expect(portfolio.requests).toHaveLength(1);
    }
    // Complete bytes count; an intake-sourced copy and a truncated file do not; no file, no plan.
    const present = async (projectId: string) => {
      const { client } = api();
      Object.assign(client, { storage: storage(stored) });
      return hasStoredStandalonePlan({ supabase: client as never, projectId, tenantId: TENANT_ID });
    };
    expect([await present("project-a"), await present("project-b"), await present("project-e")]).toEqual([true, false, false]);
  });
});
