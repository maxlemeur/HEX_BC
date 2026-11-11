import { describe, expect, it } from "vitest";

import {
  readTakeoffProvision, takeoffProvisionExportLabel, takeoffProvisionHypothesisBasis,
} from "@/lib/estimates/takeoff-provision";

// TI-686 D10/D12: the takeoff application writes source_metadata.takeoff_provision on an estimate line built from a
// forced takeoff line or from a quantity entered as a hypothesis (private.takeoff_mark_provisions). The marker states
// facts; how the line reaches the offer is the default treatment, an internal provision (H9, H18).
const JOB_ID = "c3000000-0000-4000-8000-000000000201";
const FORCED = { takeoff_item_id: "c3000000-0000-4000-8000-000000000301", forced: true, forced_reason: null, entry_category: null };
const HYPOTHESIS = {
  takeoff_item_id: "c3000000-0000-4000-8000-000000000303", forced: false, forced_reason: null, entry_category: "hypothesis",
};
const marker = (...sources: unknown[]) => ({ takeoff_item_id: FORCED.takeoff_item_id,
  takeoff_provision: { version: 1, job_id: JOB_ID, sources } });

describe("readTakeoffProvision", () => {
  it("reads no provision without the marker", () => {
    expect(readTakeoffProvision({ takeoff_item_id: FORCED.takeoff_item_id })).toBeNull();
    expect(readTakeoffProvision({ takeoff_item_id: FORCED.takeoff_item_id, takeoff_provision: null })).toBeNull();
    expect(readTakeoffProvision(null)).toBeNull();
    expect(readTakeoffProvision("takeoff_provision")).toBeNull();
  });

  it("reads a forced line as an internal provision, treated as such in the offer", () => {
    expect(readTakeoffProvision(marker(FORCED))).toEqual({
      kind: "internal_provision", treatment: "internal_provision", readable: true, sources: [FORCED],
    });
  });

  it("reads a quantity entered as a hypothesis, or forced as a priced hypothesis, as a hypothesis", () => {
    expect(readTakeoffProvision(marker(FORCED, HYPOTHESIS))).toMatchObject({
      kind: "hypothesis", treatment: "internal_provision", sources: [FORCED, HYPOTHESIS],
    });
    expect(readTakeoffProvision(marker({ ...FORCED, forced_reason: "priced_hypothesis" }))).toMatchObject({ kind: "hypothesis" });
  });

  it("counts an unreadable marker as an internal provision, never as no marker", () => {
    for (const unreadable of [{}, "provision", { version: 2, job_id: JOB_ID, sources: [FORCED] },
      { version: 1, job_id: JOB_ID, sources: [] }, { version: 1, job_id: JOB_ID, sources: [{ forced: "yes" }] }]) {
      expect(readTakeoffProvision({ takeoff_provision: unreadable })).toEqual({
        kind: "internal_provision", treatment: "internal_provision", readable: false, sources: [],
      });
    }
  });
});

// TI-682 lot C: an hypothesis included without entry (an estimate, a quantity a plan cannot show) is marked at
// application too, and each source says why it is an hypothesis (hypothesis_cause, public.takeoff_item_hypothesis_cause).
// The marker stays version 1: a marker written before, without the key, reads exactly as before.
const ESTIMATED = {
  takeoff_item_id: "c3000000-0000-4000-8000-000000000306", forced: false, forced_reason: null, entry_category: null,
  hypothesis_cause: "estimated",
};
const NOT_OBSERVABLE = { ...ESTIMATED, takeoff_item_id: "c3000000-0000-4000-8000-000000000307", hypothesis_cause: "non_observable" };

describe("readTakeoffProvision, hypothesis causes (TI-682 lot C)", () => {
  it("reads an estimate or a quantity a plan cannot show, counted without entry, as a hypothesis", () => {
    for (const source of [ESTIMATED, NOT_OBSERVABLE]) {
      expect(readTakeoffProvision(marker(source))).toEqual({
        kind: "hypothesis", treatment: "internal_provision", readable: true, sources: [source],
      });
      expect(takeoffProvisionExportLabel(marker(source))).toBe("Hypothèse");
    }
  });

  it("reads a forced source no hypothesis rests on as an internal provision, the cause written or not", () => {
    for (const source of [{ ...FORCED, hypothesis_cause: null }, FORCED]) {
      expect(readTakeoffProvision(marker(source))).toEqual({
        kind: "internal_provision", treatment: "internal_provision", readable: true, sources: [source],
      });
      expect(takeoffProvisionExportLabel(marker(source))).toBe("Provision interne");
    }
  });

  it("reads a marker written before the cause existed exactly as before, without adding the key", () => {
    const cases = [[FORCED, "internal_provision"], [HYPOTHESIS, "hypothesis"],
      [{ ...FORCED, forced_reason: "priced_hypothesis" }, "hypothesis"]] as const;
    for (const [source, kind] of cases) {
      const provision = readTakeoffProvision(marker(source));
      expect(provision).toEqual({ kind, treatment: "internal_provision", readable: true, sources: [source] });
      expect(provision?.sources.every((read) => !("hypothesis_cause" in read))).toBe(true);
    }
  });

  it("counts a cause that is neither text nor null as an unreadable marker", () => {
    expect(readTakeoffProvision(marker({ ...ESTIMATED, hypothesis_cause: 1 }))).toEqual({
      kind: "internal_provision", treatment: "internal_provision", readable: false, sources: [],
    });
  });

  it("names what a hypothesis rests on: an entry first, then an estimate, a quantity a plan cannot show, a priced forcing", () => {
    const basis = (...sources: unknown[]) => {
      const provision = readTakeoffProvision(marker(...sources));
      return provision ? takeoffProvisionHypothesisBasis(provision) : undefined;
    };
    expect(basis(FORCED)).toBeNull();
    expect(basis({ ...FORCED, hypothesis_cause: null })).toBeNull();
    expect(basis(ESTIMATED)).toBe("estimated");
    expect(basis(NOT_OBSERVABLE)).toBe("non_observable");
    expect(basis(NOT_OBSERVABLE, ESTIMATED)).toBe("estimated");
    expect(basis(ESTIMATED, HYPOTHESIS)).toBe("entered");
    expect(basis({ ...HYPOTHESIS, hypothesis_cause: "entered_hypothesis" })).toBe("entered");
    expect(basis({ ...FORCED, forced_reason: "priced_hypothesis" })).toBe("forced");
    expect(basis({ ...FORCED, forced_reason: "priced_hypothesis", hypothesis_cause: "non_observable" })).toBe("non_observable");
    expect(basis({ ...FORCED, hypothesis_cause: "cause_inconnue" })).toBe("other");
  });
});
