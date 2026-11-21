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
  return { ...actual, getConfirmedTakeoffExecutionOwner: vi.fn() };
});

import { getConfirmedTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
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
      takeoff_jobs: () => ({ data: null, error: null }),
    },
    rpc: {
      admit_prepared_takeoff_job: () => {
        effects.push("admission");
        return { data: null, error: options.admissionRejected
          ? { code: "23514", message: "TAKEOFF_JOB_ADMISSION_LIMIT" }
          : { code: "P0001", message: "TAKEOFF_JOB_CREATION_AUDIT_FAILED" } };
      },
    },
  });
  const admin = createSupabaseFake({});
  vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client as never);
  return { fake, admin, effects, files, jobs };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertConfirmedTakeoffPreparation).mockReset().mockResolvedValue(confirmedPreparationFixture());
  vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  vi.mocked(getConfirmedTakeoffExecutionOwner).mockResolvedValue({ execution_provider: "chatgpt_local", execution_host_id: "urn:uuid:55555555-5555-4555-8555-555555555555" });
  vi.mocked(getTakeoffChunkingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
  vi.mocked(getTakeoffLevelCProcessingConfigForTenant).mockResolvedValue({ maxPdfPages: 50 } as never);
});

describe("prepared takeoff admission", () => {
  it("requires an explicit ChatGPT provider on a new launch", async () => {
    const { fake, effects } = createFixture();
    await expect(createTakeoffJobFromPlanSet({
      projectId: M3_PROJECT_ID, planSetId: M3_PLAN_SET_ID, estimateVersionId: M3_VERSION_ID, level: "C",
    })).rejects.toMatchObject({ status: 422, code: TakeoffErrorCode.BAD_REQUEST });
    expect(effects).toEqual([]);
    expect(fake.storageCalls).toEqual([]);
    expect(assertConfirmedTakeoffPreparation).not.toHaveBeenCalled();
  });

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
      level: "C", provider: "chatgpt",
      preparationRevision: 1,
    });
    await expect(creation).rejects.toMatchObject({ status: 409, retryable: false });
    expect(effects).toEqual([]);
    expect(fake.storageCalls).toEqual([]);
    expect(admin.storageCalls).toEqual([]);
    expect(getConfirmedTakeoffExecutionOwner).not.toHaveBeenCalled();
  });

  it("keeps admission refusal retryable and leaves the shared plan storage untouched", async () => {
    const { fake, admin, effects, files, jobs } = createFixture({ admissionRejected: true });

    await expect(createTakeoffJobFromPlanSet({
      projectId: M3_PROJECT_ID,
      planSetId: M3_PLAN_SET_ID,
      estimateVersionId: M3_VERSION_ID,
      level: "C", provider: "chatgpt",
    })).rejects.toMatchObject({
      status: 409,
      code: "TAKEOFF_JOB_ADMISSION_LIMIT",
      retryable: true,
    });

    expect(effects).toEqual(["admission"]);
    expect(fake.storageCalls).toEqual([]);
    expect(admin.storageCalls).toEqual([]);
    expect(files).toEqual(new Set([OTHER_UPLOAD, SHARED_PLAN]));
    expect(jobs).toEqual(new Set([M3_JOB_ID]));
  });

  it("reports audit failure from the atomic admission and preserves all shared plan storage", async () => {
    const { fake, admin, effects, files, jobs } = createFixture();

    await expect(createTakeoffJobFromPlanSet({
      projectId: M3_PROJECT_ID,
      planSetId: M3_PLAN_SET_ID,
      estimateVersionId: M3_VERSION_ID,
      level: "C", provider: "chatgpt",
    })).rejects.toMatchObject({
      message: "Impossible d'enregistrer l'audit takeoff.",
    });

    expect(fake.rpcCalls).toEqual([{
      fn: "admit_prepared_takeoff_job",
      args: expect.objectContaining({ p_job: expect.objectContaining({ tenant_id: M3_TENANT_ID, source_file_path: SHARED_PLAN }) }),
    }]);
    expect(fake.writesTo("takeoff_jobs")).toEqual([]);
    expect(effects).toEqual(["admission"]);
    expect(fake.storageCalls).toEqual([]);
    expect(admin.storageCalls).toEqual([]);
    expect(files).toEqual(new Set([OTHER_UPLOAD, SHARED_PLAN]));
    expect(jobs).toEqual(new Set([M3_JOB_ID]));
  });
});
