import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BenchDatasetError } from "@/lib/takeoff/bench/dataset";
import { loadGroupTruthDirectory, renderGroupScoreSection, scoreGroupTruth, type GroupScorePassInput } from "@/lib/takeoff/bench/group-score";
import { GroupTruthFileSchema, ManifestDocumentSchema, type GroupTruthFile, type ManifestDocument } from "@/lib/takeoff/bench/schemas";

// Ways the per-group score of the bench (TI-704) could misjudge Decisions,
// written before the code. Every document, group and answer is fictional.
// Arithmetic:
// - a parent-level network (HW for HW-S, or the sibling HW-R) counts as exact,
//   or not at all; a Decisions network under its accepted margin (0.5 since
//   TI-704 v2, 0.8 before) counts as found instead of proposed (it is never
//   measured); a keyword class of a truth group is ignored because only
//   Decisions is scored;
// - a network answered « autre » at 0.91 is not counted as refused, or a
//   non-network proposed as a network is not counted at all;
// - « à revoir » leaves out a Decisions answer under that margin, or counts a
//   Decisions « autre » at 0.95 (the review reads it as decided);
// - a group of a failed page, or a truth group the reading no longer has, is
//   counted as « à revoir » instead of not read; a truth document the run did
//   not read is silently dropped;
// - a network the candidate filter left out is not counted as lost;
// - the confidence bands put 0.8 under the threshold, or 0.6 in [0.5 ; 0.6[;
//   their precision is taken over all answers instead of the network
//   proposals;
// - calls, tokens and latency are taken over the truth pages only, instead of
//   every page the run read (the cost is the run's).
// Review (written before the fix): with --repeat 2, a second pass stopped
// before a truth document silently drops its groups instead of counting them
// not read; the candidates recorded are called « sent » although a stopped
// run never asks some of them.
// Truth directory:
// - its files are not checked as truth/groups is (unknown class, a group listed
//   twice, a document outside the manifest, a file not named after its
//   document), or a README beside them is refused;
// - the directory lies inside the dataset, so it would also be applied as the
//   user's correspondences and enter the dataset SHA;
// - the report records the truth itself instead of its hash, or a hash that
//   does not change when a label does.

const NET = { N1: "c:#ff0000|w:1|d:", N2: "c:#ff0000|w:2|d:", N3: "c:#00ff00|w:1|d:", N4: "c:#0000ff|w:1|d:", N5: "c:#ff8000|w:1|d:",
  N6: "c:#00ffff|w:1|d:", N7: "c:#0080ff|w:1|d:", N8: "c:#ff0080|w:1|d:" } as const;
const OTHER = { O1: "c:#808080|w:1|d:", O2: "c:#aa00aa|w:1|d:", O3: "c:#aaaa00|w:1|d:", O4: "c:#00aaaa|w:1|d:" } as const;

function truthFile(document: string, groups: Array<{ page: number; group: string; class: string }>): GroupTruthFile {
  return GroupTruthFileSchema.parse({ schema_version: 1, document, groups });
}

const TRUTH = new Map<string, GroupTruthFile>([
  ["a-plan-01", truthFile("a-plan-01", [
    { page: 1, group: NET.N1, class: "HW-S" }, { page: 1, group: NET.N2, class: "HW-S" }, { page: 1, group: NET.N3, class: "CHW-R" },
    { page: 1, group: NET.N4, class: "EU" }, { page: 1, group: NET.N5, class: "ECS" }, { page: 1, group: NET.N6, class: "EF" },
    { page: 1, group: NET.N7, class: "EF" }, { page: 1, group: NET.N8, class: "HW-R" },
    { page: 1, group: OTHER.O1, class: "fond" }, { page: 1, group: OTHER.O2, class: "autre" }, { page: 1, group: OTHER.O3, class: "mur" },
    { page: 1, group: OTHER.O4, class: "autre" },
  ])],
  ["b-plan-02", truthFile("b-plan-02", [{ page: 1, group: NET.N1, class: "CHW-S" }, { page: 1, group: OTHER.O1, class: "fond" }])],
  ["c-plan-03", truthFile("c-plan-03", [{ page: 1, group: NET.N1, class: "EF" }])],
]);

type Group = { id: string; class: string | null; source: string | null; confidence: number | null; candidates?: string[] };
const g = (id: string, cls: string | null = null, source: string | null = null, confidence: number | null = null): Group => ({ id, class: cls, source, confidence });
const answer = (group: string, cls: string | null, confidence: number | null, status = "answered") =>
  ({ alias: "groupe_00", group, class: cls, confidence, status, via: "batch" as const });
const call = (kind: "batch" | "dedicated", total: number | null, latency: number) =>
  ({ kind, questions: 1, status: "available" as const, usage: total === null ? null : { input_tokens: total, output_tokens: 0, total_tokens: total },
    latency_ms: latency, render_ms: null });

/** a-plan-01 p1 read with Decisions; b-plan-02 p1 failed; d-plan-04 p1 (no truth) read with one call. */
const PASS: GroupScorePassInput = {
  pass: 1,
  documents: [
    { id: "a-plan-01", pages: [{
      page: 1, status: "ok",
      reading: { groups: [
        g(NET.N1, "HW-S", "decisions", 0.9), g(NET.N2, "HW", "decisions", 0.85), g(NET.N3, "CHW-S", "decisions", 0.45),
        g(NET.N4, "autre", "decisions", 0.91), g(NET.N5, "fond", "decisions", 0.3), g(NET.N6), g(NET.N7, "EF", "legend"),
        g(OTHER.O1), g(OTHER.O2, "EU", "decisions", 0.85), g(OTHER.O3, "CHW", "decisions", 0.4), g(OTHER.O4, "autre", "decisions", 0.95),
        g("c:#123456|w:1|d:", "EF", "legend"),
      ] },
      decisions: { calls: [call("batch", 1000, 2000), call("dedicated", 500, 1000), call("dedicated", null, 300)], answers: [
        answer(NET.N1, "HW-S", 0.9), answer(NET.N2, "HW", 0.85), answer(NET.N3, "CHW-S", 0.45), answer(NET.N4, "autre", 0.91),
        answer(NET.N5, "fond", 0.3), answer(OTHER.O2, "EU", 0.85), answer(OTHER.O3, "CHW", 0.4), answer(OTHER.O4, "autre", 0.95),
      ] },
      candidates: { selected: [NET.N1, NET.N2, NET.N3, NET.N4, NET.N5, OTHER.O2, OTHER.O3, OTHER.O4], eligible: 8, left_out: 0,
        filtered: [{ group: NET.N6, reason: "grey" }, { group: OTHER.O1, reason: "grey" }] },
    }] },
    { id: "b-plan-02", pages: [{ page: 1, status: "failed", reading: null }] },
    { id: "d-plan-04", pages: [{ page: 1, status: "ok", reading: { groups: [g(NET.N1)] }, decisions: { calls: [call("batch", 2000, 4000)], answers: [] },
      candidates: { selected: [NET.N1], eligible: 1, left_out: 0, filtered: [] } }] },
  ],
};

const SET = { sha256: "a".repeat(64), files: 3, groups: 15, documents: TRUTH };

describe("per-group score of the bench (TI-704, group-score.ts scoreGroupTruth)", () => {
  it("counts found, proposed, refused and left « à revoir » networks at exact and parent level", () => {
    const score = scoreGroupTruth({ passes: [PASS], truth: SET });
    expect(score).toMatchObject({ threshold: 0.5, truth: { sha256: "a".repeat(64), files: 3, groups: 15, documents_not_run: ["c-plan-03"] } });
    const [pass] = score.passes;
    const a = pass.documents.find((entry) => entry.document === "a-plan-01");
    expect(a).toMatchObject({
      groups: 12, networks: 8, non_networks: 4, not_read: 1,
      candidates: { selected: 8, networks_selected: 5, networks_filtered: 1, non_networks_selected: 3, non_networks_filtered: 1, unrecorded: 0,
        filtered_by_reason: { grey: 2 } },
      networks_found: { exact: 2, parent: 3 },
      networks_proposed: { exact: 0, parent: 1 },
      decisions_on_networks: { answers: 5, exact: 1, parent: 3, wrong_network: 0, autre: 1, other_non_network: 1 },
      non_networks_as_network: { classified: 1, proposed: 1 },
      to_review: { networks: 3, non_networks: 2 },
      precision: { classified: 4, exact: 0.5, parent: 0.75 },
    });
    const b = pass.documents.find((entry) => entry.document === "b-plan-02");
    expect(b).toMatchObject({ groups: 2, networks: 1, non_networks: 1, not_read: 2, to_review: { networks: 0, non_networks: 0 },
      candidates: { selected: 0, unrecorded: 0 }, precision: { classified: 0, exact: null, parent: null } });
    expect(pass.total).toMatchObject({ groups: 14, networks: 9, non_networks: 5, not_read: 3, networks_found: { exact: 2, parent: 3 },
      candidates: { networks_filtered: 1, filtered_by_reason: { grey: 2 } }, precision: { classified: 4, exact: 0.5, parent: 0.75 } });
    // Only truth documents count: d-plan-04 has no truth.
    expect(pass.documents.map((entry) => entry.document)).toEqual(["a-plan-01", "b-plan-02"]);
  });

  it("bands the Decisions answers by confidence, 0.8 in the classified band, precision over the network proposals", () => {
    const [pass] = scoreGroupTruth({ passes: [PASS], truth: SET }).passes;
    expect(pass.bands.map((band) => band.band)).toEqual(["[0 ; 0,5[", "[0,5 ; 0,6[", "[0,6 ; 0,7[", "[0,7 ; 0,8[", "[0,8 ; 1]"]);
    expect(pass.bands[0]).toMatchObject({ answers: 3, network_proposals: 2, exact: 0, parent: 1, on_non_networks: 1, true_networks: 2,
      true_networks_answered_non_network: 1, true_networks_answered_autre: 0, precision_exact: 0 });
    expect(pass.bands[1]).toMatchObject({ answers: 0, network_proposals: 0, precision_exact: null });
    expect(pass.bands[2]).toMatchObject({ answers: 0, network_proposals: 0, exact: 0, parent: 0, true_networks: 0 });
    expect(pass.bands[4]).toMatchObject({ answers: 5, network_proposals: 3, exact: 1, parent: 2, on_non_networks: 1, true_networks: 3,
      true_networks_answered_non_network: 1, true_networks_answered_autre: 1 });
    expect(pass.bands[4].precision_exact).toBeCloseTo(1 / 3, 6);
  });

  it("counts as not read, in a later pass, the truth groups of a document that pass stopped before", () => {
    const stopped: GroupScorePassInput = { pass: 2, documents: PASS.documents.filter((document) => document.id !== "a-plan-01") };
    const score = scoreGroupTruth({ passes: [PASS, stopped], truth: SET });
    expect(score.truth.documents_not_run).toEqual(["c-plan-03"]);
    expect(score.passes[1].documents.find((entry) => entry.document === "a-plan-01")).toMatchObject({ groups: 12, not_read: 12, networks_found: { exact: 0 } });
    expect(score.passes[1].total).toMatchObject({ groups: 14, not_read: 14 });
  });

  it("takes calls, tokens and latency over every page the run read, per page", () => {
    const [pass] = scoreGroupTruth({ passes: [PASS], truth: SET }).passes;
    expect(pass.pages).toEqual([
      { document: "a-plan-01", page: 1, candidates: 8, calls: 3, tokens: 1500, latency_ms: 3300 },
      { document: "b-plan-02", page: 1, candidates: null, calls: 0, tokens: 0, latency_ms: 0 },
      { document: "d-plan-04", page: 1, candidates: 1, calls: 1, tokens: 2000, latency_ms: 4000 },
    ]);
    expect(pass.cost).toMatchObject({ pages: 3, calls: 4, tokens: 3500, latency_ms: 7300, call_latency_ms: { p50: 1000, p95: 4000 } });
    expect(pass.cost.calls_per_page).toBeCloseTo(4 / 3, 6);
    expect(pass.cost.tokens_per_page).toBeCloseTo(3500 / 3, 6);
  });

  it("renders shares and counts, never a group id, colour or class of the truth", () => {
    const lines = renderGroupScoreSection(scoreGroupTruth({ passes: [PASS], truth: SET })).join("\n");
    expect(lines).toContain("Score par groupe");
    expect(lines).toContain("a".repeat(64));
    expect(lines).not.toMatch(/#ff0000|c:#|HW-S/);
  });
});

describe("truth directory of the per-group score (group-score.ts loadGroupTruthDirectory)", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  function manifestDocument(id: string, pages = 1): ManifestDocument {
    const [lot, kind] = id.split("-");
    return ManifestDocumentSchema.parse({
      id, lot, kind, drive_id: `fixture-${id}`, original_title: `Fictional ${id}`, project: null, file_type: "pdf",
      file_size: 100, modified_time: "2026-01-06T10:00:00.000Z", raw_status: "binary", raw_path: `raw/${id}.pdf`,
      sha256: "0".repeat(64), structure_check: { status: "passed", method: "fixture", detail: null }, pages,
      format: "A3", scale: "1/50", index: "A", vector: true, ocg_count: 0, level: null, zone: null, role: "truth",
      duplicate_of: null, notes: null,
    });
  }

  async function directory(files: Record<string, unknown>) {
    const root = await mkdtemp(path.join(os.tmpdir(), "group-truth-"));
    roots.push(root);
    const dir = path.join(root, "labels");
    await mkdir(dir);
    for (const [name, value] of Object.entries(files)) await writeFile(path.join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
    return { root, dir };
  }

  const manifest = { documents: [manifestDocument("a-plan-01", 2), manifestDocument("b-plan-02")] };
  const good = { schema_version: 1, document: "a-plan-01", groups: [{ page: 1, group: NET.N1, class: "HW-S", note: "fictional" }] };

  it("loads the checked files with the hash of the directory's own JSON files, a README beside them", async () => {
    const { root, dir } = await directory({ "a-plan-01.json": good, "LISEZMOI.md": "Fictional labels." });
    const loaded = await loadGroupTruthDirectory(dir, { datasetRoot: path.join(root, "dataset"), manifest });
    expect(loaded).toMatchObject({ files: 1, groups: 1 });
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.documents.get("a-plan-01")?.groups[0].class).toBe("HW-S");
    const changed = await directory({ "a-plan-01.json": { ...good, groups: [{ ...good.groups[0], class: "HW-R" }] } });
    expect((await loadGroupTruthDirectory(changed.dir, { datasetRoot: path.join(changed.root, "dataset"), manifest })).sha256).not.toBe(loaded.sha256);
    const moved = await directory({ "a-plan-01.json": good, "notes.txt": "other" });
    expect((await loadGroupTruthDirectory(moved.dir, { datasetRoot: path.join(moved.root, "dataset"), manifest })).sha256).toBe(loaded.sha256);
  });

  it("refuses the files truth/groups would refuse, and a directory inside the dataset", async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ "a-plan-01.json": { ...good, groups: [{ page: 1, group: NET.N1, class: "chauffage" }] } }, /unknown class chauffage/],
      [{ "a-plan-01.json": { ...good, groups: [good.groups[0], good.groups[0]] } }, /listed twice/],
      [{ "a-plan-09.json": { ...good, document: "a-plan-09" } }, /not in the manifest/],
      [{ "a-plan-01.json": { ...good, document: "b-plan-02" } }, /named/],
      [{ "a-plan-01.json": { ...good, groups: [{ page: 3, group: NET.N1, class: "EF" }] } }, /beyond the 2 pages/],
      [{ "a-plan-01.json": "{ not json" }, /invalid JSON/],
    ];
    for (const [files, message] of cases) {
      const { root, dir } = await directory(files);
      await expect(loadGroupTruthDirectory(dir, { datasetRoot: path.join(root, "dataset"), manifest })).rejects.toThrow(message);
    }
    const { root, dir } = await directory({ "a-plan-01.json": good });
    await expect(loadGroupTruthDirectory(dir, { datasetRoot: root, manifest })).rejects.toBeInstanceOf(BenchDatasetError);
    await expect(loadGroupTruthDirectory(dir, { datasetRoot: root, manifest })).rejects.toThrow(/inside the dataset/);
  });
});
