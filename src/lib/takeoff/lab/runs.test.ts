import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LAB_VECTOR_TASK_ID, type LabConfigResult, type LabRun } from "@/lib/takeoff/lab/contracts";
import type { LabDocument } from "@/lib/takeoff/lab/dataset";
import { decisionsBudget, executeLabRun } from "@/lib/takeoff/lab/runs";
import { findLabTask } from "@/lib/takeoff/lab/tasks";
import type { VectorGroupsConfig } from "@/lib/takeoff/lab/vectors";

// Ways the lab's Decisions ceiling (runs.ts, TAKEOFF_LAB_DECISIONS_MAX_TOKENS)
// could be miscounted or overrun, written before the fix. A browser cannot
// time a second essai into the window between a budget read and the
// single-essai lock, nor send a « classe de calque » essai that makes no call
// or whose call fails without usage (the army fixture always answers with
// usage), so the arithmetic and the race are checked here:
// - the budget is read before the single-essai lock: a second essai launched
//   from another tab while the first runs, whose read precedes the first's
//   write, runs with the stale remainder and the total passes the ceiling by
//   the first essai's whole usage;
// - « appels sans usage » counts a « classe de calque » configuration without
//   usage as one call, though it sent none (page classified by keywords,
//   raster page, no canvas, a first start refused by the ceiling), and does
//   not count a call of its call log that failed without usage when another
//   call of the same essai had one.
// Decisions and the vector configuration are fakes (no network, no child
// process); the runs are written to a temporary output directory.

vi.mock("@/lib/ai/decisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/decisions")>()),
  getOpenAiDecisionsCapability: () => ({ status: "available", model: "gpt-6-luna", billing: "separate_api", message: "" }),
  callOpenAiDecisions: () => { throw new Error("The lab's run test never calls Decisions."); },
}));

const DOCUMENT: LabDocument = {
  summary: { id: "fixture-run-test", source: "fixture", label: "Plan fictif", pages: 1, truth: null },
  bytes: Buffer.from("%PDF-fictional"), sha256: "b".repeat(64),
};
vi.mock("@/lib/takeoff/lab/dataset", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/takeoff/lab/dataset")>()),
  readLabDocument: async () => DOCUMENT,
}));

/** Holds the next listing of the runs, once read, until released (the budget read of a second essai); `reached` says it is held. */
const listing = vi.hoisted(() => ({ hold: null as Promise<void> | null, reached: () => {} }));
vi.mock("@/lib/takeoff/lab/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/takeoff/lab/storage")>();
  return {
    ...actual,
    listJsonFiles: async (directory: string) => {
      const files = await actual.listJsonFiles(directory);
      const hold = listing.hold;
      listing.hold = null;
      if (hold) {
        listing.reached();
        await hold;
      }
      return files;
    },
  };
});

const vectorConfig = vi.hoisted(() => ({ calls: [] as Array<{ remainingTokens: number; finish: (usage: number) => void }> }));
vi.mock("@/lib/takeoff/lab/vectors", () => ({
  runVectorGroupsConfig: (input: { remainingTokens: number }) => new Promise<VectorGroupsConfig>((resolve) => {
    vectorConfig.calls.push({ remainingTokens: input.remainingTokens, finish: (usage) => resolve({
      status: "ok", message: null, latency_ms: 1, usage: { input: usage, output: 0, reasoning: 0, total: usage }, raw: JSON.stringify({ calls: [] }),
      answers: [], elements: [], stop: null,
    }) });
  }),
}));

const CAP = 1_000;
const ACCESS = { owner: { userId: "user-fixture", tenantId: "tenant-fixture" }, email: null };
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lab-runs-test-"));
  vi.stubEnv("TAKEOFF_LAB_DATASET_DIR", path.join(root, "dataset"));
  vi.stubEnv("TAKEOFF_LAB_OUTPUT_DIR", path.join(root, "output"));
  vi.stubEnv("TAKEOFF_LAB_DECISIONS_MAX_TOKENS", String(CAP));
  await mkdir(path.join(root, "output"), { recursive: true });
  vectorConfig.calls = [];
  listing.hold = null;
  listing.reached = () => {};
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function essai() {
  const task = findLabTask(LAB_VECTOR_TASK_ID)!;
  return executeLabRun(ACCESS, { documentId: DOCUMENT.summary.id, campaign: "essai-test", taskId: task.id, crop: null,
    prompt: task.defaultPrompt, configs: [{ provider: "decisions" }], image: null });
}

async function until(condition: () => boolean) {
  for (let turn = 0; turn < 200 && !condition(); turn += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  expect(condition()).toBe(true);
}

describe("lab Decisions ceiling (runs.ts)", () => {
  it("never lets a second essai run on a remainder read before the first essai's usage was written", async () => {
    const first = essai();
    await until(() => vectorConfig.calls.length === 1);
    expect(vectorConfig.calls[0].remainingTokens).toBe(CAP);
    // The second essai's budget read lists the runs while the first runs (not written yet), and returns once released.
    let release!: () => void;
    let held = false;
    listing.hold = new Promise<void>((resolve) => { release = resolve; });
    listing.reached = () => { held = true; };
    let settled: { error: unknown } | null = null;
    const second = essai().then(() => null, (error: unknown) => { settled = { error }; return null; });
    await until(() => held || settled !== null);
    vectorConfig.calls[0].finish(900);
    await first;
    release();
    listing.hold = null;
    await until(() => vectorConfig.calls.length === 2 || settled !== null);
    if (settled === null) {
      // It runs: on what the first essai left, never on the stale remainder.
      expect(vectorConfig.calls[1].remainingTokens).toBe(CAP - 900);
      vectorConfig.calls[1].finish(1);
    } else {
      expect(settled).toMatchObject({ error: { code: "TAKEOFF_LAB_BUSY" } });
    }
    await second;
    // The lock is released on every path: a third essai runs on what is left.
    const count = vectorConfig.calls.length;
    const third = essai();
    await until(() => vectorConfig.calls.length === count + 1);
    expect(vectorConfig.calls.at(-1)!.remainingTokens).toBeLessThanOrEqual(CAP - 900);
    vectorConfig.calls.at(-1)!.finish(1);
    await third;
  });

  it("releases the lock when the budget refuses the essai", async () => {
    vi.stubEnv("TAKEOFF_LAB_DECISIONS_MAX_TOKENS", "0");
    await expect(essai()).rejects.toMatchObject({ code: "TAKEOFF_LAB_DECISIONS" });
    vi.stubEnv("TAKEOFF_LAB_DECISIONS_MAX_TOKENS", String(CAP));
    const next = essai();
    await until(() => vectorConfig.calls.length === 1);
    vectorConfig.calls[0].finish(1);
    await expect(next).resolves.toMatchObject({ status: "complete" });
  });
});

function vectorRun(config: Partial<LabConfigResult>): LabRun {
  return {
    schema_version: 1, id: "r", created_at: "2026-11-03T10:00:00.000Z", author: { user_id: "u", email: null }, campaign: "c",
    task: { id: LAB_VECTOR_TASK_ID, kind: "choice", label: "Classe de calque" },
    document: { id: "d", source: "fixture", sha256: "c".repeat(64), pages: 1 }, crop: null,
    prompt: { text: "p", base: null, sha256: "s", version: "v" }, status: "complete", stop: null,
    configs: [{ id: "A", provider: "decisions", model: "gpt-6-luna", reasoning_effort: null, status: "ok", message: null, latency_ms: null,
      usage: null, raw: null, schema_error: null, answers: [], score: null, elements: [], ...config }],
  };
}

const usage = (total: number) => ({ input_tokens: total, output_tokens: 0, total_tokens: total });

describe("lab Decisions budget (runs.ts decisionsBudget)", () => {
  it("counts a « classe de calque » essai's calls without usage from its call log", () => {
    const runs = [
      // Page classified by keywords: no call sent.
      vectorRun({ status: "ok", raw: JSON.stringify({ candidates: 0, calls: [], results: [] }) }),
      // A first start refused by the ceiling: no call sent.
      vectorRun({ status: "failed", raw: JSON.stringify({ candidates: 3, stop: { reason: "budget_reached" }, calls: [], results: [] }) }),
      // A batch call with usage, then a dedicated call that failed without usage.
      vectorRun({ status: "partial", usage: { input: 900, output: 100, reasoning: 0, total: 1000 },
        raw: JSON.stringify({ calls: [{ kind: "batch", usage: usage(1000) }, { kind: "dedicated", usage: null }], results: [] }) }),
    ];
    expect(decisionsBudget(runs, 5000)).toEqual({ cap: 5000, used: 1000, remaining: 4000, calls_without_usage: 1 });
  });

  it("keeps one call per configuration without usage for the other tasks", () => {
    const run = vectorRun({ status: "failed", raw: JSON.stringify({ status: "failed" }) });
    const other: LabRun = { ...run, task: { id: "type-de-page", kind: "choice", label: "Type de page" } };
    expect(decisionsBudget([other], null)).toEqual({ cap: null, used: 0, remaining: null, calls_without_usage: 1 });
  });
});
