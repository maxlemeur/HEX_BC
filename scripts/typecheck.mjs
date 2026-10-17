// `npm run typecheck`: tsc with the same heap floor as the Next build. On the
// CI runner's default V8 heap (about 2 GB) the whole-tree check ran out of
// memory (PR #25, 17/10/2026). Resolving tsc through Node also works from git
// worktrees whose node_modules sits in a parent directory, on every platform.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import { withNextBuildHeap } from "./next-build-env.mjs";

const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json", "--noEmit", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: withNextBuildHeap(process.env),
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
