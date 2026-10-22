import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { __testing__ } from "@/lib/estimates/source-reference-pdf";
import { makePagePdf } from "@/test/fixtures/source-reference-pdf/pdf-fixtures";

// Written before product implementation; lifecycle gaps are documented in source-reference-pdf.md.
// W1..W6 need real thread-exit evidence; normal HTTP cases remain E2E.
type Observation = { worker: Worker; initialThreadId: number; exitCode: number | null; exited: boolean };
const observations: Observation[] = [];
const hash = (bytes: ArrayBuffer) => createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
const workerFixture = fileURLToPath(new URL("../../test/fixtures/source-reference-pdf/fixture-worker.mjs", import.meta.url));

function observe(worker: Worker) {
  const observation: Observation = { worker, initialThreadId: worker.threadId, exitCode: null, exited: false };
  worker.once("exit", (code) => { observation.exitCode = code; observation.exited = true; });
  observations.push(observation);
  return observation;
}

function fixtureFactory(mode: string) {
  const startedBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const started = new Int32Array(startedBuffer);
  let observation: Observation | null = null;
  return {
    started,
    get observation() {
      if (!observation) throw new Error("Expected real worker was not created");
      return observation;
    },
    createWorker(bytes: ArrayBuffer) {
      const worker = new Worker(workerFixture, {
        workerData: { bytes, mode, started: startedBuffer },
        transferList: [bytes],
        resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
      });
      observation = observe(worker);
      return worker;
    },
  };
}

async function awaitActualStart(state: ReturnType<typeof fixtureFactory>) {
  const deadline = performance.now() + 1500;
  while (Atomics.load(state.started, 0) === 0) {
    if (state.observation.exited || performance.now() >= deadline) throw new Error("Worker did not start inside fixture setup budget");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function assertEnded(observation: Observation) {
  expect(observation.initialThreadId).toBeGreaterThan(0);
  expect(observation.exited).toBe(true);
  expect(observation.exitCode).toEqual(expect.any(Number));
  expect(observation.worker.threadId).toBe(-1);
}

afterEach(async () => {
  await Promise.all(observations.splice(0).map(async ({ worker }) => {
    if (worker.threadId !== -1) await worker.terminate();
  }));
});

describe("source reference PDF worker lifecycle", () => {
  it("terminates a real CPU loop before timeout rejection while the parent stays responsive", async () => {
    const state = fixtureFactory("cpu-loop");
    const input = await makePagePdf(1);
    const task = __testing__.runSourceReferencePdfWorker(input, { timeoutMs: 2000, createWorker: state.createWorker });
    const rejected = expect(task).rejects.toMatchObject({ code: "PDF_TIMEOUT", requiresSourceRead: true });
    await awaitActualStart(state);
    expect(input.byteLength).toBe(0);
    let ticks = 0;
    const heartbeat = setInterval(() => { ticks += 1; }, 10);
    try { await rejected; } finally { clearInterval(heartbeat); }
    expect(ticks).toBeGreaterThan(0);
    assertEnded(state.observation);
  }, 10_000);

  it("terminates a non-cooperative parser on abort before rejecting", async () => {
    const state = fixtureFactory("cpu-loop");
    const controller = new AbortController();
    const input = await makePagePdf(1);
    const task = __testing__.runSourceReferencePdfWorker(input, { timeoutMs: 2000, signal: controller.signal, createWorker: state.createWorker });
    const rejected = expect(task).rejects.toMatchObject({ code: "PDF_ABORTED", requiresSourceRead: true });
    await awaitActualStart(state);
    controller.abort();
    await rejected;
    expect(input.byteLength).toBe(0);
    assertEnded(state.observation);
  }, 10_000);

  it.each(["crash", "empty-exit"])("rejects %s without leaking private parser information or leaving a worker", async (mode) => {
    const state = fixtureFactory(mode);
    const input = await makePagePdf(1);
    let caught: unknown;
    try {
      await __testing__.runSourceReferencePdfWorker(input, { timeoutMs: 2000, createWorker: state.createWorker });
    } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: "PDF_WORKER_FAILURE", requiresSourceRead: true });
    expect(String(caught)).not.toContain("PRIVATE_PARSER_PATH");
    expect(String(caught)).not.toContain("C:\\private");
    assertEnded(state.observation);
  }, 10_000);

  it.each([
    "wrong-ok", "zero-pages", "too-many-pages", "fractional-pages", "nonfinite-pages",
    "wrong-length", "wrong-buffer", "extra-field", "unknown-error", "tampered-bytes",
  ])("rejects invalid worker protocol %s and terminates before settlement", async (mode) => {
    const state = fixtureFactory(mode);
    await expect(__testing__.runSourceReferencePdfWorker(await makePagePdf(1), {
      timeoutMs: 2000, createWorker: state.createWorker,
    })).rejects.toMatchObject({ code: "PDF_WORKER_PROTOCOL", requiresSourceRead: true });
    assertEnded(state.observation);
  }, 10_000);

  it("returns transferred bytes unchanged and terminates even after a valid reply followed by CPU loop", async () => {
    const state = fixtureFactory("success-loop");
    const input = await makePagePdf(1);
    const size = input.byteLength, digest = hash(input);
    const result = await __testing__.runSourceReferencePdfWorker(input, { timeoutMs: 2000, createWorker: state.createWorker });
    expect(input.byteLength).toBe(0);
    expect(result.byteSize).toBe(size);
    expect(result.pageCount).toBe(1);
    expect(result.bytes.byteLength).toBe(size);
    expect(hash(result.bytes)).toBe(digest);
    assertEnded(state.observation);
  }, 10_000);

  it("preserves a known parser refusal while terminating its uncooperative worker", async () => {
    const state = fixtureFactory("known-parser-error");
    await expect(__testing__.runSourceReferencePdfWorker(await makePagePdf(1), {
      timeoutMs: 2000, createWorker: state.createWorker,
    })).rejects.toMatchObject({ code: "PDF_INVALID", requiresSourceRead: true });
    assertEnded(state.observation);
  }, 10_000);

  it("uses the real parser and returns exact original bytes after the actual worker has exited", async () => {
    const input = await makePagePdf(1);
    const size = input.byteLength, digest = hash(input);
    let observation: Observation | null = null;
    const result = await __testing__.runSourceReferencePdfWorker(input, {
      timeoutMs: 5000,
      createWorker(bytes: ArrayBuffer) {
        const worker = __testing__.createSourceReferencePdfWorker(bytes);
        observation = observe(worker);
        expect(worker.resourceLimits?.maxOldGenerationSizeMb).toBe(256);
        return worker;
      },
    });
    expect(input.byteLength).toBe(0);
    expect(result.pageCount).toBe(1);
    expect(result.byteSize).toBe(size);
    expect(hash(result.bytes)).toBe(digest);
    if (!observation) throw new Error("Real parser worker was not observed");
    assertEnded(observation);
  }, 10_000);

  it("lets takeoff inspect a valid PDF beyond the source-review page limit", async () => {
    const bytes = await makePagePdf(201);
    const result = await __testing__.runSourceReferencePdfWorker(bytes, {
      timeoutMs: 5000,
      maxPages: 201,
      strictObjectValidation: false,
    });
    expect(result.pageCount).toBe(201);
  }, 10_000);
});
