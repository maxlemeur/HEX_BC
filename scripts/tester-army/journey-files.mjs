// Journey files a full `--files` run may name: the full-only (takeoff) journeys
// the impact selection (select-journeys.ts) emits for the army-takeoff job, at
// any depth as the e2e.config.ts full glob e2e/army/takeoff/** finds them, and
// their login setup. Shared by scripts/run-tester-army-ci.ts, which also
// requires each file to exist, and scripts/run-tester-army.mjs. Every path
// segment starts with a letter or a digit: no "..", no hidden entry.
export const FULL_ONLY_JOURNEY_FILE =
  /^e2e\/army\/(?:critical\/auth\.setup|takeoff\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*)\.e2e\.ts$/;
