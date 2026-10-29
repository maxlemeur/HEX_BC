import { beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP pagination contract is exercised with the real SDK in read-all.test.ts.
// These retained domain tests supply complete query results at the reader boundary.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));


vi.mock("@/lib/takeoff/feature-flags", () => ({
  isTakeoffEnabled: vi.fn(),
}));

import { DriveError } from "@/lib/affaires/google-drive/errors";
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
              data: planSets.map((set) => ({ ...set, updated_at: "2026-10-28T12:00:00Z", plan_files: [{ count: planFiles.filter((file) => file.plan_set_id === set.id).length }] })),
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
        select: vi.fn(() => {
          let column = "";
          let value = "";
          const data = () => planFiles.filter((row) => column === "id" ? row.id === value : row.plan_set_id === value);
          const builder = {
            eq: vi.fn((nextColumn: string, nextValue: string) => { column = nextColumn; value = nextValue; return builder; }),
            maybeSingle: vi.fn(async () => ({ data: data()[0] ?? null, error: null })),
            then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => Promise.resolve({ data: data(), error: null }).then(resolve, reject),
          };
          return builder;
        }),
        insert: vi.fn(async (values: Record<string, unknown>) => {
          if (planFiles.some((row) => row.id === values.id)) return { error: { code: "23505" } };
          planFiles.push(values as unknown as PlanFileRow);
          return { error: null };
        }),
        delete: vi.fn(() => ({
          eq: vi.fn((_column: string, id: string) => ({ contains: vi.fn(async () => {
            const index = planFiles.findIndex((row) => row.id === id);
            if (index >= 0) planFiles.splice(index, 1);
            return { error: null };
          }) })),
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
        download: vi.fn(async (path: string) => ({ data: planStorageFiles.get(path) ?? null, error: planStorageFiles.has(path) ? null : { statusCode: "404" } })),
        info: vi.fn(async (path: string) => ({ data: planStorageFiles.has(path) ? { size: planStorageFiles.get(path)!.size } : null, error: planStorageFiles.has(path) ? null : { statusCode: "404" } })),
        upload: vi.fn(async (path: string, blob: Blob) => {
          if (planStorageFiles.has(path)) return { error: { statusCode: "409" } };
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
      rpc: vi.fn(async (_name: string, { p_file_id }: { p_file_id: string }) => {
        const index = planFiles.findIndex((row) => row.id === p_file_id);
        if (index < 0) return { data: null, error: null };
        planFiles[index].metadata.intake_cleanup_pending = true;
        return { data: planFiles[index].file_path, error: null };
      }),
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

  it("deduplicates concurrent producers and recovers a reserved copy with missing bytes", async () => {
    const sourcePath = `${TENANT_ID}/${PROJECT_ID}/upload-1/doc-1/plan.pdf`;
    const harness = createHarness({
      planSets: [{ id: "plan-set-existing", estimate_version_id: null, name: "Plans import", metadata: { source: "import-flow", default_import_plan_set: true } }],
      intakeFiles: { [sourcePath]: new Blob(["pdf-a"]) },
    });
    const document = { id: "doc-1", upload_id: "upload-1", created_by: USER_ID, storage_path: sourcePath,
      file_name: "plan.pdf", mime_type: "application/pdf", size_bytes: 5, upload_status: "uploaded", classification_status: "classified", document_kind: "plans" };
    const input = { supabase: harness.supabase, project: { id: PROJECT_ID, tenant_id: TENANT_ID }, documents: [document] };
    await Promise.all([syncTakeoffPlanSetFromAffaireIntake(input), syncTakeoffPlanSetFromAffaireIntake(input)]);
    expect(harness.planFiles).toHaveLength(1);
    expect(harness.uploadedPaths).toHaveLength(1);
    const filePath = harness.planFiles[0].file_path;
    harness.planStorageFiles.delete(filePath);
    await syncTakeoffPlanSetFromAffaireIntake(input);
    expect(harness.planFiles).toHaveLength(1);
    expect(await harness.planStorageFiles.get(filePath)?.text()).toBe("pdf-a");
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
          size_bytes: 5,
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
        file_size_bytes: 5,
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

  describe("plans linked from Google Drive (Google simulated)", () => {
    const drivePlan = (overrides: Record<string, unknown> = {}) => ({ id: "doc-drive", tenant_id: TENANT_ID, upload_id: "upload-drive",
      created_by: USER_ID, storage_path: null, file_name: "plan-drive.pdf", mime_type: "application/pdf", size_bytes: 5,
      upload_status: "uploaded", classification_status: "classified", document_kind: "plans", plan_copy_generation: "generation-1",
      source_provider: "google_drive", drive_connection_id: "connection-1", drive_file_id: "drive_plan", ...overrides });
    const storedPlan = { id: "doc-stored", upload_id: "upload-drive", created_by: USER_ID, storage_path: `${TENANT_ID}/${PROJECT_ID}/upload-drive/doc-stored/plan.pdf`,
      file_name: "plan.pdf", mime_type: "application/pdf", size_bytes: 5, upload_status: "uploaded", classification_status: "classified", document_kind: "plans" };

    it("keeps one métré working copy of a Drive plan, read with the account that linked it", async () => {
      const harness = createHarness();
      // Drive now holds a longer revision than the size recorded at link time: the copy records what it read.
      const readDriveDocument = vi.fn(async () => ({ bytes: new TextEncoder().encode("pdf-drive") }));
      const input = { supabase: harness.supabase, project: { id: PROJECT_ID, tenant_id: TENANT_ID }, documents: [drivePlan()], readDriveDocument };
      expect(await syncTakeoffPlanSetFromAffaireIntake(input)).toEqual({ syncedDocumentCount: 1, removedDocumentCount: 0 });
      expect(readDriveDocument).toHaveBeenCalledWith({ tenant_id: TENANT_ID, mime_type: "application/pdf", drive_connection_id: "connection-1", drive_file_id: "drive_plan" });
      expect(harness.planFiles).toEqual([expect.objectContaining({ file_name: "plan-drive.pdf", file_size_bytes: 9, metadata: expect.objectContaining({
        source: "affaire-intake", intake_document_id: "doc-drive", intake_storage_path: null, intake_drive_file_id: "drive_plan", intake_generation: "generation-1" }) })]);
      expect(await harness.planStorageFiles.get(harness.planFiles[0].file_path)?.text()).toBe("pdf-drive");
      // Back later: the complete copy is kept, without reading Drive again.
      expect(await syncTakeoffPlanSetFromAffaireIntake(input)).toEqual({ syncedDocumentCount: 0, removedDocumentCount: 0 });
      expect(readDriveDocument).toHaveBeenCalledTimes(1);
      expect(harness.planFiles).toHaveLength(1);
    });

    it("leaves a Drive plan without a copy while its account cannot read it, and still copies the other plans", async () => {
      const harness = createHarness({ intakeFiles: { [storedPlan.storage_path]: new Blob(["pdf-a"]) } });
      const readDriveDocument = vi.fn(async () => { throw new DriveError(409, "DRIVE_AUTH_EXPIRED", "L'accès Google du compte qui a lié ce fichier a expiré."); });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const result = await syncTakeoffPlanSetFromAffaireIntake({ supabase: harness.supabase, project: { id: PROJECT_ID, tenant_id: TENANT_ID },
        documents: [drivePlan(), storedPlan], readDriveDocument });
      expect(result).toEqual({ syncedDocumentCount: 1, removedDocumentCount: 0 });
      expect(harness.planFiles.map((file) => file.metadata.intake_document_id)).toEqual(["doc-stored"]);
      expect(warn).toHaveBeenCalledWith("Drive plan working copy skipped", { documentId: "doc-drive", reason: expect.stringContaining("DRIVE_AUTH_EXPIRED") });
      warn.mockRestore();
    });

    it("reports a Drive read that fails for another reason than Google", async () => {
      const harness = createHarness();
      const readDriveDocument = vi.fn(async () => { throw new Error("socket closed"); });
      await expect(syncTakeoffPlanSetFromAffaireIntake({ supabase: harness.supabase, project: { id: PROJECT_ID, tenant_id: TENANT_ID },
        documents: [drivePlan()], readDriveDocument })).rejects.toThrow("Intake plan sync failed for 1 document(s): doc-drive");
      expect(harness.planFiles).toEqual([]);
    });

    it("retires the working copy once the Drive piece is no longer a plan", async () => {
      const harness = createHarness();
      const readDriveDocument = vi.fn(async () => ({ bytes: new TextEncoder().encode("pdf-drive") }));
      const project = { id: PROJECT_ID, tenant_id: TENANT_ID };
      await syncTakeoffPlanSetFromAffaireIntake({ supabase: harness.supabase, project, documents: [drivePlan()], readDriveDocument });
      const [copy] = harness.planFiles;
      const result = await syncTakeoffPlanSetFromAffaireIntake({ supabase: harness.supabase, project,
        documents: [drivePlan({ document_kind: "cctp", plan_copy_generation: "generation-2" })], readDriveDocument });
      expect(result).toEqual({ syncedDocumentCount: 0, removedDocumentCount: 1 });
      expect(harness.planFiles).toEqual([]);
      expect(harness.removedPaths).toEqual([copy.file_path]);
    });

    it("lets the first of two syncs reading different Drive revisions complete the copy", async () => {
      const harness = createHarness({ planSets: [{ id: "plan-set-existing", estimate_version_id: null, name: "Plans import",
        metadata: { source: "import-flow", default_import_plan_set: true } }] });
      const project = { id: PROJECT_ID, tenant_id: TENANT_ID };
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await Promise.all([
        syncTakeoffPlanSetFromAffaireIntake({ supabase: harness.supabase, project, documents: [drivePlan()],
          readDriveDocument: async () => ({ bytes: new TextEncoder().encode("pdf-drive") }) }),
        syncTakeoffPlanSetFromAffaireIntake({ supabase: harness.supabase, project, documents: [drivePlan()],
          readDriveDocument: async () => ({ bytes: new TextEncoder().encode("pdf-drive-v2") }) }),
      ]);
      // The later reader never uploads bytes of another size under the first one's reservation.
      expect(harness.planFiles).toEqual([expect.objectContaining({ file_size_bytes: 9 })]);
      expect(harness.uploadedPaths).toHaveLength(1);
      expect(await harness.planStorageFiles.get(harness.planFiles[0].file_path)?.text()).toBe("pdf-drive");
      expect(warn).toHaveBeenCalledWith("Drive plan working copy skipped", { documentId: "doc-drive", reason: expect.stringContaining("another Drive revision") });
      warn.mockRestore();
    });

    it("renews the caller's lease before each Drive read, and stops when it is lost", async () => {
      const project = { id: PROJECT_ID, tenant_id: TENANT_ID };
      const order: string[] = [];
      const renewed = createHarness();
      await syncTakeoffPlanSetFromAffaireIntake({ supabase: renewed.supabase, project, documents: [drivePlan()],
        beforeDriveRead: async () => { order.push("renew"); },
        readDriveDocument: async () => { order.push("read"); return { bytes: new TextEncoder().encode("pdf-drive") }; } });
      expect(order).toEqual(["renew", "read"]);
      const lost = new Error("lease lost");
      const harness = createHarness();
      const readDriveDocument = vi.fn(async () => ({ bytes: new TextEncoder().encode("pdf-drive") }));
      await expect(syncTakeoffPlanSetFromAffaireIntake({ supabase: harness.supabase, project, documents: [drivePlan()],
        beforeDriveRead: async () => { throw lost; }, readDriveDocument })).rejects.toBe(lost);
      expect(readDriveDocument).not.toHaveBeenCalled();
      expect(harness.planFiles).toEqual([]);
    });

    it("refuses to complete a Drive reservation with bytes of another size", async () => {
      const harness = createHarness();
      const project = { id: PROJECT_ID, tenant_id: TENANT_ID };
      await syncTakeoffPlanSetFromAffaireIntake({ supabase: harness.supabase, project, documents: [drivePlan()],
        readDriveDocument: async () => ({ bytes: new TextEncoder().encode("pdf-drive") }) });
      harness.planStorageFiles.delete(harness.planFiles[0].file_path);
      await expect(syncTakeoffPlanSetFromAffaireIntake({ supabase: harness.supabase, project, documents: [drivePlan()],
        readDriveDocument: async () => ({ bytes: new TextEncoder().encode("pdf-drive-v2") }) }))
        .rejects.toThrow("Une copie de plan est incomplète. Retirez le lien Google Drive du dossier puis liez de nouveau le fichier.");
      expect(harness.uploadedPaths).toHaveLength(1);
    });
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
