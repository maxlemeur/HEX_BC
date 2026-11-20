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
  getTakeoffChunkingConfigForTenant: vi.fn(),
  getTakeoffLevelCProcessingConfigForTenant: vi.fn(),
}));

vi.mock("@/lib/ai/chatgpt-takeoff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/chatgpt-takeoff")>();
  return { ...actual, getTakeoffExecutionOwner: vi.fn() };
});

import { getTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  assertTakeoffEnabled,
  getTakeoffChunkingConfigForTenant,
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
import { createTakeoffJobFromPlanSet } from "@/lib/takeoff/server";

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
  });
  const admin = createSupabaseFake({
    tables: {
      audit_logs: () => {
        effects.push("audit:failure");
        return { data: null, error: { code: "XX000", message: "Audit unavailable" } };
      },
    },
  });
  vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client as never);
  return { fake, admin, effects, files, jobs };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertConfirmedTakeoffPreparation).mockReset().mockResolvedValue(confirmedPreparationFixture());
  vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  vi.mocked(getTakeoffExecutionOwner).mockResolvedValue({ execution_provider: "chatgpt_local", execution_host_id: "urn:uuid:55555555-5555-4555-8555-555555555555" });
  vi.mocked(getTakeoffChunkingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
  vi.mocked(getTakeoffLevelCProcessingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
});

describe("takeoff creation compensation", () => {
  it("rejects an unconfirmed preparation before any plan-set side effect", async () => {
    const { fake, admin, effects } = createFixture();
    vi.mocked(assertConfirmedTakeoffPreparation).mockRejectedValueOnce(new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Confirmez la préparation avant de lancer le métré.",
      retryable: false,
    }));

    const creation = createTakeoffJobFromPlanSet({
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
  });

  it("keeps admission refusal retryable and leaves the shared plan storage untouched", async () => {
    const { fake, admin, effects, files, jobs } = createFixture({ admissionRejected: true });

    await expect(createTakeoffJobFromPlanSet({
      projectId: M3_PROJECT_ID,
      planSetId: M3_PLAN_SET_ID,
      estimateVersionId: M3_VERSION_ID,
    })).rejects.toMatchObject({
      status: 409,
      code: "TAKEOFF_JOB_ADMISSION_LIMIT",
      retryable: true,
    });

    expect(effects).toEqual(["job:insert"]);
    expect(fake.storageCalls).toEqual([]);
    expect(admin.storageCalls).toEqual([]);
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
