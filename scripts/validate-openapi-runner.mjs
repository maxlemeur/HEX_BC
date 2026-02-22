import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function isTsxInstalled() {
  try {
    require.resolve("tsx");
    return true;
  } catch {
    return false;
  }
}

if (!isTsxInstalled()) {
  console.error(
    "[validate-openapi] Failed: required dev dependency `tsx` is not installed, so OpenAPI validation cannot run."
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/validate-openapi.ts"],
  {
    stdio: "inherit",
  }
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  throw result.error;
}

process.exit(1);
