import { describe, expect, it } from "vitest";

import { buildNavGroups, type BuildNavGroupsInput } from "./build-nav-groups";

function groupKeys(input: BuildNavGroupsInput) {
  return buildNavGroups(input).map((g) => g.key);
}

function allHrefs(input: BuildNavGroupsInput) {
  return buildNavGroups(input).flatMap((g) => g.items.map((i) => i.href));
}

// ---------------------------------------------------------------------------
// Role x Mode matrix
// ---------------------------------------------------------------------------

describe("buildNavGroups", () => {
  const base: BuildNavGroupsInput = {
    role: "engineer",
    uiMode: "simplified",
    featureFlags: { takeoffEnabled: false },
  };

  describe("engineer + simplified", () => {
    it("returns accueil before affaires and commandes", () => {
      expect(groupKeys(base)).toEqual(["accueil", "affaires", "commandes"]);
    });
  });

  describe("engineer + expert", () => {
    it("returns accueil, affaires, commandes and outils", () => {
      expect(groupKeys({ ...base, uiMode: "expert" })).toEqual([
        "accueil",
        "affaires",
        "commandes",
        "outils",
      ]);
    });
  });

  describe("admin + simplified", () => {
    it("returns 6 groups including accueil, validation and administration", () => {
      expect(groupKeys({ ...base, role: "admin" })).toEqual([
        "accueil",
        "affaires",
        "commandes",
        "validation",
        "outils",
        "administration",
      ]);
    });
  });

  describe("admin + expert", () => {
    it("returns 6 groups including accueil, validation and administration", () => {
      expect(
        groupKeys({ ...base, role: "admin", uiMode: "expert" })
      ).toEqual([
        "accueil",
        "affaires",
        "commandes",
        "validation",
        "outils",
        "administration",
      ]);
    });
  });

  describe("director + simplified", () => {
    it("returns accueil, affaires, commandes and validation", () => {
      expect(groupKeys({ ...base, role: "director" })).toEqual([
        "accueil",
        "affaires",
        "commandes",
        "validation",
      ]);
    });
  });

  describe("director + expert", () => {
    it("returns 3 groups: affaires, commandes, validation", () => {
      expect(
        groupKeys({ ...base, role: "director", uiMode: "expert" })
      ).toEqual(["accueil", "affaires", "commandes", "validation"]);
    });

    it("includes approvals and direction hrefs in validation group", () => {
      const groups = buildNavGroups({ ...base, role: "director" });
      const validation = groups.find((g) => g.key === "validation");
      expect(validation?.items.some((i) => i.href === "/dashboard/approvals")).toBe(true);
      expect(validation?.items.some((i) => i.href === "/dashboard/direction")).toBe(true);
    });
  });

  describe("viewer + simplified", () => {
    it("returns accueil, affaires and commandes", () => {
      expect(groupKeys({ ...base, role: "viewer" })).toEqual([
        "accueil",
        "affaires",
        "commandes",
      ]);
    });
  });

  describe("viewer + expert", () => {
    it("returns 2 groups: affaires, commandes", () => {
      expect(
        groupKeys({ ...base, role: "viewer", uiMode: "expert" })
      ).toEqual(["accueil", "affaires", "commandes"]);
    });
  });

  describe("null role", () => {
    it("returns empty array", () => {
      expect(buildNavGroups({ ...base, role: null })).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Takeoff feature flag
  // ---------------------------------------------------------------------------

  describe("takeoff flag", () => {
    it("includes takeoff item in affaires when enabled", () => {
      const groups = buildNavGroups({
        ...base,
        featureFlags: { takeoffEnabled: true },
      });
      const affaires = groups.find((g) => g.key === "affaires");
      expect(affaires?.items.some((i) => i.href === "/dashboard/takeoff")).toBe(
        true
      );
    });

    it("excludes takeoff item when disabled", () => {
      const groups = buildNavGroups(base);
      const affaires = groups.find((g) => g.key === "affaires");
      expect(affaires?.items.some((i) => i.href === "/dashboard/takeoff")).toBe(
        false
      );
    });

    it("uses affaire-scoped href when lastAffaireId is provided", () => {
      const groups = buildNavGroups({
        ...base,
        featureFlags: { takeoffEnabled: true },
        lastAffaireId: "proj-123",
      });
      const affaires = groups.find((g) => g.key === "affaires");
      const takeoff = affaires?.items.find((i) => i.navId === "takeoff");
      expect(takeoff?.href).toBe("/dashboard/affaires/proj-123/takeoff");
    });

    it("falls back to /dashboard/takeoff when lastAffaireId is undefined", () => {
      const groups = buildNavGroups({
        ...base,
        featureFlags: { takeoffEnabled: true },
      });
      const affaires = groups.find((g) => g.key === "affaires");
      const takeoff = affaires?.items.find((i) => i.navId === "takeoff");
      expect(takeoff?.href).toBe("/dashboard/takeoff");
    });

    it("does not include takeoff when disabled even with lastAffaireId", () => {
      const groups = buildNavGroups({
        ...base,
        featureFlags: { takeoffEnabled: false },
        lastAffaireId: "proj-123",
      });
      const affaires = groups.find((g) => g.key === "affaires");
      expect(affaires?.items.find((i) => i.navId === "takeoff")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Removed items
  // ---------------------------------------------------------------------------

  describe("removed items", () => {
    const roles = ["admin", "engineer", "viewer"] as const;
    const modes = ["simplified", "expert"] as const;

    for (const role of roles) {
      for (const uiMode of modes) {
        it(`${role} + ${uiMode}: no /dashboard/imports or /dashboard/mappings`, () => {
          const hrefs = allHrefs({ role, uiMode, featureFlags: { takeoffEnabled: true } });
          expect(hrefs).not.toContain("/dashboard/imports");
          expect(hrefs).not.toContain("/dashboard/mappings");
        });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Icon check
  // ---------------------------------------------------------------------------

  describe("all items have truthy icon", () => {
    it("every item across all roles has an icon", () => {
      const groups = buildNavGroups({
        role: "admin",
        uiMode: "expert",
        featureFlags: { takeoffEnabled: true },
      });
      for (const group of groups) {
        for (const item of group.items) {
          expect(item.icon).toBeTruthy();
        }
      }
    });
  });

  it("uses the requested user-facing labels", () => {
    const groups = buildNavGroups({
      role: "admin",
      uiMode: "expert",
      featureFlags: { takeoffEnabled: false },
    });
    const items = groups.flatMap((group) => group.items);

    expect(items[0]).toMatchObject({ href: "/dashboard", label: "Accueil" });
    expect(items.find((item) => item.href === "/dashboard/analytics")?.label).toBe(
      "Performances"
    );
    expect(items.find((item) => item.href === "/dashboard/direction")?.label).toBe(
      "Vue direction"
    );
  });
});
