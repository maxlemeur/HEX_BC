import { findRoutesWithoutColocatedTests } from "../src/test/routes-without-tests";

const missing = findRoutesWithoutColocatedTests();

if (missing.length === 0) {
  console.log("All API route.ts files have a colocated route.test.ts.");
  process.exit(0);
}

console.warn(`Routes without colocated route.test.ts (${missing.length}):`);
for (const routeFile of missing) {
  console.warn(`- ${routeFile}`);
}

process.exit(0);
