import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/estimates/server", () => ({
  createEstimate: vi.fn(),
}));

import { initializeAffaireDraft } from "@/app/dashboard/affaires/_actions/quick-create-affaire";
import { createEstimate } from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const IMPORT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_PROJECT_ID = "77777777-7777-4777-8777-777777777777";
const CREATED_VERSION_ID = "88888888-8888-4888-8888-888888888888";

function createMembershipBuilder(role: "engineer" | "admin" | "viewer") {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue({
    data: [{ tenant_id: TENANT_ID, role }],
    error: null,
  });

  return builder;
}

function createImportSelectBuilder(projectId: string | null) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({
      data: {
        id: IMPORT_ID,
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        project_id: projectId,
        filename: "dpgf.xlsx",
    },
    error: null,
  });

  return builder;
}

/**
 * Sous-lot 2.10b (D-i) : depuis la bascule (M8), une politique absente vaut le moteur 3 ; ces cas v2 tournent sous
 * une ligne de politique 2 explicite, le retrait par entreprise.
 */
const EXPLICIT_POLICY_TWO = {
  tenant_id: TENANT_ID,
  new_estimate_calc_engine: 2,
  default_sale_coefficient_fo: null,
  default_sale_coefficient_mo: null,
  allowed_tax_rates_bp: [2000, 1000, 550, 210],
};

function createExplicitPolicyTwoBuilder() {
  const builder = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: EXPLICIT_POLICY_TWO, error: null }) };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

function createSupabaseStub(input: {
  role: "engineer" | "admin" | "viewer";
  importProjectId?: string | null;
  createdProjectId?: string;
  rpcResult?: { data: unknown; error: unknown };
}) {
  const membershipBuilder = createMembershipBuilder(input.role);
  const importBuilder =
    input.importProjectId !== undefined
      ? createImportSelectBuilder(input.importProjectId)
      : null;
  const tableQueues: Record<string, unknown[]> = {
    tenant_memberships: [membershipBuilder],
    dpgf_imports: importBuilder ? [importBuilder] : [],
  };

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      // Sous-lot 2.10a : politique de calcul relue par chaque action de création ; politique 2 explicite (2.10b).
      if (table === "tenant_calc_policies") return createExplicitPolicyTwoBuilder();
      const queue = tableQueues[table] ?? [];
      const builder = queue.shift();
      if (!builder) {
        throw new Error(`Unexpected table access: ${table}`);
      }
      return builder;
    }),
    rpc: vi.fn().mockResolvedValue(
      input.rpcResult ?? {
        data: [],
        error: null,
      }
    ),
  };

  return {
    supabase,
  };
}

describe("initializeAffaireDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createEstimate).mockResolvedValue({
      project: { id: CREATED_PROJECT_ID },
      version: { id: CREATED_VERSION_ID },
    } as never);
  });
  it("rejects import already linked to another project", async () => {
    const { supabase } = createSupabaseStub({
      role: "engineer",
      importProjectId: OTHER_PROJECT_ID,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      initializeAffaireDraft({
        projectName: "Affaire conflict",
        linkImportId: IMPORT_ID,
      })
    ).rejects.toThrow("Cet import est déjà lié a une autre affaire.");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects viewer role", async () => {
    const { supabase } = createSupabaseStub({
      role: "viewer",
      createdProjectId: CREATED_PROJECT_ID,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      initializeAffaireDraft({
        projectName: "Affaire viewer",
      })
    ).rejects.toThrow("Accès refuse: rôle non autorise pour cette action.");
  });
});
