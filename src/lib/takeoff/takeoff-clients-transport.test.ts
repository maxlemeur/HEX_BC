import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TakeoffApiError } from "@/lib/takeoff/client-http";
import { createCountMarksReader } from "@/lib/takeoff/count-marks-client";
import {
  fetchFrozenItemSelection,
  fetchItemHistory,
  fetchItemLine,
  fetchItemMeasureReadings,
  fetchItemTable,
  fetchMeasureReview,
  fetchUnlistedFinds,
  previewItemRemeasure,
  sendEntryScope,
  sendFindDecision,
  sendItemRemeasure,
  sendItemReviewCommand,
  sendMeasureRetention,
} from "@/lib/takeoff/item-table-client";
import { readItemTableAddress } from "@/lib/takeoff/item-table-query";
import {
  fetchTakeoffJobPlanLocations,
  fetchTakeoffPlanFileLocation,
  saveTakeoffPlanFileLocation,
} from "@/lib/takeoff/plan-location-client";
import { fetchTakeoffRequestActivity } from "@/lib/takeoff/request-activity-client";

// What the browser clients of the takeoff send to fetch, and the TakeoffApiError they answer when the request fails or
// the server refuses it. Pins the transport of the four clients before they share one helper.

type Case = {
  name: string;
  run: () => Promise<unknown>;
  path: string;
  init: Record<string, unknown>;
  timeoutMs: number;
  failure: string;
};

const PROJECT = "p/1";
const ITEM = "i 2";
const command = { kind: "command", value: 1 };
const READ_ITEMS = "Impossible de lire les postes du métré.";
const WRITE_ITEMS = "Impossible d’enregistrer la décision sur les postes.";
const READ_MARKS = "Impossible de lire les repères du poste.";
const WRITE_MARKS = "Impossible d’enregistrer les repères du poste.";
const ITEMS = "/api/affaires/p%2F1/takeoff/items";
const MARKS = "/api/affaires/p%2F1/takeoff/count-marks";
const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" };
const ACCEPT = { accept: "application/json" };
const get = (extra: Record<string, unknown> = {}) => ({ credentials: "same-origin", method: "GET", headers: ACCEPT, ...extra });
const post = (body: unknown, extra: Record<string, unknown> = {}) =>
  ({ credentials: "same-origin", method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body), ...extra });
const never = <T,>(value: unknown) => value as T;

const cases: Case[] = [
  {
    name: "fetchItemTable", run: () => fetchItemTable(PROJECT, readItemTableAddress(new URLSearchParams("plan=P1&offset=50")), true),
    path: `${ITEMS}?plan=P1&offset=50&detail=1`, init: get(), timeoutMs: 10_000, failure: READ_ITEMS,
  },
  {
    name: "fetchItemTable without parameters", run: () => fetchItemTable(PROJECT, readItemTableAddress(new URLSearchParams(""))),
    path: ITEMS, init: get(), timeoutMs: 10_000, failure: READ_ITEMS,
  },
  {
    name: "fetchMeasureReview", run: () => fetchMeasureReview(PROJECT, "a/3"),
    path: `${ITEMS}/measures/a%2F3`, init: get({ cache: "no-store" }), timeoutMs: 10_000, failure: READ_ITEMS,
  },
  {
    name: "sendMeasureRetention", run: () => sendMeasureRetention(PROJECT, "a/3", never(command)),
    path: `${ITEMS}/measures/a%2F3`, init: post(command), timeoutMs: 60_000, failure: WRITE_ITEMS,
  },
  {
    name: "fetchItemHistory", run: () => fetchItemHistory(PROJECT, ITEM, { offset: 20, limit: 10 }),
    path: `${ITEMS}/i%202/history?offset=20&limit=10`, init: get(), timeoutMs: 10_000, failure: READ_ITEMS,
  },
  {
    name: "fetchItemLine", run: () => fetchItemLine(PROJECT, ITEM, true),
    path: `${ITEMS}/i%202?detail=1`, init: get(), timeoutMs: 10_000, failure: READ_ITEMS,
  },
  {
    name: "fetchFrozenItemSelection by items",
    run: () => fetchFrozenItemSelection(PROJECT, { kind: "affaire" }, { kind: "items", itemIds: ["a", "b"] }, true),
    path: `${ITEMS}/selection`,
    init: post({ command_version: 1, scope: { kind: "affaire" }, entry_plans: true, selection: { kind: "items", item_ids: ["a", "b"] } }),
    timeoutMs: 10_000, failure: READ_ITEMS,
  },
  {
    name: "fetchFrozenItemSelection by filter",
    run: () => fetchFrozenItemSelection(PROJECT, { kind: "affaire" }, { kind: "filter", filter: {} }),
    path: `${ITEMS}/selection`,
    init: post({ command_version: 1, scope: { kind: "affaire" }, selection: { kind: "filter", filter: {} } }),
    timeoutMs: 10_000, failure: READ_ITEMS,
  },
  {
    name: "sendEntryScope", run: () => sendEntryScope(PROJECT, ITEM, never(command)),
    path: `${ITEMS}/i%202/entry-scope`, init: post(command), timeoutMs: 60_000, failure: "Impossible de modifier la portée de la saisie.",
  },
  {
    name: "sendItemReviewCommand", run: () => sendItemReviewCommand(PROJECT, never(command)),
    path: `${ITEMS}/review`, init: post(command), timeoutMs: 60_000, failure: WRITE_ITEMS,
  },
  {
    name: "previewItemRemeasure", run: () => previewItemRemeasure(PROJECT, { kind: "affaire" }, ["a"], never({ revision: "r" })),
    path: `${ITEMS}/remeasure/preview`,
    init: post({ command_version: 1, scope: { kind: "affaire" }, item_ids: ["a"], seen: { revision: "r" } }),
    timeoutMs: 10_000, failure: "Impossible de préparer la nouvelle mesure.",
  },
  {
    name: "sendItemRemeasure", run: () => sendItemRemeasure(PROJECT, never(command)),
    path: `${ITEMS}/remeasure`, init: post(command), timeoutMs: 60_000, failure: "Impossible de demander la nouvelle mesure.",
  },
  {
    name: "fetchItemMeasureReadings", run: () => fetchItemMeasureReadings(PROJECT, "it", "pl", { jobId: "j", requestId: "r" }),
    path: `${ITEMS}/remeasure?item=it&plan=pl&jobId=j&requestId=r`, init: get({ cache: "no-store" }), timeoutMs: 10_000,
    failure: "Impossible de lire la dernière mesure de ce poste.",
  },
  {
    name: "fetchUnlistedFinds", run: () => fetchUnlistedFinds(PROJECT),
    path: `${ITEMS}/finds`, init: get({ cache: "no-store" }), timeoutMs: 10_000, failure: READ_ITEMS,
  },
  {
    name: "sendFindDecision", run: () => sendFindDecision(PROJECT, never(command)),
    path: `${ITEMS}/finds`, init: post(command), timeoutMs: 60_000, failure: WRITE_ITEMS,
  },
  {
    name: "count marks readPage",
    run: () => createCountMarksReader(PROJECT).readPage({ answerId: "a1", page: 2, after: "m9", states: ["placed", "removed"] as never, limit: 50 }),
    path: `${MARKS}?reponse=a1&page=2&apres=m9&etats=placed%2Cremoved&limite=50`, init: get({ cache: "no-store" }), timeoutMs: 10_000,
    failure: READ_MARKS,
  },
  {
    name: "count marks edit", run: () => createCountMarksReader(PROJECT).edit(never(command)),
    path: MARKS, init: post(command, { cache: "no-store" }), timeoutMs: 60_000, failure: WRITE_MARKS,
  },
  {
    name: "count marks readTargets", run: () => createCountMarksReader(PROJECT).readTargets({ answerId: "a1" }),
    path: `${MARKS}/targets?reponse=a1`, init: get({ cache: "no-store" }), timeoutMs: 10_000, failure: READ_MARKS,
  },
  {
    name: "count marks readHistory",
    run: () => createCountMarksReader(PROJECT).readHistory({ answerId: "a1", after: { revision: 4, ordinal: 7 }, limit: 25 }),
    path: `${MARKS}/history?reponse=a1&apresRevision=4&apresOrdre=7&limite=25`, init: get({ cache: "no-store" }), timeoutMs: 10_000,
    failure: READ_MARKS,
  },
  {
    name: "fetchTakeoffPlanFileLocation", run: () => fetchTakeoffPlanFileLocation("s/1", "f 2"),
    path: "/api/takeoff/plan-sets/s%2F1/files/f%202/location", init: get(), timeoutMs: 45_000,
    failure: "Impossible de lire la localisation de ce plan.",
  },
  {
    name: "saveTakeoffPlanFileLocation", run: () => saveTakeoffPlanFileLocation("s/1", "f 2", never(command)),
    path: "/api/takeoff/plan-sets/s%2F1/files/f%202/location",
    init: { credentials: "same-origin", method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(command) }, timeoutMs: 60_000,
    failure: "Impossible d’enregistrer la localisation de ce plan.",
  },
  {
    name: "fetchTakeoffJobPlanLocations", run: () => fetchTakeoffJobPlanLocations("j/1"),
    path: "/api/takeoff/jobs/j%2F1/plan-locations", init: get(), timeoutMs: 90_000,
    failure: "Impossible de lire la localisation des plans de ce métré.",
  },
  {
    name: "fetchTakeoffRequestActivity",
    run: () => fetchTakeoffRequestActivity("p1", { view: "dossier" as never, requestId: "r1", jobId: "j1", offset: 5, limit: 9,
      dossierSeen: "d", actionSeen: "a", actionSeenAt: "t" }),
    path: "/api/takeoff/activity-center/requests?project_id=p1&view=dossier&requestId=r1&jobId=j1&offset=5&limit=9&dossierSeen=d&actionSeen=a&actionSeenAt=t",
    init: get(), timeoutMs: 10_000, failure: "Impossible de lire l’avancement du métré.",
  },
  {
    name: "fetchTakeoffRequestActivity with no option", run: () => fetchTakeoffRequestActivity("p1", { view: "dossier" as never }),
    path: "/api/takeoff/activity-center/requests?project_id=p1&view=dossier", init: get(), timeoutMs: 10_000,
    failure: "Impossible de lire l’avancement du métré.",
  },
];

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function caught(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TakeoffApiError);
    const failure = error as TakeoffApiError;
    return { message: failure.message, status: failure.status, details: failure.details, code: failure.code };
  }
  throw new Error("expected a TakeoffApiError");
}

describe("takeoff browser clients transport", () => {
  const fetchMock = vi.fn<(path: string, init: RequestInit) => Promise<Response>>();
  let timeouts: number[];

  beforeEach(() => {
    timeouts = [];
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      return timeout(ms);
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe.each(cases)("$name", (entry) => {
    it("sends its path and request init, with a timeout signal", async () => {
      fetchMock.mockResolvedValue(respond(409, { ok: false, error: { message: "Refus", code: "CODE", details: { reason: "x" } } }));
      await caught(entry.run());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [path, init] = fetchMock.mock.calls[0];
      expect(path).toBe(entry.path);
      const { signal, ...rest } = init;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(rest).toStrictEqual(entry.init);
      expect(timeouts).toEqual([entry.timeoutMs]);
    });

    it("answers the server's refusal with its message, status, code and details", async () => {
      fetchMock.mockResolvedValue(respond(409, { ok: false, error: { message: "Refus", code: "CODE", details: { reason: "x" } } }));
      expect(await caught(entry.run())).toEqual({ message: "Refus", status: 409, details: { reason: "x" }, code: "CODE" });
    });

    it("answers its own sentence when the refusal has no message", async () => {
      fetchMock.mockResolvedValue(respond(500, { ok: false, error: { message: "  ", code: 7 } }));
      expect(await caught(entry.run())).toEqual({ message: entry.failure, status: 500, details: null, code: null });
    });

    it("answers its own sentence on a success status without an ok envelope", async () => {
      fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
      expect(await caught(entry.run())).toEqual({ message: entry.failure, status: 200, details: null, code: null });
    });

    it("answers its own sentence with status 0 when fetch rejects", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      expect(await caught(entry.run())).toEqual({ message: entry.failure, status: 0, details: null, code: null });
    });

    it("answers its own sentence when the data breaks the contract", async () => {
      fetchMock.mockResolvedValue(respond(200, { ok: true, data: "not the contract" }));
      expect(await caught(entry.run())).toEqual({ message: entry.failure, status: 200, details: null, code: null });
    });
  });
});
