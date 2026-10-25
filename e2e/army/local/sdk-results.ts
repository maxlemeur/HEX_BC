import { realpath } from "node:fs/promises";
import path from "node:path";

// e2e >= 0.20 keeps each attempt's evidence, downloads included, under
// <output>/results/<test>/[rerun-<n>/]attempt-<n>/, and waitForDownload()
// returns a path relative to that attempt directory. The runner empties
// results/ when a run's tests start: a file found there belongs to this run,
// and evidence that must outlive it is copied out by the journey (business
// evidence) or archived by the wrapper. <output>/artifacts now only holds the
// repository's own evidence, so a root that still names it resolves to its
// sibling results/ instead of matching no download at all.
// E2E_ARMY_ARTIFACT_ROOT is the only override: scripts/run-tester-army.mjs
// sets it for each run. Critical resolveDownload() shares this resolution.
// e2e 0.21.3 app.screenshot() returns an absolute path (upstream #1326).
// Evidence keeps that file relative to the output root, the parent of results/.
export function sdkResultsRoot(fallback?: string) {
  const configured = process.env.E2E_ARMY_ARTIFACT_ROOT ?? fallback;
  if (!configured) throw new Error("The current run's SDK results root is required.");
  const root = path.resolve(configured);
  return path.basename(root) === "artifacts" ? path.join(path.dirname(root), "results") : root;
}

function resultsFallback() {
  const suite = process.env.E2E_ARMY_SUITE;
  if (suite === "coverage") return ".e2e/army/coverage/results";
  if (suite === "performance") return ".e2e/army/performance/results";
  if (suite === "anonymous" || suite === "agent") return ".e2e/army/results";
  return ".e2e/army/critical/results";
}

/** Absolute screenshot file, stored relative to this run's output root. */
export async function relativeOutputPath(absoluteFile: string) {
  if (!path.isAbsolute(absoluteFile)) throw new Error("app.screenshot() must return an absolute path.");
  const resultsRoot = await realpath(sdkResultsRoot(resultsFallback()));
  const outputRoot = path.basename(resultsRoot) === "results" ? path.dirname(resultsRoot) : resultsRoot;
  const file = await realpath(absoluteFile);
  const relative = path.relative(outputRoot, file).split(path.sep).join("/");
  if (relative === "" || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error("Screenshot must stay inside the output root.");
  }
  return relative;
}
