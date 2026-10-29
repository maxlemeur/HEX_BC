import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/takeoff/preparation-server", () => ({
  assertConfirmedTakeoffPreparation: vi.fn(),
}));

import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffGeminiDeliveryConfigForTenant: vi.fn(),
  getTakeoffChunkingConfigForTenant: vi.fn(),
  getTakeoffLevelCProcessingConfigForTenant: vi.fn(),
}));

vi.mock("@/lib/ai/chatgpt-takeoff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/chatgpt-takeoff")>();
  return { ...actual, getTakeoffExecutionOwner: vi.fn() };
});

vi.mock("@/lib/estimates/source-reference-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/estimates/source-reference-pdf")>();
  return { ...actual, inspectSourceReferencePdf: vi.fn() };
});

import { getTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { inspectSourceReferencePdf, SourceReferencePdfError } from "@/lib/estimates/source-reference-pdf";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  assertTakeoffEnabled,
  getTakeoffChunkingConfigForTenant,
  getTakeoffGeminiDeliveryConfigForTenant,
  getTakeoffLevelCProcessingConfigForTenant,
} from "@/lib/takeoff/feature-flags";
import {
  authenticatedContext,
  createSupabaseFake,
  estimateVersionRow,
  filterValue,
  M3_ITEM_ID,
  M3_JOB_ID,
  M3_PLAN_SET_ID,
  M3_PROJECT_ID,
  M3_TENANT_ID,
  M3_VERSION_ID,
} from "@/lib/takeoff/metre-m3.test-utils";
import {
  createTakeoffJobFromFormData,
  createTakeoffJobFromPlanSet,
} from "@/lib/takeoff/server";

const OTHER_UPLOAD = `${M3_TENANT_ID}/${M3_JOB_ID}/existing-upload.csv`;
const SHARED_PLAN = `${M3_TENANT_ID}/${M3_PLAN_SET_ID}/shared-plan.pdf`;

function createFixture(options: { admissionRejected?: boolean } = {}) {
  const effects: string[] = [];
  const files = new Set([OTHER_UPLOAD, SHARED_PLAN]);
  const jobs = new Set([M3_JOB_ID]);
  const fake = createSupabaseFake({
    tables: {
      estimate_versions: () => ({ data: estimateVersionRow({}), error: null }),
      plan_sets: () => ({ data: { id: M3_PLAN_SET_ID }, error: null }),
      plan_files: () => ({
        data: [{
          id: M3_ITEM_ID,
          file_path: SHARED_PLAN,
          file_name: "Plan plomberie.pdf",
          file_type: "application/pdf",
          file_size_bytes: 2048,
          page_count: 1,
          metadata: {},
        }],
        error: null,
        count: 1,
      }),
      takeoff_jobs: (query) => {
        if (query.operation === "select") return { data: null, error: null };
        effects.push(`job:${query.operation}`);
        if (query.operation === "insert") {
          if (options.admissionRejected) {
            return {
              data: null,
              error: { code: "23514", message: "TAKEOFF_JOB_ADMISSION_LIMIT" },
            };
          }
          const row = query.payload as Record<string, unknown>;
          jobs.add(String(row.id));
          return {
            data: { ...row, created_at: "2026-10-28T00:00:00.000Z" },
            error: null,
          };
        }
        if (query.operation === "delete") {
          jobs.delete(String(filterValue(query, "id")));
          return { data: null, error: null };
        }
        throw new Error(`Unexpected takeoff job operation: ${query.operation}`);
      },
    },
    storage: {
      "takeoff-files": (call) => {
        if (call.method !== "upload") throw new Error("Authenticated cleanup is forbidden");
        effects.push("storage:upload");
        files.add(call.paths[0]);
        return { data: { path: call.paths[0] }, error: null };
      },
    },
  });
  const admin = createSupabaseFake({
    tables: {
      audit_logs: () => {
        effects.push("audit:failure");
        return { data: null, error: { code: "XX000", message: "Audit unavailable" } };
      },
    },
    storage: {
      "takeoff-files": (call) => {
        if (call.method !== "remove") throw new Error("Unexpected privileged storage operation");
        effects.push("storage:remove");
        for (const path of call.paths) files.delete(path);
        return { data: null, error: null };
      },
    },
  });
  vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client as never);
  return { fake, admin, effects, files, jobs };
}

function uploadForm() {
  const formData = new FormData();
  formData.set("file", new File(["designation;quantity;unit\nTube cuivre;12;ml"], "metre.csv", {
    type: "text/csv",
  }));
  formData.set("estimate_version_id", M3_VERSION_ID);
  formData.set("level", "A");
  formData.set("preparation_revision", "1");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertConfirmedTakeoffPreparation).mockReset().mockResolvedValue(confirmedPreparationFixture());
  vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  vi.mocked(getTakeoffExecutionOwner).mockResolvedValue({});
  vi.mocked(getTakeoffGeminiDeliveryConfigForTenant).mockResolvedValue({ useBatchApi: false } as never);
  vi.mocked(getTakeoffChunkingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
  vi.mocked(getTakeoffLevelCProcessingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
});

describe("takeoff creation compensation", () => {
  it.each(["upload", "plan_set"])("rejects an unconfirmed preparation before any %s side effect", async (entry) => {
    const { fake, admin, effects } = createFixture();
    vi.mocked(assertConfirmedTakeoffPreparation).mockRejectedValueOnce(new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Confirmez la préparation avant de lancer le métré.",
      retryable: false,
    }));

    const creation = entry === "upload"
      ? createTakeoffJobFromFormData(uploadForm())
      : createTakeoffJobFromPlanSet({
          projectId: M3_PROJECT_ID,
          planSetId: M3_PLAN_SET_ID,
          estimateVersionId: M3_VERSION_ID,
          preparationRevision: 1,
        });
    await expect(creation).rejects.toMatchObject({ status: 409, retryable: false });
    expect(effects).toEqual([]);
    expect(fake.storageCalls).toEqual([]);
    expect(admin.storageCalls).toEqual([]);
    expect(getTakeoffExecutionOwner).not.toHaveBeenCalled();
    expect(inspectSourceReferencePdf).not.toHaveBeenCalled();
  });

  it("preserves an inspection timeout as retryable without uploading or retrying", async () => {
    const { fake, admin, effects } = createFixture();
    vi.mocked(inspectSourceReferencePdf).mockRejectedValueOnce(new SourceReferencePdfError("PDF_TIMEOUT", true));
    const form = uploadForm();
    form.set("level", "B");
    form.set("file", new File(["%PDF-1.7"], "plan.pdf", { type: "application/pdf" }));

    await expect(createTakeoffJobFromFormData(form)).rejects.toMatchObject({
      status: 503,
      code: "TAKEOFF_PDF_INSPECTION_TIMEOUT",
      retryable: true,
    });

    expect(inspectSourceReferencePdf).toHaveBeenCalledTimes(1);
    expect(effects).toEqual([]);
    expect(fake.storageCalls).toEqual([]);
    expect(admin.storageCalls).toEqual([]);
    expect(getTakeoffExecutionOwner).not.toHaveBeenCalled();
  });

  it("keeps unknown creation errors non-retryable without starting an upload", async () => {
    const { fake, admin, effects } = createFixture();
    vi.mocked(getTakeoffExecutionOwner).mockRejectedValueOnce(new Error("Unknown owner failure"));

    await expect(createTakeoffJobFromFormData(uploadForm())).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      retryable: false,
    });

    expect(getTakeoffExecutionOwner).toHaveBeenCalledTimes(1);
    expect(effects).toEqual([]);
    expect(fake.storageCalls).toEqual([]);
    expect(admin.storageCalls).toEqual([]);
  });

  it("removes only its uploaded source, then its job, when the creation audit fails", async () => {
    const { fake, admin, effects, files, jobs } = createFixture();

    await expect(createTakeoffJobFromFormData(uploadForm())).rejects.toMatchObject({
      message: "Impossible d'enregistrer l'audit takeoff.",
    });

    const inserted = fake.writesTo("takeoff_jobs")[0].payload as Record<string, unknown>;
    const uploadedPath = fake.storageCalls[0].paths[0];
    expect(inserted.preparation_snapshot).toEqual(confirmedPreparationFixture());
    expect(inserted.source_file_path).toBe(uploadedPath);
    expect(admin.storageCalls).toEqual([{
      bucket: "takeoff-files",
      method: "remove",
      paths: [uploadedPath],
    }]);
    expect(fake.writesTo("takeoff_jobs")[1]).toMatchObject({
      operation: "delete",
      filters: [
        { kind: "eq", column: "tenant_id", value: M3_TENANT_ID },
        { kind: "eq", column: "id", value: inserted.id },
      ],
    });
    expect(effects).toEqual([
      "storage:upload", "job:insert", "audit:failure", "storage:remove", "job:delete",
    ]);
    expect(files).toEqual(new Set([OTHER_UPLOAD, SHARED_PLAN]));
    expect(jobs).toEqual(new Set([M3_JOB_ID]));
  });

  it("keeps admission refusal retryable and removes only the unclaimed upload", async () => {
    const { fake, admin, effects, files, jobs } = createFixture({ admissionRejected: true });

    await expect(createTakeoffJobFromFormData(uploadForm())).rejects.toMatchObject({
      status: 409,
      code: "TAKEOFF_JOB_ADMISSION_LIMIT",
      retryable: true,
    });

    expect(admin.storageCalls).toEqual([{
      bucket: "takeoff-files",
      method: "remove",
      paths: [fake.storageCalls[0].paths[0]],
    }]);
    expect(effects).toEqual(["storage:upload", "job:insert", "storage:remove"]);
    expect(files).toEqual(new Set([OTHER_UPLOAD, SHARED_PLAN]));
    expect(jobs).toEqual(new Set([M3_JOB_ID]));
  });

  it("removes its plan-set job on audit failure and preserves all shared plan storage", async () => {
    const { fake, admin, effects, files, jobs } = createFixture();

    await expect(createTakeoffJobFromPlanSet({
      projectId: M3_PROJECT_ID,
      planSetId: M3_PLAN_SET_ID,
      estimateVersionId: M3_VERSION_ID,
    })).rejects.toMatchObject({
      message: "Impossible d'enregistrer l'audit takeoff.",
    });

    const inserted = fake.writesTo("takeoff_jobs")[0].payload as Record<string, unknown>;
    expect(inserted.source_file_path).toBe(SHARED_PLAN);
    expect(fake.writesTo("takeoff_jobs")[1]).toMatchObject({
      operation: "delete",
      filters: [
        { kind: "eq", column: "tenant_id", value: M3_TENANT_ID },
        { kind: "eq", column: "id", value: inserted.id },
      ],
    });
    expect(effects).toEqual(["job:insert", "audit:failure", "job:delete"]);
    expect(fake.storageCalls).toEqual([]);
    expect(admin.storageCalls).toEqual([]);
    expect(files).toEqual(new Set([OTHER_UPLOAD, SHARED_PLAN]));
    expect(jobs).toEqual(new Set([M3_JOB_ID]));
  });
});
