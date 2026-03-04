import { describe, expect, it } from "vitest";

import {
  buildNavigationItems,
  fuzzyMatch,
  type CommandItem,
} from "@/hooks/useCommandPalette";

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
});
