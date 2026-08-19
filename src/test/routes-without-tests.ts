import fs from "node:fs";
import path from "node:path";

import { discoverApiRouteOperations } from "@/lib/openapi/route-coverage";

export const REQUIRED_REMEDIATION_ROUTE_FILES = [
  "src/app/api/products/route.ts",
  "src/app/api/suppliers/route.ts",
  "src/app/api/orders/route.ts",
] as const;

export const REQUIRED_MUTATING_ROUTE_FILES = [
  "src/app/api/products/route.ts",
  "src/app/api/suppliers/route.ts",
] as const;

export function toPosixPath(filePath: string) {
  return filePath.replaceAll("\\", "/");
}

export function colocatedRouteTestPath(routeFile: string) {
  return toPosixPath(routeFile).replace(/route\.ts$/u, "route.test.ts");
}

export function listApiRouteFiles(rootDirectory = process.cwd()) {
  const { routeFiles } = discoverApiRouteOperations(rootDirectory);
  return routeFiles
    .map((filePath) =>
      toPosixPath(path.relative(rootDirectory, filePath))
    )
    .sort((left, right) => left.localeCompare(right));
}

export function findRoutesWithoutColocatedTests(rootDirectory = process.cwd()) {
  return listApiRouteFiles(rootDirectory).filter((routeFile) => {
    return !fs.existsSync(path.join(rootDirectory, colocatedRouteTestPath(routeFile)));
  });
}

export function assertRequiredRouteTests(rootDirectory = process.cwd()) {
  const missing: string[] = [];

  for (const routeFile of REQUIRED_REMEDIATION_ROUTE_FILES) {
    const absoluteRoute = path.join(rootDirectory, routeFile);
    const absoluteTest = path.join(rootDirectory, colocatedRouteTestPath(routeFile));
    if (!fs.existsSync(absoluteRoute) || !fs.existsSync(absoluteTest)) {
      missing.push(routeFile);
    }
  }

  return missing;
}
