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
  console.warn(
    "[validate-openapi] Skipped because optional dev dependency `tsx` is not installed."
  );
  process.exit(0);
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
