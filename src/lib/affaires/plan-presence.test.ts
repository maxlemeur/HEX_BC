import { describe, expect, it, vi } from "vitest";

import { hasStoredIntakePlan } from "@/lib/affaires/plan-presence";

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
const present = async (copies: Copy[], stored: Record<string, number>, document = drivePlan) =>
  hasStoredIntakePlan({ supabase: backend(copies, stored).supabase, projectId: PROJECT_ID, documents: [document] });

describe("hasStoredIntakePlan for plans linked from Google Drive", () => {
  it("counts a Drive plan whose working copy in this affaire holds complete bytes", async () => {
    const { supabase, contains, eq } = backend([copy()], { "tenant/set/file/plan-drive.pdf": 9 });
    expect(await hasStoredIntakePlan({ supabase, projectId: PROJECT_ID, documents: [drivePlan] })).toBe(true);
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
