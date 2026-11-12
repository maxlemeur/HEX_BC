import { describe, expect, it } from "vitest";

import { buildCatalogueAccess, canEditCatalogueRecord } from "./access";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("catalogue access (TI-689)", () => {
  it("lets an admin add and edit everything, whatever the setting", () => {
    const access = buildCatalogueAccess({ userId: ME, role: "admin", engineersCanEditShared: false });
    expect(access).toEqual({ userId: ME, canAdd: true, canEditShared: true });
    expect(canEditCatalogueRecord(access, null)).toBe(true);
    expect(canEditCatalogueRecord(access, OTHER)).toBe(true);
  });

  it("lets an engineer add, and edit only what they added while the setting is off", () => {
    const access = buildCatalogueAccess({ userId: ME, role: "engineer", engineersCanEditShared: false });
    expect(access).toEqual({ userId: ME, canAdd: true, canEditShared: false });
    expect(canEditCatalogueRecord(access, ME)).toBe(true);
    expect(canEditCatalogueRecord(access, OTHER)).toBe(false);
    expect(canEditCatalogueRecord(access, null)).toBe(false);
  });

  it("lets an engineer edit the shared base once the admin opened it", () => {
    const access = buildCatalogueAccess({ userId: ME, role: "engineer", engineersCanEditShared: true });
    expect(canEditCatalogueRecord(access, null)).toBe(true);
    expect(canEditCatalogueRecord(access, OTHER)).toBe(true);
  });

  it.each(["viewer", "director"] as const)("gives a %s nothing, even with the setting on", (role) => {
    const access = buildCatalogueAccess({ userId: ME, role, engineersCanEditShared: true });
    expect(access).toEqual({ userId: ME, canAdd: false, canEditShared: false });
    expect(canEditCatalogueRecord(access, ME)).toBe(false);
  });

  it("shows nothing while the access is unknown", () => {
    expect(canEditCatalogueRecord(undefined, ME)).toBe(false);
  });
});
