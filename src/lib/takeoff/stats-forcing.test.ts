import { describe, expect, it } from "vitest";

import { buildRuleForcingStats } from "@/lib/takeoff/stats-forcing";

// TI-686 D10 (H19): per rule, the applied lines it fails, those forced past one of its blocking failures, and those an
// administrator declared a false positive of it when forcing (a failure settled by V is never one). Since TI-681 only a
// failure that is not a quantity warning blocks (today the network materials of dn_network): a scale, a printed
// surface or an overlap is counted where it fails, never forced nor declared. All values are fictional.

const line = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const J1 = "10000000-0000-4000-8000-000000000001";
const J2 = "10000000-0000-4000-8000-000000000002";
const OTHER_JOB = "10000000-0000-4000-8000-000000000009";

const blocked = { rule: "dn_network", status: "fail", code: "DN_NETWORK_MATERIAL_BLOCKED", version: 3, acceptable: false,
  reason: "Matériau bloqué sur ce réseau (fictif)." };
const notAllowed = { rule: "dn_network", status: "fail", code: "DN_NETWORK_MATERIAL_NOT_ALLOWED", version: 3,
  acceptable: true, reason: "Matériau non admis sur ce réseau (fictif)." };
const dnMissing = { rule: "dn_network", status: "fail", code: "DN_NETWORK_DN_MISSING", version: 3, acceptable: true,
  reason: "DN absent (fictif)." };
const scale = { rule: "scale_dimension", status: "fail", code: "SCALE_DIMENSION_MISMATCH", version: 2, acceptable: true,
  reason: "Une cote contredit l’échelle (fictif)." };
const area = { rule: "area_printed", status: "fail", code: "AREA_PRINTED_MISMATCH", version: 3, acceptable: true,
  reason: "Surface écrite différente (fictif)." };
const pass = { rule: "dn_network", status: "pass", code: "DN_NETWORK_COMPATIBLE", version: 3, acceptable: true,
  reason: "DN compatible (fictif)." };
const duplicateOf = (partner: string, partnerJob: string) => ({
  rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE", version: 1, acceptable: true,
  reason: "Tronçon compté aussi sur Z2 (fictif).",
  details: { partner_count: 1, overlap_m: 1,
    partners: [{ item_id: partner, job_id: partnerJob, zone: "Z2", designation: "EF", overlap_m: 1, resolved: false }] },
});

type Results = readonly unknown[] | unknown;
const item = (n: number, job: string, rule_results: Results, extra: { verified?: boolean; excluded?: boolean } = {}) => ({
  id: line(n), job_id: job, is_verified: extra.verified ?? false, is_excluded: extra.excluded ?? false, rule_results,
});

type Forced = { n: number; reason: string; rules?: string[] };
const override = (id: string, job: string, forced: readonly Forced[]) => ({
  id, record_id: job, action: "takeoff.apply.override",
  after_data: { schema_version: 1, action: "takeoff.apply.override", job_id: job,
    metadata: { forced_justifications: ["Relevé chantier joint au dossier (fictif)."],
      forced_items: forced.map(({ n, reason, rules }) => ({ item_id: line(n), reason_code: reason,
        ...(rules ? { false_positive_rules: rules } : {}), justification_index: 0 })) } },
});

const CONSUMED = "20000000-0000-4000-8000-000000000001";
const EARLIER = "20000000-0000-4000-8000-000000000002";
const NOT_APPLIED = "20000000-0000-4000-8000-000000000003";

// J1, applied. dn_network: M1-M4 (11-14) and MS1 (15, with a scale warning) carry a blocked material and were forced;
// N1-N3 (21-23) a material to justify, settled by V; D1-D3 (31-33) a missing DN, a warning. Scale: S1-S3 (41-43), MS1,
// and E1 (44), forced for another protection (its missing localized proof). Area: A1 (51) settled by V, A2 (52). Zones:
// Z1 (61) duplicates Z1P (62), excluded by the application, so Z1 is left out; Z2 (63) duplicates a line of another job,
// present. X1 (71), excluded, carries a blocked material. P1 (81) passes. J2, completed and never applied, has five
// blocked materials and an override that was never consumed; an earlier override of J1 was not consumed either.
const jobs = [{ id: J1, status: "applied" }, { id: J2, status: "completed" }];
const items = [
  item(11, J1, [blocked]), item(12, J1, [blocked]), item(13, J1, [blocked]), item(14, J1, [blocked]),
  item(15, J1, [blocked, scale]),
  item(21, J1, [notAllowed], { verified: true }), item(22, J1, [notAllowed], { verified: true }),
  item(23, J1, [notAllowed], { verified: true }),
  item(31, J1, [dnMissing]), item(32, J1, [dnMissing]), item(33, J1, [dnMissing]),
  item(41, J1, [scale]), item(42, J1, [scale]), item(43, J1, [scale]), item(44, J1, [scale]),
  item(51, J1, [area], { verified: true }), item(52, J1, [area]),
  item(61, J1, [duplicateOf(line(62), J1)]), item(62, J1, [duplicateOf(line(61), J1)], { excluded: true }),
  item(63, J1, [duplicateOf(line(99), OTHER_JOB)]),
  item(71, J1, [blocked], { excluded: true }),
  item(81, J1, [pass]),
  ...[91, 92, 93, 94, 95].map((n) => item(n, J2, [blocked])),
];
const overrideAudits = [
  override(EARLIER, J1, [{ n: 11, reason: "additional_evidence" }, { n: 21, reason: "rule_false_positive", rules: ["dn_network"] },
    { n: 41, reason: "rule_false_positive", rules: ["scale_dimension"] }]),
  override(CONSUMED, J1, [
    { n: 11, reason: "rule_false_positive", rules: ["dn_network"] }, { n: 12, reason: "rule_false_positive", rules: ["dn_network"] },
    { n: 13, reason: "additional_evidence" }, { n: 14, reason: "priced_hypothesis" },
    { n: 15, reason: "rule_false_positive", rules: ["dn_network"] }, { n: 44, reason: "additional_evidence" },
  ]),
  override(NOT_APPLIED, J2, [91, 92, 93, 94, 95].map((n) => ({ n, reason: "rule_false_positive", rules: ["dn_network"] }))),
];
const consumptions = [{ audit_log_id: CONSUMED, job_id: J1 }];

const row = (rule: string, label: string, failedLines: number, forcedLines: number, falsePositiveLines: number,
  falsePositiveRate: number | null) => ({ rule, label, failedLines, forcedLines, falsePositiveLines, falsePositiveRate });

describe("buildRuleForcingStats", () => {
  it("rates the false positives declared at forcing over the applied lines each rule fails", () => {
    const stats = buildRuleForcingStats({ jobs, items, overrideAudits, consumptions });

    expect(stats.rows).toEqual([
      row("dn_network", "DN et réseau", 11, 5, 3, 27.3),
      row("zone_overlap", "Doublon entre zones", 1, 0, 0, 0),
      row("scale_dimension", "Échelle et cotes", 5, 0, 0, 0),
      row("area_printed", "Aire et surface imprimée", 2, 0, 0, 0),
      row("room_overlap", "Pièces qui se chevauchent", 0, 0, 0, null),
      row("closed_box", "Boîte fermée", 0, 0, 0, null),
      row("non_observable", "Quantité à saisir", 0, 0, 0, null),
    ]);
    // Every line of the consumed override, whatever kept it blocked (E1 had no blocking rule).
    expect(stats.forcedLines).toBe(6);
  });

  it("counts nothing for an override that was not consumed, nor for a job that was not applied", () => {
    const stats = buildRuleForcingStats({ jobs, items, overrideAudits, consumptions: [] });

    expect(stats.rows[0]).toEqual(row("dn_network", "DN et réseau", 11, 0, 0, 0));
    expect(stats.forcedLines).toBe(0);
  });

  it("never counts more declared false positives than lines forced past that rule", () => {
    const stats = buildRuleForcingStats({
      jobs: [{ id: J1, status: "applied" }],
      items: [item(15, J1, [blocked, scale])],
      overrideAudits: [override(CONSUMED, J1, [{ n: 15, reason: "rule_false_positive", rules: ["dn_network", "scale_dimension"] }])],
      consumptions,
    });

    expect(stats.rows.find((entry) => entry.rule === "dn_network")).toEqual(row("dn_network", "DN et réseau", 1, 1, 1, 100));
    expect(stats.rows.find((entry) => entry.rule === "scale_dimension"))
      .toEqual(row("scale_dimension", "Échelle et cotes", 1, 0, 0, 0));
  });

  it("reads stored values it cannot parse as nothing", () => {
    const stats = buildRuleForcingStats({
      jobs: [{ id: J1, status: "applied" }],
      items: [item(11, J1, "pas un tableau"), item(12, J1, [{ rule: "dn_network", status: "fail" }]), item(13, J1, [blocked])],
      overrideAudits: [
        override(CONSUMED, J1, [{ n: 11, reason: "additional_evidence" }, { n: 12, reason: "rule_false_positive", rules: ["dn_network"] },
          { n: 13, reason: "rule_false_positive", rules: ["dn_network"] }]),
        { id: EARLIER, record_id: J1, action: "takeoff.apply.override", after_data: { metadata: { forced_items: "?" } } },
      ],
      consumptions: [...consumptions, { audit_log_id: EARLIER, job_id: J1 }],
    });

    expect(stats.rows[0]).toEqual(row("dn_network", "DN et réseau", 1, 1, 1, 100));
    expect(stats.forcedLines).toBe(3);
  });
});
