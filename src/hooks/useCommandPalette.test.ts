import { beforeEach,describe,expect,it,vi } from "vitest";

const mockPush = vi.fn();

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

import {
buildNavigationItems,
type CommandItem
} from "@/hooks/useCommandPalette";
import {
_resetForTest as resetCockpitSuggestionsStore
} from "@/lib/stores/cockpit-suggestions-store";

describe("buildNavigationItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCockpitSuggestionsStore();
    window.localStorage.clear();
  });

  function hrefs(items: CommandItem[]) {
    return items.map((item) => item.href);
  }

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
});
