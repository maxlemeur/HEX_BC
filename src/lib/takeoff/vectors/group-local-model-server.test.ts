import { describe, expect, it } from "vitest";

import type { VectorGroupKey, VectorPageExtraction, VectorPath } from "@/lib/takeoff/vectors/extraction";
import { decisionsOfOutcome, type GroupDecisionsRender } from "@/lib/takeoff/vectors/group-decisions-server";
import type { EvidenceImagePlan } from "@/lib/takeoff/vectors/group-evidence-images";
import type { GroupEvidenceImages, GroupImage } from "@/lib/takeoff/vectors/group-evidence-render-server";
import {
  classifyVectorGroupsLocal, GROUP_LOCAL_MODEL_CONCURRENCY, LocalGroupsRequestError, LocalGroupsStop, type LocalGroupsCall,
} from "@/lib/takeoff/vectors/group-local-model-server";
import { GROUP_LOCAL_MODEL_LIMITS } from "@/lib/takeoff/vectors/group-local-model";
import { readVectorPage } from "@/lib/takeoff/vectors/pipeline";

// Ways the local-mode classification (TI-704 option B,
// group-local-model-server.ts) could spend the plan or lose a class, written
// before the code. The plan and the drawing are fakes; pages are fictional.
// - a rule decides before the model (the band before it lost the direction);
// - more than 8 groups per request, the images out of the list's order, the
//   legend not first, the page drawn per request;
// - more than GROUP_LOCAL_MODEL_CONCURRENCY requests at once, a request after
//   a quota or a refused access, the job's check skipped;
// - a failed request loses its groups instead of their rules' class; a quota
//   stop loses the answers already given;
// - the plan never reached (a model the account lacks) leaves no rules either;
// - (review of 13/11) a group the model leaves out or answers twice gets no
//   class at all; a heavy page is cut at Decisions' 10 calls; the tokens of an
//   unreadable answer are lost; a request passes a call's image bytes; a page
//   after the job's stop draws or stops again.

const IMAGE: GroupImage = { mimeType: "image/jpeg", data: "AAAA", width: 10, height: 10, bytes: 3 };
const hex = (value: number) => value.toString(16).padStart(2, "0");

/** `count` groups of distinct colours, the first the longest; with `sameColour`, a layer EF and a stroke of its colour outside it. */
function page(count: number, sameColour = false): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (let index = 0; index < count; index += 1) {
    groups.push({ layer: null, color: `#${hex(30 + index)}00ff`, width: 0.01 * (index + 1), dash: null });
    paths.push({ group: index, start: coordinates.length / 2, count: 2, closed: false });
    coordinates.push(100, 10 + 1.5 * index, 1100 - index, 10 + 1.5 * index);
  }
  if (sameColour) {
    for (const [layer, y] of [["ef-layer", 700], [null, 740]] as const) {
      paths.push({ group: groups.length, start: coordinates.length / 2, count: 2, closed: false });
      groups.push({ layer, color: "#00a0a0", width: layer ? 0.3 : 0.6, dash: null });
      coordinates.push(100, y, 900, y);
    }
  }
  return {
    page: 1, pages: 1, width: 1190.55, height: 841.89, userUnit: 1, rotate: 0,
    layers: sameColour ? [{ id: "ef-layer", name: "FICTIF_EF", visible: true }] : [], groups, texts: [], paths, points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 }, memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

function fakeRender() {
  const sessions = { started: 0, cancelled: 0, plans: [] as Array<Omit<EvidenceImagePlan, "page">> };
  const render: GroupDecisionsRender = () => {
    sessions.started += 1;
    return {
      draw: async (plan): Promise<GroupEvidenceImages> => {
        sessions.plans.push(plan);
        return { legends: plan.legends.map(() => IMAGE), groups: plan.groups.map((_, index) => ({ ...IMAGE, data: `IMG${index}` })), issue: null,
          dropped_images: 0, render_ms: { page: 1, legends: [], groups: plan.groups.map(() => 1) }, duration_ms: 1 };
      },
      cancel: () => {
        sessions.cancelled += 1;
      },
    };
  };
  return { render, sessions };
}

/** Every group of a request at `classe` and `probabilite`; `fail(index)` makes request `index` throw. */
function fakeCall(classe: string, probabilite: number, fail: (index: number) => Error | null = () => null) {
  const requests: Array<{ aliases: string[]; images: string[] }> = [];
  let inFlight = 0, maxInFlight = 0;
  const call: LocalGroupsCall = async ({ prompt, images }) => {
    const index = requests.length;
    const aliases = [...prompt.matchAll(/"groupe":"(groupe_\d+)"/g)].map((match) => match[1]);
    requests.push({ aliases, images: images.map((image) => image.data) });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    const error = fail(index);
    if (error) throw error;
    return { data: { groupes: aliases.map((groupe) => ({ groupe, classe, probabilite })) }, totalTokens: 100 };
  };
  return { call, requests, maxInFlight: () => maxInFlight };
}

function run(extraction: VectorPageExtraction, call: LocalGroupsCall | LocalGroupsStop | null, render: GroupDecisionsRender, limits?: { maxRequests: number },
  beforeCall?: () => Promise<void>) {
  const reading = readVectorPage(extraction, { clock: () => 0 });
  return classifyVectorGroupsLocal({ bytes: new Uint8Array([37, 80, 68, 70]), extraction, reading, call, render, limits, beforeCall, clock: () => 0 });
}

describe("local-mode classification (group-local-model-server.ts, TI-704 option B)", () => {
  it("asks every candidate, the rules' groups too, 8 per request with their images in order, the page drawn once", async () => {
    const { call, requests, maxInFlight } = fakeCall("EU", 0.9);
    const { render, sessions } = fakeRender();
    const outcome = await run(page(30, true), call, render);
    expect(sessions).toMatchObject({ started: 1, cancelled: 0 });
    expect(sessions.plans[0].groups).toHaveLength(31);
    expect(requests.map((request) => request.aliases.length)).toEqual([8, 8, 8, 7]);
    expect(requests[0].images).toEqual(["IMG0", "IMG1", "IMG2", "IMG3", "IMG4", "IMG5", "IMG6", "IMG7"]);
    expect(maxInFlight()).toBeLessThanOrEqual(GROUP_LOCAL_MODEL_CONCURRENCY);
    // The same-colour group is the model's, never the rules'.
    expect(outcome.ruled).toEqual({ same_colour: 0, band: 0, propagated: 0 });
    expect(decisionsOfOutcome(outcome).get("c:#00a0a0|w:0.6|d:")).toEqual({ class: "EU", confidence: 0.9, source: "chatgpt" });
    expect(outcome.calls.map((entry) => [entry.questions, entry.status, entry.usage?.total_tokens])).toEqual([[8, "available", 100], [8, "available", 100],
      [8, "available", 100], [7, "available", 100]]);
  });

  it("keeps the rules' class for the groups of a failed request, and stops at a quota without losing the answers given", async () => {
    const failed = fakeCall("fond", 0.9, (index) => (index === 0 ? new Error("ChatGPT n’a pas terminé la demande.") : null));
    const outcome = await run(page(1, true), failed.call, fakeRender().render);
    expect(outcome.stop).toBeNull();
    expect(decisionsOfOutcome(outcome).get("c:#00a0a0|w:0.6|d:")).toEqual({ class: "EF", confidence: null, source: "rule" });
    // 41 groups, 6 requests: the first 4 leave together, the first fails on the quota, none starts after it.
    const quota = fakeCall("fond", 0.9, (index) => (index === 0 ? new LocalGroupsStop("local_quota", "Limite du forfait ChatGPT atteinte.") : null));
    const stopped = await run(page(40, true), quota.call, fakeRender().render, undefined);
    expect(stopped.stop).toMatchObject({ reason: "local_quota" });
    expect(quota.requests).toHaveLength(GROUP_LOCAL_MODEL_CONCURRENCY);
    expect([...stopped.answers.values()].filter((answer) => answer.via === "local" && answer.class === "fond").length).toBeGreaterThanOrEqual(8);
  });

  it("falls back on the rules without a call when the plan cannot start, or the page has no request left", async () => {
    const { render, sessions } = fakeRender();
    const unavailable = await run(page(3, true), new LocalGroupsStop("local_model_unavailable", "Modèle absent."), render);
    expect(unavailable.stop).toMatchObject({ reason: "local_model_unavailable" });
    expect(decisionsOfOutcome(unavailable).get("c:#00a0a0|w:0.6|d:")).toEqual({ class: "EF", confidence: null, source: "rule" });
    expect(sessions.started).toBe(0);
    const none = fakeCall("EU", 0.9);
    const capped = await run(page(3, true), none.call, render, { maxRequests: 0 });
    expect([none.requests.length, capped.left_out]).toEqual([0, 4]);
    expect(decisionsOfOutcome(capped).get("c:#00a0a0|w:0.6|d:")).toMatchObject({ source: "rule" });
  });

  it("sends a page's requests together (up to 4 at once), with the same outcome whatever order they finish in", async () => {
    /** Every group « fond » at 0.9 but request `wrong`'s groups « EU »; request i ends after `delays[i]` turns of the event loop. */
    const timed = (delays: readonly number[]) => {
      let inFlight = 0, maxInFlight = 0, started = 0;
      const call: LocalGroupsCall = async ({ prompt }) => {
        const index = started++;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        for (let turn = 0; turn < delays[index]; turn += 1) await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
        const aliases = [...prompt.matchAll(/"groupe":"(groupe_\d+)"/g)].map((match) => match[1]);
        return { data: { groupes: aliases.map((groupe) => ({ groupe, classe: index === 2 ? "EU" : "fond", probabilite: 0.9 })) }, totalTokens: 10 + index };
      };
      return { call, maxInFlight: () => maxInFlight };
    };
    const inOrder = timed([1, 2, 3, 4, 5]);
    const reversed = timed([9, 7, 5, 3, 1]);
    const first = await run(page(36), inOrder.call, fakeRender().render);
    const second = await run(page(36), reversed.call, fakeRender().render);
    // 4 at once, as measured (3 to 4 requests of about 10 s per heavy page): one after the other would add up their latencies.
    expect([GROUP_LOCAL_MODEL_CONCURRENCY, inOrder.maxInFlight(), reversed.maxInFlight()]).toEqual([4, 4, 4]);
    // The calls in the order of the list, the answers the same: never the order the plan answered in.
    expect(second.calls.map((entry) => entry.usage?.total_tokens)).toEqual([10, 11, 12, 13, 14]);
    expect([...decisionsOfOutcome(second)]).toEqual([...decisionsOfOutcome(first)]);
    expect([...second.answers.keys()]).toEqual([...first.answers.keys()]);
  });

  it("gives the rules' class to a group the model left out or answered twice, never to one it answered", async () => {
    const omitted: LocalGroupsCall = async ({ prompt }) => {
      const aliases = [...prompt.matchAll(/"groupe":"(groupe_\d+)"/g)].map((match) => match[1]);
      // The last group (the same-colour one) is left out of the answer, the first answered twice.
      return { data: { groupes: [...aliases.slice(0, -1).map((groupe) => ({ groupe, classe: "fond", probabilite: 0.9 })),
        { groupe: aliases[0], classe: "EU", probabilite: 0.9 }] }, totalTokens: 10 };
    };
    const outcome = await run(page(2, true), omitted, fakeRender().render);
    expect(decisionsOfOutcome(outcome).get("c:#00a0a0|w:0.6|d:")).toEqual({ class: "EF", confidence: null, source: "rule" });
    expect(outcome.ruled).toEqual({ same_colour: 1, band: 0, propagated: 0 });
    expect([...outcome.answers.values()].filter((answer) => answer.via === "local").map((answer) => answer.status)).toEqual(["invalid", "answered"]);
  });

  it("asks every candidate of a heavy page (no Decisions cap of 10 calls), within the requests its document has left", async () => {
    const all = fakeCall("fond", 0.9);
    await run(page(100), all.call, fakeRender().render);
    expect(all.requests).toHaveLength(13);
    const capped = fakeCall("fond", 0.9);
    const outcome = await run(page(100), capped.call, fakeRender().render, { maxRequests: 11 });
    expect([capped.requests.length, outcome.left_out]).toEqual([11, 12]);
    // At most 25 requests (200 groups) per page, as Decisions' 10 calls of 20: the images of one drawing stay bounded.
    const { render, sessions } = fakeRender();
    const crowded = fakeCall("fond", 0.9);
    const full = await run(page(210), crowded.call, render, { maxRequests: 40 });
    expect([GROUP_LOCAL_MODEL_LIMITS.requestsPerPage, crowded.requests.length, sessions.plans[0].groups.length, full.left_out]).toEqual([25, 25, 200, 10]);
  });

  it("keeps the tokens of an answer that could not be read, its groups to the rules", async () => {
    const unreadable: LocalGroupsCall = async () => {
      throw new LocalGroupsRequestError("Réponse ChatGPT illisible.", 9500);
    };
    const outcome = await run(page(1, true), unreadable, fakeRender().render);
    expect(outcome.stop).toBeNull();
    expect(outcome.calls.map((entry) => [entry.status, entry.usage?.total_tokens])).toEqual([["failed", 9500]]);
    expect(decisionsOfOutcome(outcome).get("c:#00a0a0|w:0.6|d:")).toEqual({ class: "EF", confidence: null, source: "rule" });
  });

  it("splits a request whose images pass a call's bytes, in the list's order", async () => {
    const heavy = "x".repeat(3 * 1024 * 1024);
    const render: GroupDecisionsRender = () => ({
      draw: async (plan) => ({ legends: plan.legends.map(() => IMAGE), groups: plan.groups.map(() => ({ ...IMAGE, data: heavy })), issue: null,
        dropped_images: 0, render_ms: { page: 1, legends: [], groups: plan.groups.map(() => 1) }, duration_ms: 1 }),
      cancel: () => {},
    });
    const { call, requests } = fakeCall("fond", 0.9);
    await run(page(8), call, render);
    expect(requests.map((request) => request.aliases.length)).toEqual([3, 3, 2]);
    expect(requests.every((request) => request.images.reduce((total, data) => total + data.length, 0) <= 10 * 1024 * 1024)).toBe(true);
    expect(requests.flatMap((request) => request.aliases)).toEqual(Array.from({ length: 8 }, (_, index) => `groupe_0${index + 1}`));
  });

  it("gives the rules' classes alone, without drawing nor stop, when no request may be sent (a page after the job's stop)", async () => {
    const { render, sessions } = fakeRender();
    const outcome = await run(page(3, true), null, render);
    expect([outcome.stop, sessions.started, outcome.calls.length]).toEqual([null, 0, 0]);
    expect(decisionsOfOutcome(outcome).get("c:#00a0a0|w:0.6|d:")).toEqual({ class: "EF", confidence: null, source: "rule" });
  });

  it("lets the job's own check stop the job, never a request after it", async () => {
    const { call, requests } = fakeCall("EU", 0.9);
    let checks = 0;
    await expect(run(page(40), call, fakeRender().render, undefined, async () => {
      checks += 1;
      if (checks === 2) throw new Error("Fictional lost lease.");
    })).rejects.toThrow("Fictional lost lease.");
    expect(requests.length).toBeLessThanOrEqual(1);
  });
});
