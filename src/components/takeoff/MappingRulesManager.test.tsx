import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MappingRulesManager } from "@/components/takeoff/MappingRulesManager";
import type {
  CreateTakeoffMappingRuleInput,
  TakeoffMappingRule,
  UpdateTakeoffMappingRuleInput,
} from "@/lib/takeoff/types";
import {
  createTakeoffMappingRule,
  deleteTakeoffMappingRule,
  fetchTakeoffMappingRules,
  updateTakeoffMappingRule,
} from "@/lib/takeoff/client";
import { fetchEstimateAssemblies } from "@/lib/estimates/client";

vi.mock("@/lib/takeoff/client", () => {
  return {
    isTakeoffApiError: () => false,
    fetchTakeoffMappingRules: vi.fn(),
    createTakeoffMappingRule: vi.fn(),
    updateTakeoffMappingRule: vi.fn(),
    deleteTakeoffMappingRule: vi.fn(),
  };
});

vi.mock("@/lib/estimates/client", () => {
  return {
    fetchEstimateAssemblies: vi.fn(),
  };
});

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const RULE_A_ID = "22222222-2222-4222-8222-222222222222";
const RULE_B_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_RULE_ID = "44444444-4444-4444-8444-444444444444";
const ASSEMBLY_ID = "55555555-5555-4555-8555-555555555555";

let rulesState: TakeoffMappingRule[] = [];

function makeRule(
  input: Partial<TakeoffMappingRule> &
    Pick<TakeoffMappingRule, "id" | "name" | "match_pattern" | "action" | "action_params">
): TakeoffMappingRule {
  return {
    id: input.id,
    tenant_id: input.tenant_id ?? TENANT_ID,
    created_at: input.created_at ?? "2026-02-25T12:00:00.000Z",
    updated_at: input.updated_at ?? "2026-02-25T12:00:00.000Z",
    created_by: input.created_by ?? null,
    name: input.name,
    match_pattern: input.match_pattern,
    match_type: input.match_type ?? "contains",
    priority: input.priority ?? 10,
    is_active: input.is_active ?? true,
    action: input.action,
    action_params: input.action_params,
  } as TakeoffMappingRule;
}

function applyUpdate(
  current: TakeoffMappingRule,
  patch: UpdateTakeoffMappingRuleInput
): TakeoffMappingRule {
  if ("action" in patch) {
    return {
      ...current,
      ...patch,
      updated_at: "2026-02-25T12:30:00.000Z",
    } as TakeoffMappingRule;
  }

  return {
    ...current,
    ...patch,
    updated_at: "2026-02-25T12:30:00.000Z",
  };
}

function createRuleFromInput(input: CreateTakeoffMappingRuleInput): TakeoffMappingRule {
  return {
    id: CREATED_RULE_ID,
    tenant_id: TENANT_ID,
    created_at: "2026-02-25T12:15:00.000Z",
    updated_at: "2026-02-25T12:15:00.000Z",
    created_by: null,
    name: input.name,
    match_pattern: input.match_pattern,
    match_type: input.match_type,
    priority: input.priority ?? 100,
    is_active: input.is_active ?? true,
    action: input.action,
    action_params: input.action_params,
  } as TakeoffMappingRule;
}

function renderManager() {
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        focusThrottleInterval: 0,
      }}
    >
      <MappingRulesManager />
    </SWRConfig>
  );
}

describe("MappingRulesManager", () => {
  beforeEach(() => {
    rulesState = [
      makeRule({
        id: RULE_A_ID,
        name: "Renommer PVC",
        match_pattern: "pvc",
        priority: 10,
        action: "rename",
        action_params: {
          designation: "Tube PVC pression",
        },
      }),
      makeRule({
        id: RULE_B_ID,
        name: "Ignorer lot test",
        match_pattern: "lot test",
        priority: 20,
        action: "skip",
        action_params: {},
      }),
    ];

    vi.mocked(fetchTakeoffMappingRules).mockImplementation(
      async () => [...rulesState]
    );
    vi.mocked(fetchEstimateAssemblies).mockResolvedValue([
      {
        id: ASSEMBLY_ID,
        name: "Cloison BA13",
        description: null,
        createdBy: null,
        createdAt: "2026-02-25T12:00:00.000Z",
        updatedAt: "2026-02-25T12:00:00.000Z",
        itemCount: 3,
      },
    ]);
    vi.mocked(createTakeoffMappingRule).mockImplementation(async (input) => {
      const created = createRuleFromInput(input as CreateTakeoffMappingRuleInput);
      rulesState = [...rulesState, created];
      return created;
    });
    vi.mocked(updateTakeoffMappingRule).mockImplementation(async (ruleId, patch) => {
      const existing = rulesState.find((rule) => rule.id === ruleId);
      if (!existing) {
        throw new Error("Rule not found");
      }

      const updated = applyUpdate(existing, patch as UpdateTakeoffMappingRuleInput);
      rulesState = rulesState.map((rule) => (rule.id === ruleId ? updated : rule));
      return updated;
    });
    vi.mocked(deleteTakeoffMappingRule).mockImplementation(async (ruleId) => {
      rulesState = rulesState.filter((rule) => rule.id !== ruleId);
      return {
        deleted: true,
        rule_id: ruleId,
      };
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("creates and deletes a mapping rule", async () => {
    const user = userEvent.setup();
    renderManager();

    expect(await screen.findByText("Renommer PVC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Nouvelle regle" }));
    await user.type(screen.getByLabelText("Nom de la règle"), "Ouvrage auto");
    await user.type(screen.getByLabelText("Pattern de correspondance"), "cloison");
    await user.selectOptions(screen.getByLabelText("Action"), "skip");
    await user.click(screen.getByRole("button", { name: "Créer la règle" }));

    await waitFor(() => {
      expect(createTakeoffMappingRule).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Ouvrage auto")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Supprimer Ouvrage auto" })
    );
    await user.click(screen.getByRole("button", { name: "Supprimer la regle" }));

    await waitFor(() => {
      expect(deleteTakeoffMappingRule).toHaveBeenCalledWith(CREATED_RULE_ID);
    });
  });

  it("persists reordered priorities", async () => {
    const user = userEvent.setup();
    renderManager();

    const priorityInput = await screen.findByLabelText("Priorite de Renommer PVC");
    await user.clear(priorityInput);
    await user.type(priorityInput, "35");
    await user.click(screen.getByRole("button", { name: "Enregistrer l'ordre" }));

    await waitFor(() => {
      expect(updateTakeoffMappingRule).toHaveBeenCalled();
    });

    expect(
      vi
        .mocked(updateTakeoffMappingRule)
        .mock.calls.some(
          (call) => call[0] === RULE_A_ID && (call[1] as { priority?: number }).priority === 35
        )
    ).toBe(true);
    expect(await screen.findByText("Ordre des priorites enregistre.")).toBeInTheDocument();
  });

  it("keeps unsaved priority drafts when list revalidates", async () => {
    const user = userEvent.setup();
    renderManager();

    const priorityInput = (await screen.findByLabelText(
      "Priorite de Renommer PVC"
    )) as HTMLInputElement;
    await user.clear(priorityInput);
    await user.type(priorityInput, "77");
    expect(priorityInput.value).toBe("77");

    await user.click(screen.getByRole("button", { name: "Actualiser" }));

    await waitFor(() => {
      expect(vi.mocked(fetchTakeoffMappingRules)).toHaveBeenCalledTimes(2);
    });
    expect(priorityInput.value).toBe("77");
  });

  it("does not rollback applied priorities when refresh fails after successful writes", async () => {
    const user = userEvent.setup();
    let fetchCallCount = 0;
    vi.mocked(fetchTakeoffMappingRules).mockImplementation(async () => {
      fetchCallCount += 1;
      if (fetchCallCount >= 2) {
        throw new Error("Refresh failed");
      }
      return [...rulesState];
    });

    renderManager();

    const priorityInput = await screen.findByLabelText("Priorite de Renommer PVC");
    await user.clear(priorityInput);
    await user.type(priorityInput, "35");
    await user.click(screen.getByRole("button", { name: "Enregistrer l'ordre" }));

    await waitFor(() => {
      expect(
        vi
          .mocked(updateTakeoffMappingRule)
          .mock.calls.some(
            (call) => call[0] === RULE_A_ID && (call[1] as { priority?: number }).priority === 35
          )
      ).toBe(true);
    });

    const ruleAPriorityCalls = vi
      .mocked(updateTakeoffMappingRule)
      .mock.calls.filter(
        (call) => call[0] === RULE_A_ID && typeof (call[1] as { priority?: number }).priority === "number"
      )
      .map((call) => (call[1] as { priority?: number }).priority);

    expect(ruleAPriorityCalls).toEqual([35]);
    expect(
      await screen.findByText(/Ordre des priorites enregistre/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Impossible de sauvegarder l'ordre des priorites.")
    ).not.toBeInTheDocument();
  });
});
