import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectRpcNamesFromSource,
  collectTakeoffTableNamesFromSource,
  extractDatabaseSectionKeys,
  inspectDatabaseTypesInventory,
  isInventorySourceFile,
} from "@/test/database-types-inventory";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function createFixture(files: Record<string, string>) {
  const rootDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "database-types-inventory-")
  );
  temporaryDirectories.push(rootDirectory);
  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = path.join(rootDirectory, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, source, "utf8");
  }
  return rootDirectory;
}

describe("database types inventory", () => {
  it("extracts rpc literals, same-file constants, and takeoff table names", () => {
    expect(
      collectRpcNamesFromSource(`
        const LINK_ROWS = "link_mapped_rows_to_catalogue";
        await supabase.rpc("list_approval_queue" as never, {});
        await supabase.rpc(
          "recover_stale_takeoff_jobs",
          { p_now: now }
        );
        await supabase.rpc(LINK_ROWS, { link_rows: [] });
      `)
    ).toEqual([
      "link_mapped_rows_to_catalogue",
      "list_approval_queue",
      "recover_stale_takeoff_jobs",
    ]);
    expect(
      collectTakeoffTableNamesFromSource(`
        await supabase.from("takeoff_jobs" as never).select("id");
        await supabase.from("plan_sets").select("id");
        await supabase.from("estimate_items").select("id");
      `)
    ).toEqual(["plan_sets", "takeoff_jobs"]);
  });

  it("reads Tables and Functions keys from the generated Database shape", () => {
    const source = `
export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: { id: string };
      };
      takeoff_jobs: {
        Row: { tenant_id: string };
      };
    };
    Functions: {
      current_tenant_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
    };
  };
};
`;
    expect(extractDatabaseSectionKeys(source, "Tables")).toEqual([
      "tenants",
      "takeoff_jobs",
    ]);
    expect(extractDatabaseSectionKeys(source, "Functions")).toEqual([
      "current_tenant_id",
    ]);
  });

  it("skips tests and src/test when deciding inventory sources", () => {
    expect(isInventorySourceFile("src/lib/takeoff/server.ts")).toBe(true);
    expect(isInventorySourceFile("src/lib/takeoff/server.test.ts")).toBe(false);
    expect(isInventorySourceFile("src/test/database-types-inventory.ts")).toBe(
      false
    );
  });

  it("fails when used rpcs or required takeoff tables are missing from database.ts", () => {
    const rootDirectory = createFixture({
      "src/types/database.ts": `
export type Database = {
  public: {
    Tables: {
      tenants: { Row: { id: string } };
    };
    Functions: {
      current_tenant_id: { Args: Record<PropertyKey, never>; Returns: string | null };
    };
  };
};
`,
      "src/lib/workflows/recovery.ts":
        'await client.rpc("recover_stale_takeoff_jobs", { p_now: now });\n',
      "src/lib/takeoff/server.ts":
        'await supabase.from("takeoff_jobs" as never).select("id");\n',
      "src/lib/takeoff/server.test.ts":
        'await supabase.rpc("ignored_test_rpc", {});\n',
    });

    const inventory = inspectDatabaseTypesInventory(rootDirectory);
    expect(inventory.missingRpcs).toContain("recover_stale_takeoff_jobs");
    expect(inventory.missingTables).toContain("takeoff_jobs");
    expect(inventory.missingRpcs).not.toContain("ignored_test_rpc");
  });

  it("keeps src/types/database.ts aligned with runtime rpc and takeoff table usage", () => {
    const inventory = inspectDatabaseTypesInventory();
    expect(inventory.missingRpcs).toEqual([]);
    expect(inventory.missingTables).toEqual([]);
    expect(inventory.usedRpcs).toContain("list_approval_queue");
    expect(inventory.usedTables).toEqual(
      expect.arrayContaining([
        "plan_files",
        "plan_sets",
        "takeoff_jobs",
        "takeoff_items",
        "takeoff_price_suggestions",
      ])
    );
  });
});
