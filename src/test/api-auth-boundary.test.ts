import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const apiRoot = path.join(root, "src", "app", "api");
const sourceFilePattern = /\.ts$/;
const testFilePattern = /\.(?:test|spec|test-utils)\.ts$/;
const artisanGetUserPattern = /auth\.getUser\s*\(/;
const canonicalImportPattern =
  /from\s+["']@\/lib\/auth\/tenant-context["']/;
const canonicalSymbolPattern =
  /\b(?:getAuthenticatedTenantContext|getAuthenticatedContext)\b/;

const requiredCanonicalRoutes = [
  "src/app/api/purchase-orders/route.ts",
  "src/app/api/purchase-orders/[id]/route.ts",
  "src/app/api/purchase-orders/[id]/zip/route.ts",
  "src/app/api/purchase-orders/[id]/devis/route.ts",
  "src/app/api/purchase-orders/[id]/devis/[devisId]/route.ts",
  "src/app/api/purchase-orders/[id]/devis/reorder/route.ts",
  "src/app/api/audit/route.ts",
];

function walkApiSourceFiles(directory: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkApiSourceFiles(fullPath, files);
      continue;
    }
    if (!sourceFilePattern.test(entry.name) || testFilePattern.test(entry.name)) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

describe("API auth boundary", () => {
  it("bans artisan auth.getUser in API route handlers", () => {
    const offenders = walkApiSourceFiles(apiRoot)
      .filter((file) => artisanGetUserPattern.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file).replaceAll("\\", "/"));

    expect(offenders).toEqual([]);
  });

  it("requires purchase-orders and audit routes to import the canonical tenant context", () => {
    const missing = requiredCanonicalRoutes.filter((relativePath) => {
      const source = fs.readFileSync(path.join(root, relativePath), "utf8");
      return !(
        canonicalImportPattern.test(source) && canonicalSymbolPattern.test(source)
      );
    });

    expect(missing).toEqual([]);
  });
});
