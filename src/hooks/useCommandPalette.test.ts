import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
const mockRecordCockpitCommandAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => "/dashboard/affaires/project-1",
}));

vi.mock("@/components/UserContext", () => ({
  useUserContext: () => ({
    profile: {
      tenant_role: "admin",
    },
  }),
}));

vi.mock("@/hooks/useUiMode", () => ({
  useUiMode: () => ({
    isExpert: true,
  }),
}));

vi.mock("@/hooks/useTakeoffEnabled", () => ({
  useTakeoffEnabled: () => ({
    status: "ready",
    enabled: true,
  }),
}));

vi.mock("@/hooks/useLastAffaireContext", () => ({
  useLastAffaireId: () => "11111111-1111-1111-1111-111111111111",
}));

vi.mock("@/app/dashboard/affaires/_actions/cockpit", () => ({
  recordCockpitCommandAction: (...args: unknown[]) =>
    mockRecordCockpitCommandAction(...args),
}));

import {
  buildNavigationItems,
  fuzzyMatch,
  type CommandItem,
  useCommandPalette,
} from "@/hooks/useCommandPalette";
import {
  _resetForTest as resetCockpitSuggestionsStore,
  setCockpitSuggestions,
} from "@/lib/stores/cockpit-suggestions-store";

function makeItem(overrides: Partial<CommandItem> = {}): CommandItem {
  return {
    id: "test",
    group: "navigation",
    label: "Bons de commande",
    keywords: ["order", "commande"],
    ...overrides,
  };
}

describe("fuzzyMatch", () => {
  it("matches a single term in the label", () => {
    expect(fuzzyMatch("bon", makeItem())).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(fuzzyMatch("BONS", makeItem())).toBe(true);
  });

  it("matches against keywords", () => {
    expect(fuzzyMatch("order", makeItem())).toBe(true);
  });

  it("matches multiple terms (all must match)", () => {
    expect(fuzzyMatch("bon commande", makeItem())).toBe(true);
  });

  it("rejects when one term does not match", () => {
    expect(fuzzyMatch("bon facture", makeItem())).toBe(false);
  });

  it("returns true for an empty query", () => {
    expect(fuzzyMatch("", makeItem())).toBe(true);
  });

  it("returns true for whitespace-only query", () => {
    expect(fuzzyMatch("   ", makeItem())).toBe(true);
  });

  it("matches against description", () => {
    const item = makeItem({ description: "Gérer les commandes" });
    expect(fuzzyMatch("gérer", item)).toBe(true);
  });

  it("does not match irrelevant text", () => {
    expect(fuzzyMatch("administration", makeItem())).toBe(false);
  });
});

describe("buildNavigationItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCockpitSuggestionsStore();
    window.localStorage.clear();
  });

  function hrefs(items: CommandItem[]) {
    return items.map((item) => item.href);
  }

  it("matches simplified engineer sidebar destinations", () => {
    const items = buildNavigationItems({
      role: "engineer",
      uiMode: "simplified",
      featureFlags: { takeoffEnabled: false },
    });
    const navigationHrefs = hrefs(items);

    expect(navigationHrefs).toContain("/dashboard/affaires");
    expect(navigationHrefs).toContain("/dashboard/orders");
    expect(navigationHrefs).toContain("/dashboard/profile");
    expect(navigationHrefs).not.toContain("/dashboard/imports");
    expect(navigationHrefs).not.toContain("/dashboard/mappings");
    expect(navigationHrefs).not.toContain("/dashboard/admin");
  });

  it("includes expert/admin-only destinations when allowed", () => {
    const items = buildNavigationItems({
      role: "admin",
      uiMode: "expert",
      featureFlags: { takeoffEnabled: true },
    });
    const navigationHrefs = hrefs(items);

    expect(navigationHrefs).toContain("/dashboard/referentiel");
    expect(navigationHrefs).toContain("/dashboard/tarifs");
    expect(navigationHrefs).toContain("/dashboard/admin");
    expect(navigationHrefs).toContain("/dashboard/takeoff");
  });

  it("uses affaire-scoped takeoff href when lastAffaireId provided", () => {
    const items = buildNavigationItems({
      role: "admin",
      uiMode: "expert",
      featureFlags: { takeoffEnabled: true },
      lastAffaireId: "proj-abc",
    });
    const takeoffItem = items.find((i) => i.id === "nav-takeoff");
    expect(takeoffItem).toBeDefined();
    expect(takeoffItem?.href).toBe("/dashboard/affaires/proj-abc/takeoff");
    expect(takeoffItem?.keywords).toContain("metre");
    expect(takeoffItem?.keywords).toContain("extraction");
  });

  it("uses stable navId-based id for takeoff item", () => {
    const items = buildNavigationItems({
      role: "admin",
      uiMode: "expert",
      featureFlags: { takeoffEnabled: true },
      lastAffaireId: "proj-abc",
    });
    expect(items.find((i) => i.id === "nav-takeoff")).toBeDefined();
  });

  it("records cockpit history when executing a contextual command", async () => {
    setCockpitSuggestions({
      projectId: "11111111-1111-1111-1111-111111111111",
      suggestions: [
        {
          actionId: "prepare-validation",
          label: "Preparer la validation",
          intent: "prepare_validation",
          preview: "Soumettre le chiffrage pour validation.",
          target: { kind: "open_dialog", dialogId: "approval-submit" },
          requiresConfirmation: false,
          confirmTone: "info",
        },
      ],
    });

    const { result } = renderHook(() => useCommandPalette());
    const cockpitItem = result.current.flatItems.find(
      (item) => item.id === "cockpit-prepare-validation"
    );

    expect(cockpitItem).toBeDefined();

    act(() => {
      result.current.execute(cockpitItem!);
    });

    await waitFor(() => {
      expect(mockRecordCockpitCommandAction).toHaveBeenCalledWith({
        projectId: "11111111-1111-1111-1111-111111111111",
        actionId: "prepare-validation",
        intent: "prepare_validation",
      });
    });
  });
});
