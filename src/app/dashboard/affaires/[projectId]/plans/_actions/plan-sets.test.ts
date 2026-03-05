import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/plans", () => ({
  parseCreatePlanSetInput: vi.fn(),
  createPlanSet: vi.fn(),
  deletePlanSet: vi.fn(),
  planSetIdSchema: {
    parse: vi.fn(),
  },
}));

import {
  createPlanSetAction,
  deletePlanSetAction,
} from "@/app/dashboard/affaires/[projectId]/plans/_actions/plan-sets";
import * as plans from "@/lib/takeoff/plans";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const SET_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

function makePlanSetRow(overrides?: {
  project_id?: string;
  estimate_version_id?: string | null;
  name?: string;
  description?: string | null;
}) {
  return {
    id: SET_ID,
    created_at: "2026-03-05T10:00:00.000Z",
    updated_at: "2026-03-05T10:00:00.000Z",
    tenant_id: TENANT_ID,
    project_id: overrides?.project_id ?? PROJECT_ID,
    estimate_version_id: overrides?.estimate_version_id ?? null,
    name: overrides?.name ?? "Plans",
    description: overrides?.description ?? null,
    metadata: {},
    created_by: USER_ID,
  };
}

const parseCreatePlanSetInputMock = vi.mocked(plans.parseCreatePlanSetInput);
const createPlanSetMock = vi.mocked(plans.createPlanSet);
const deletePlanSetMock = vi.mocked(plans.deletePlanSet);
const parsePlanSetIdMock = vi.mocked(plans.planSetIdSchema.parse);

describe("plan-sets server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a plan set in project mode", async () => {
    parseCreatePlanSetInputMock.mockReturnValue({
      project_id: PROJECT_ID,
      name: "Plans projet",
      description: null,
      metadata: {},
    });
    createPlanSetMock.mockResolvedValue({
      plan_set: makePlanSetRow({
        project_id: PROJECT_ID,
        estimate_version_id: null,
        name: "Plans projet",
      }),
    });

    const input = {
      project_id: PROJECT_ID,
      name: "Plans projet",
    };

    const result = await createPlanSetAction(input);

    expect(parseCreatePlanSetInputMock).toHaveBeenCalledWith(input);
    expect(createPlanSetMock).toHaveBeenCalledWith({
      project_id: PROJECT_ID,
      name: "Plans projet",
      description: null,
      metadata: {},
    });
    expect(result).toEqual({
      plan_set: makePlanSetRow({
        project_id: PROJECT_ID,
        estimate_version_id: null,
        name: "Plans projet",
      }),
    });
  });

  it("creates a plan set in legacy estimate_version mode", async () => {
    parseCreatePlanSetInputMock.mockReturnValue({
      estimate_version_id: VERSION_ID,
      name: "Plans V1",
      description: "Scope legacy",
      metadata: {},
    });
    createPlanSetMock.mockResolvedValue({
      plan_set: makePlanSetRow({
        project_id: PROJECT_ID,
        estimate_version_id: VERSION_ID,
        name: "Plans V1",
        description: "Scope legacy",
      }),
    });

    const input = {
      estimate_version_id: VERSION_ID,
      name: "Plans V1",
      description: "Scope legacy",
    };

    const result = await createPlanSetAction(input);

    expect(parseCreatePlanSetInputMock).toHaveBeenCalledWith(input);
    expect(createPlanSetMock).toHaveBeenCalledWith({
      estimate_version_id: VERSION_ID,
      name: "Plans V1",
      description: "Scope legacy",
      metadata: {},
    });
    expect(result).toEqual({
      plan_set: makePlanSetRow({
        project_id: PROJECT_ID,
        estimate_version_id: VERSION_ID,
        name: "Plans V1",
        description: "Scope legacy",
      }),
    });
  });

  it("deletes a plan set with a validated id", async () => {
    parsePlanSetIdMock.mockReturnValue(SET_ID);
    deletePlanSetMock.mockResolvedValue({
      deleted: true,
      plan_set_id: SET_ID,
      cleanup: {
        metadata_deleted: true,
        storage_cleanup_attempted: true,
        storage_deleted_count: 0,
        storage_failed_count: 0,
        errors: [],
      },
    });

    const result = await deletePlanSetAction(SET_ID);

    expect(parsePlanSetIdMock).toHaveBeenCalledWith(SET_ID);
    expect(deletePlanSetMock).toHaveBeenCalledWith(SET_ID);
    expect(result).toEqual({
      deleted: true,
      plan_set_id: SET_ID,
      cleanup: {
        metadata_deleted: true,
        storage_cleanup_attempted: true,
        storage_deleted_count: 0,
        storage_failed_count: 0,
        errors: [],
      },
    });
  });
});
