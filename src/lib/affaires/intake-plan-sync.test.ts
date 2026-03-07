import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/feature-flags", () => ({
  isTakeoffEnabled: vi.fn(),
}));

import { syncTakeoffPlanSetFromAffaireIntake } from "@/lib/affaires/intake-plan-sync";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type PlanSetRow = {
  id: string;
  estimate_version_id: string | null;
  name: string;
  metadata: Record<string, unknown>;
};

type PlanFileRow = {
  id: string;
  tenant_id: string;
  plan_set_id: string;
  file_path: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number;
  page_count: number | null;
  file_hash: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
};

function createHarness(input?: {
  planSets?: PlanSetRow[];
  planFiles?: PlanFileRow[];
  intakeFiles?: Record<string, Blob>;
  planStorageFiles?: Record<string, Blob>;
}) {
  const planSets = [...(input?.planSets ?? [])];
  const planFiles = [...(input?.planFiles ?? [])];
  const intakeFiles = new Map(Object.entries(input?.intakeFiles ?? {}));
  const planStorageFiles = new Map(Object.entries(input?.planStorageFiles ?? {}));
  const removedPaths: string[] = [];
  const uploadedPaths: string[] = [];

  const from = vi.fn((table: string) => {
    if (table === "plan_sets") {
      return {
        select: vi.fn(() => {
          const builder = {
            eq: vi.fn(),
            order: vi.fn(async () => ({
              data: planSets,
              error: null,
            })),
          };

          builder.eq.mockReturnValue(builder);
          return builder;
        }),
        insert: vi.fn((values: Record<string, unknown>) => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => {
              const name =
                typeof values.name === "string" ? values.name : "Plans import";
              const metadata =
                typeof values.metadata === "object" &&
                values.metadata !== null &&
                !Array.isArray(values.metadata)
                  ? (values.metadata as Record<string, unknown>)
                  : {};
              const row = {
                id: "plan-set-created",
                estimate_version_id: null,
                name,
                metadata,
              } satisfies PlanSetRow;
              planSets.push(row);
              return {
                data: row,
                error: null,
              };
            }),
          })),
        })),
      };
    }

    if (table === "plan_files") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async (_column: string, value: string) => ({
            data: planFiles.filter((row) => row.plan_set_id === value),
            error: null,
          })),
        })),
        insert: vi.fn(async (values: Record<string, unknown>) => {
          planFiles.push(values as unknown as PlanFileRow);
          return { error: null };
        }),
        delete: vi.fn(() => ({
          in: vi.fn(async (_column: string, values: string[]) => {
            for (const id of values) {
              const index = planFiles.findIndex((row) => row.id === id);
              if (index >= 0) {
                planFiles.splice(index, 1);
              }
            }

            return { error: null };
          }),
        })),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  const storageFrom = vi.fn((bucket: string) => {
    if (bucket === "affaire-intake") {
      return {
        download: vi.fn(async (path: string) => ({
          data: intakeFiles.get(path) ?? null,
          error: intakeFiles.has(path) ? null : new Error(`Missing intake file ${path}`),
        })),
      };
    }

    if (bucket === "plan-files") {
      return {
        upload: vi.fn(async (path: string, blob: Blob) => {
          uploadedPaths.push(path);
          planStorageFiles.set(path, blob);
          return { error: null };
        }),
        remove: vi.fn(async (paths: string[]) => {
          removedPaths.push(...paths);
          for (const path of paths) {
            planStorageFiles.delete(path);
          }
          return { error: null };
        }),
      };
    }

    throw new Error(`Unexpected bucket: ${bucket}`);
  });

  return {
    supabase: {
      from,
      storage: {
        from: storageFrom,
      },
    } as never,
    planSets,
    planFiles,
    removedPaths,
    uploadedPaths,
    planStorageFiles,
  };
}

describe("syncTakeoffPlanSetFromAffaireIntake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTakeoffEnabled).mockResolvedValue(true);
  });

  it("creates a canonical project-scoped plan set and copies eligible intake PDFs", async () => {
    const harness = createHarness({
      intakeFiles: {
        [`${TENANT_ID}/${PROJECT_ID}/upload-1/doc-1/plan-a.pdf`]: new Blob(["pdf-a"]),
      },
    });

    const result = await syncTakeoffPlanSetFromAffaireIntake({
      supabase: harness.supabase,
      project: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
      },
      documents: [
        {
          id: "doc-1",
          upload_id: "upload-1",
          created_by: USER_ID,
          storage_path: `${TENANT_ID}/${PROJECT_ID}/upload-1/doc-1/plan-a.pdf`,
          file_name: "plan-a.pdf",
          mime_type: "application/pdf",
          size_bytes: 1234,
          upload_status: "uploaded",
          classification_status: "classified",
          document_kind: "plans",
        },
        {
          id: "doc-2",
          upload_id: "upload-1",
          created_by: USER_ID,
          storage_path: `${TENANT_ID}/${PROJECT_ID}/upload-1/doc-2/photo.png`,
          file_name: "photo.png",
          mime_type: "image/png",
          size_bytes: 400,
          upload_status: "uploaded",
          classification_status: "classified",
          document_kind: "plans",
        },
      ],
    });

    expect(result).toEqual({
      syncedDocumentCount: 1,
      removedDocumentCount: 0,
    });
    expect(harness.planSets).toEqual([
      expect.objectContaining({
        id: "plan-set-created",
        estimate_version_id: null,
        name: "Plans import",
        metadata: {
          source: "affaire-intake",
          default_import_plan_set: true,
        },
      }),
    ]);
    expect(harness.planFiles).toHaveLength(1);
    expect(harness.planFiles[0]).toEqual(
      expect.objectContaining({
        plan_set_id: "plan-set-created",
        file_name: "plan-a.pdf",
        file_type: "application/pdf",
        file_size_bytes: 1234,
        created_by: USER_ID,
        metadata: expect.objectContaining({
          source: "affaire-intake",
          intake_document_id: "doc-1",
          intake_upload_id: "upload-1",
        }),
      })
    );
    expect(harness.uploadedPaths).toHaveLength(1);
  });

  it("removes stale synced plan files when intake documents are no longer eligible", async () => {
    const harness = createHarness({
      planSets: [
        {
          id: "plan-set-existing",
          estimate_version_id: null,
          name: "Plans import",
          metadata: {
            source: "affaire-intake",
            default_import_plan_set: true,
          },
        },
      ],
      planFiles: [
        {
          id: "plan-file-stale",
          tenant_id: TENANT_ID,
          plan_set_id: "plan-set-existing",
          file_path: `${TENANT_ID}/plan-set-existing/plan-file-stale/old-plan.pdf`,
          file_name: "old-plan.pdf",
          file_type: "application/pdf",
          file_size_bytes: 999,
          page_count: null,
          file_hash: null,
          metadata: {
            source: "affaire-intake",
            intake_document_id: "doc-stale",
            intake_upload_id: "upload-old",
            intake_storage_path: `${TENANT_ID}/${PROJECT_ID}/upload-old/doc-stale/old-plan.pdf`,
          },
          created_by: USER_ID,
        },
      ],
      planStorageFiles: {
        [`${TENANT_ID}/plan-set-existing/plan-file-stale/old-plan.pdf`]: new Blob(["old"]),
      },
    });

    const result = await syncTakeoffPlanSetFromAffaireIntake({
      supabase: harness.supabase,
      project: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
      },
      documents: [
        {
          id: "doc-stale",
          upload_id: "upload-old",
          created_by: USER_ID,
          storage_path: `${TENANT_ID}/${PROJECT_ID}/upload-old/doc-stale/old-plan.pdf`,
          file_name: "old-plan.pdf",
          mime_type: "application/pdf",
          size_bytes: 999,
          upload_status: "uploaded",
          classification_status: "ambiguous",
          document_kind: "plans",
        },
      ],
    });

    expect(result).toEqual({
      syncedDocumentCount: 0,
      removedDocumentCount: 1,
    });
    expect(harness.planFiles).toEqual([]);
    expect(harness.removedPaths).toEqual([
      `${TENANT_ID}/plan-set-existing/plan-file-stale/old-plan.pdf`,
    ]);
  });

  it("does not create an empty import plan set when no eligible PDF plan exists", async () => {
    const harness = createHarness();

    const result = await syncTakeoffPlanSetFromAffaireIntake({
      supabase: harness.supabase,
      project: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
      },
      documents: [
        {
          id: "doc-email",
          upload_id: "upload-2",
          created_by: USER_ID,
          storage_path: `${TENANT_ID}/${PROJECT_ID}/upload-2/doc-email/mail.eml`,
          file_name: "mail.eml",
          mime_type: "message/rfc822",
          size_bytes: 500,
          upload_status: "uploaded",
          classification_status: "classified",
          document_kind: "emails",
        },
      ],
    });

    expect(result).toEqual({
      syncedDocumentCount: 0,
      removedDocumentCount: 0,
    });
    expect(harness.planSets).toEqual([]);
    expect(harness.planFiles).toEqual([]);
  });
});
