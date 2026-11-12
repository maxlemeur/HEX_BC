// The test filters of the TesterArmy critical configuration (e2e.config.ts `filters`; https://e2e.com/docs/filters).
// The e2e runner calls them only when a run passes `--changed-since <ref>`; without it every journey runs.
//
// 1. armyImpactFilter: the impact selection of the CI (select-journeys.ts, army-impact-map.json) as a runner
//    filter. It leaves out the journeys the change cannot reach, by the rules the army-select job applies, and
//    the runner reports each one with its reason (`e2e list --changed-since origin/main` previews it).
// 2. armyDecisionFilter: the runner's decision filter (@e2e-dev/decision), where a model reads the diff and
//    rates how likely each journey is affected. It only narrows what the impact filter kept, and only the
//    army-select job of a pull request asks for it (E2E_ARMY_DECISION_FILTER=1, scripts/tester-army/
//    decision-listing.ts). Contract and limits: docs/testing/tester-army-ci.md, "Filtre par modèle de décision".
//
// Any doubt keeps the journeys: a full or fail-safe selection, a change to the test infrastructure, a journey a
// map rule ties to a changed file, a rating at or above DECISION_MIN_PERCENT, a reason that cannot be read, and
// an error here (the runner leaves nothing out when a filter throws).
import type { TestFilter } from "e2e";

import { expandJourneys, loadImpactMap, matchesAny, selectFromRepository } from "./select-journeys";

/** The decision model: the one the application's own Decisions use (src/lib/ai/decisions.ts). */
export const DECISION_MODEL = "gpt-6-luna";
/** The secret of the army-select job; never OPENAI_API_KEY, which the application could read. */
export const DECISION_KEY = "ARMY_DECISION_FILTER_API_KEY";
/**
 * A journey the model rates at or above this stays. The stock filter leaves out under 20 %; on this repository
 * the model answers 5 % when it sees no link (two thirds of its ratings) and 8 to 19 % when it sees a weak one.
 */
export const DECISION_MIN_PERCENT = 8;

/**
 * Paths that change how the journeys themselves are built, started or run: the runner, its configuration, the
 * shared fixtures, the dependencies. A model reading their diff cannot tell which journey they reach.
 */
export const DECISION_INFRASTRUCTURE = [
  "package.json", "package-lock.json", ".npmrc", ".nvmrc", "next.config.ts", "tsconfig.json", "postcss.config.mjs",
  "e2e.config.ts", "e2e/army/critical/fixtures.ts", "e2e/army/critical/auth.setup.e2e.ts",
  "scripts/**", "config/**", "supabase/config.toml", ".github/**",
];
/** Data of the selection itself: the impact filter already ran every journey for them. */
const SELECTION_DATA = ["scripts/tester-army/army-impact-map.json", "scripts/tester-army/army-shards.json"];

export const armyImpactFilter = {
  name: "army-impact",
  filter(tests, { changes, projectRoot }) {
    const selection = selectFromRepository(projectRoot, { event: "pull_request", paths: [...changes.files] });
    if (selection.mode === "full") return { exclude: {}, note: `every journey runs: ${selection.reason}` };
    const { map } = loadImpactMap(projectRoot);
    const fullOnly = new Set(map.fullOnly.journeys);
    const known = new Set([...map.suite.journeys, ...fullOnly]);
    // A fail-safe "all" without a list keeps every full-only journey.
    const everyFullOnly = selection.fullOnly.mode === "all" && selection.fullOnly.files.length === 0;
    const kept = new Set([...selection.files, ...selection.fullOnly.files]);
    const exclude: Record<string, string> = {};
    for (const test of tests) {
      // A journey the map does not list is not its to judge: it runs.
      if (!known.has(test.file) || kept.has(test.file) || (everyFullOnly && fullOnly.has(test.file))) continue;
      exclude[test.id] = fullOnly.has(test.file) ? selection.fullOnly.reason : selection.reason;
    }
    return { exclude, note: `${selection.reason}; takeoff: ${selection.fullOnly.reason}` };
  },
} satisfies TestFilter;

/** The runner's decision filter on DECISION_MODEL; throws without the key, and the runner then leaves nothing out. */
async function stockDecisionFilter(): Promise<TestFilter> {
  const apiKey = process.env[DECISION_KEY]?.trim();
  if (!apiKey) throw new Error(`${DECISION_KEY} is not set: the decision model is not asked.`);
  const [{ createOpenAI }, { decisionFilter }] = await Promise.all([import("@ai-sdk/openai"), import("@e2e-dev/decision")]);
  return decisionFilter({ model: createOpenAI({ apiKey }).decisionModel(DECISION_MODEL) });
}

/**
 * The decision filter behind its guards. `create` builds the stock filter when the runner first calls this one:
 * workers load the configuration too and must not load a model client.
 */
export function armyDecisionFilter(create: () => Promise<TestFilter> = stockDecisionFilter): TestFilter {
  return {
    name: "army-decision",
    async filter(tests, context) {
      const { map } = loadImpactMap(context.projectRoot);
      const changed = context.changes.files.filter((file) => !SELECTION_DATA.includes(file));
      const infrastructure = changed.find((file) => matchesAny(file, DECISION_INFRASTRUCTURE));
      if (infrastructure) return { exclude: {}, note: `the model judges nothing: ${infrastructure} changes how the journeys run` };
      // What can change the application's behaviour. Documentation, unit tests, generated types and the other
      // non-runtime paths of the map stay out of the diff the model reads, which it refuses above 60 kB.
      // A changed journey file stays in: the stock filter always runs its tests.
      const runtime = changed.filter((file) => file.startsWith("e2e/army/")
        || (!matchesAny(file, map.docs) && !matchesAny(file, map.nonRuntime) && file !== "src/types/database.generated.ts"));
      if (runtime.length === 0) return { exclude: {}, note: "the model judges nothing: no runtime file changed" };
      // The floor: a journey a map rule ties to a changed file runs, whatever the model says.
      const floor = new Set(runtime.flatMap((file) =>
        expandJourneys(map, map.rules.filter((rule) => matchesAny(file, rule.paths)).flatMap((rule) => rule.journeys))));
      const decision = await create();
      const result = await decision.filter(tests, { ...context, changes: { ...context.changes, files: runtime } });
      const byId = new Map(tests.map((test) => [test.id, test]));
      const exclude: Record<string, string> = {};
      let tied = 0;
      let rated = 0;
      for (const [id, reason] of Object.entries(result.exclude)) {
        const test = byId.get(id);
        if (!test) continue;
        if (floor.has(test.file)) { tied += 1; continue; }
        const percent = /^(\d+(?:\.\d+)?)% likely affected$/u.exec(reason);
        if (!percent || Number(percent[1]) >= DECISION_MIN_PERCENT) { rated += 1; continue; }
        exclude[id] = reason;
      }
      const kept = [
        ...(tied ? [`${tied} test(s) kept: a map rule ties their journey to a changed file`] : []),
        ...(rated ? [`${rated} test(s) kept: rated ${DECISION_MIN_PERCENT} % or more, or without a rating`] : []),
      ];
      return { exclude, note: [result.note, ...kept].filter(Boolean).join("; ") };
    },
  };
}
