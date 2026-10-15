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
export function sdkResultsRoot(fallback?: string) {
  const configured = process.env.E2E_ARMY_ARTIFACT_ROOT ?? fallback;
  if (!configured) throw new Error("The current run's SDK results root is required.");
  const root = path.resolve(configured);
  return path.basename(root) === "artifacts" ? path.join(path.dirname(root), "results") : root;
}
