// @vitest-environment node

import { describe, expect, it } from "vitest";

import { CALC_V3_PHASES } from "../../scripts/tester-army/calc-v3-phases";
import { formatReach, reachOutsideCritical, type Reach } from "../../scripts/tester-army/reach";
import { loadImpactMap } from "../../scripts/tester-army/select-journeys";

const root = process.cwd();
const reach = (overrides: Partial<Reach>): Reach => ({ paths: 2, takeoff: [], extended: [], development: false, calcV3: [],
  everyTakeoff: false, everyCalcV3: false, reasons: { takeoff: "takeoff reason", calcV3: "calc reason" }, ...overrides });

// A push to main runs the critical suite only. The takeoff journeys and the calc-v3
// phases wait for a pull request, the development phase and the extended journeys for
// the night: a change pushed directly must learn which of them it reaches first.
describe("journeys a push to main does not run", () => {
  it("reaches none for no change or documentation only", () => {
    for (const paths of [[], ["docs/testing/new-notes.md"]]) {
      const reached = reachOutsideCritical(root, paths);
      expect(reached).toMatchObject({ takeoff: [], extended: [], development: false, calcV3: [] });
      expect(formatReach(reached).join("\n")).toContain("reaches no takeoff, extended or development journey and no calc-v3 phase");
    }
  });

  it("reaches every takeoff journey, the development phase and every calc-v3 phase for a shared input, and says it is a fallback", () => {
    const reached = reachOutsideCritical(root, ["e2e.config.ts"]);
    expect(reached.takeoff).toEqual([...loadImpactMap(root).map.fullOnly.journeys].sort());
    expect(reached).toMatchObject({ development: true, everyTakeoff: true, everyCalcV3: true });
    expect(reached.calcV3).toEqual(CALC_V3_PHASES);
    const printed = formatReach(reached).join("\n");
    expect(printed).toContain("Takeoff: every journey");
    expect(printed).toContain("calc-v3: every phase");
    // One line to pick from, not nineteen commands that read as nineteen obligations.
    expect(printed.split("\n").filter((line) => line.includes("e2e:army:calc-v3"))).toHaveLength(1);
  });

  it("reaches the hub's takeoff journeys for a change of the affaire page, without the login setup", () => {
    const reached = reachOutsideCritical(root, ["src/components/affaires/AffaireJourneyPanel.tsx"]);
    expect(reached.takeoff).toContain("e2e/army/takeoff/affaire-pilotage-panel.e2e.ts");
    expect(reached.takeoff).not.toContain(loadImpactMap(root).map.suite.setup);
    expect(reached.development).toBe(true);
  });

  it("lists a changed development or extended journey, which only the night runs", () => {
    expect(reachOutsideCritical(root, ["e2e/army/development/team-a-hub.e2e.ts"]).development).toBe(true);
    const changed = ["e2e/army/extended/catalogue-ui.e2e.ts", "e2e/army/extended/deleted.e2e.ts", "e2e/army/extended/support.ts"];
    const reached = reachOutsideCritical(root, changed, (file) => file !== "e2e/army/extended/deleted.e2e.ts");
    expect(reached.extended).toEqual(["e2e/army/extended/catalogue-ui.e2e.ts"]);
    expect(formatReach(reached)).toContain("  npm run e2e:army:ci -- full --files e2e/army/extended/catalogue-ui.e2e.ts");
  });

  it("prints one runnable command per mapped suite", () => {
    const lines = formatReach(reach({ takeoff: ["e2e/army/takeoff/a.e2e.ts", "e2e/army/takeoff/b.e2e.ts"], development: true,
      calcV3: ["emission", "resend-portal"] }));
    expect(lines).toContain("Takeoff: 2 file(s) mapped to the change. Run them:");
    expect(lines).toContain("  npm run e2e:army:ci -- full --files e2e/army/takeoff/a.e2e.ts,e2e/army/takeoff/b.e2e.ts");
    expect(lines).toContain("  npm run e2e:army:ci -- full --phase development");
    expect(lines).toContain("calc-v3: 2 phase(s) mapped to the change. Run them:");
    expect(lines).toContain("  npm run e2e:army:calc-v3 -- --phase emission");
    expect(lines).toContain("  npm run e2e:army:calc-v3 -- --phase resend-portal");
  });
});
