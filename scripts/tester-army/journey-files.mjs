// The full-only (takeoff) journeys the impact selection (select-journeys.ts)
// emits for the army-takeoff job, at any depth as the e2e.config.ts full glob
// e2e/army/takeoff/** finds them, and their login setup: the selector refuses a
// map whose full-only journeys this pattern refuses. A subset of
// FULL_JOURNEY_FILE below, which the runners accept. Every path segment starts
// with a letter or a digit: no "..", no hidden entry.
export const FULL_ONLY_JOURNEY_FILE =
  /^e2e\/army\/(?:critical\/auth\.setup|takeoff\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*)\.e2e\.ts$/;

// Journey files a critical `--files` run may name: the critical and local
// journeys of the critical suite (impact selection and its shards). Shared by
// scripts/run-tester-army-ci.ts, which also requires each file to exist, and
// scripts/run-tester-army.mjs, as FULL_JOURNEY_FILE is.
export const CRITICAL_JOURNEY_FILE = /^e2e\/army\/(?:critical|local)\/[A-Za-z0-9][A-Za-z0-9._-]*\.e2e\.ts$/;

// Journey files a full `--files` run may name since the nightly full suite is
// sharded (select-journeys.ts --plan full): every folder of the e2e.config.ts
// full selection, subfolders included, the full-only paths above among them.
// The e2e CLI still narrows the config's full glob to them: a file outside it
// never runs, and the runner then refuses the run.
export const FULL_JOURNEY_FILE =
  /^e2e\/army\/(?:critical|extended|local|takeoff)\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.e2e\.ts$/;
