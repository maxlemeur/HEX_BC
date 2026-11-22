import { randomUUID } from "node:crypto";

import { apiRequest, recordEvidence } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { readCountAnswers, readSentInputs, seedCountMarks, setJobSent, setOwnerRole } from "./count-marks-support";
import { describe, expect, nativeTest as test } from "./native-ui";

// Lot 5, the counted marks of an item on its plan, through the routes the detail of an item calls
// (/api/affaires/{projectId}/takeoff/count-marks and …/history), on the owned stack: an affaire whose plan was read
// against its list and whose machine marks were published by the same attempt (count-marks-support.ts). An operator
// reads a page of marks and its count, corrects them in one command, meets the duplicate rule, a stale revision and a
// replay, reads the history; a member who may only read, a plan already sent and a page outside the reading are
// refused. Until a send verifies the marks revision, a quantity counted from marks is shown and never sent: the table of
// items, the job's rows and both send previews (the plan's and the items') answer the same before and after.
// Fictional values.

const options = { session: "army", trace: "off" as const, tags: ["critical", "local"], timeout: 240_000 };

type Envelope<T> = { ok: boolean; data: T; error?: { code?: string; message?: string } };
type MarksView = {
  revision: number; total: number; loaded: number; geometry: unknown; edit: { allowed: boolean; reason: string | null };
  marks: Array<{ markId: string; x: number; y: number; state: string; others: Array<{ answerId: string; state: string; revision: number }> }>;
  summary: { proposed: number; toAttribute: number; retained: number; reread: number; quantity: number | null; state: string;
    verifiedPages: number; scopePages: number };
};
type EditResult = { replayed: boolean; commandId: string; revisions: Record<string, number>; added: Array<{ key: string; markId: string }>;
  summaries: Record<string, MarksView["summary"]> };
type History = { events: Array<{ gesture: string; actorKind: string; actorId: string | null; reasonCode: string | null; page: number }>;
  next: { revision: number; ordinal: number } | null };

describe("Repères comptés d’un poste", () => {
  test("REPERES01 lit, corrige et retrace les repères d’un poste ; refuse un lecteur, un plan envoyé et une page non lue ; n’envoie rien",
    options, async ({ ui }) => {
      const { app, army } = ui;
      const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "REPERES" });
      const seeded = await seedCountMarks(owner, `${army.runPrefix}-REPERES`);
      const answers = await readCountAnswers(seeded.projectId);
      const basin = answers[seeded.basin]!;
      const valve = answers[seeded.valve]!;
      const base = `/api/affaires/${seeded.projectId}/takeoff/count-marks`;
      const read = (answerId: string, page: number, more = "") =>
        apiRequest<Envelope<MarksView>>(ui.browser, "GET", `${base}?reponse=${answerId}&page=${page}${more}`);
      const edit = (body: unknown) => apiRequest<Envelope<EditResult>>(ui.browser, "POST", base, body);

      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
      await waitForHydration(ui.browser);

      // The machine marks alone: proposed, to check, no quantity; the server's total apart from the number loaded.
      const first = await read(basin, 2);
      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({ revision: 1, total: 3, loaded: 3, edit: { allowed: true, reason: null },
        summary: { proposed: 3, toAttribute: 1, retained: 0, quantity: null, state: "to_check", scopePages: 2 } });
      const lot = await read(basin, 2, "&limite=2");
      expect(lot.body.data).toMatchObject({ total: 3, loaded: 2 });
      const [lav1, lav2, lav3] = [...first.body.data.marks].sort((a, b) => a.x - b.x);
      // The third object is also proposed for the valve, in the same reading.
      expect(lav3!.others).toEqual([expect.objectContaining({ answerId: valve, state: "proposed" })]);
      // A mark of one item may be given to the other items of the same reading, by their label in its list, whatever the
      // table of items shows (lot 5 follow-ups), each with the pages its answer read (both measured on pages 2 and 7).
      const destinations = await apiRequest<Envelope<{ answerId: string; targets: unknown[] }>>(ui.browser, "GET",
        `${base}/targets?reponse=${basin}`);
      expect(destinations.status).toBe(200);
      expect(destinations.body.data).toEqual({ answerId: basin, targets: [{ answerId: valve, itemId: seeded.valve, label: "Vanne",
        scopePages: [2, 7] }] });
      expect((await apiRequest<Envelope<{ targets: unknown[] }>>(ui.browser, "GET", `${base}/targets?reponse=${valve}`)).body.data.targets)
        .toEqual([{ answerId: basin, itemId: seeded.basin, label: "Lavabo", scopePages: [2, 7] }]);

      // What the table of items and the send read, before any correction.
      // The table of items as its readers see it: every line of its page (observed, retained, decision, gestures) and its facets.
      // Each line's frozen selection also carries its answers' counted marks revision (an acceptance compares it): that
      // field follows the marks, by design, and is compared on its own below; everything else must not move.
      type TableLine = { itemId: string; targets: { answers: Array<{ marksRevision?: number } & Record<string, unknown>> } & Record<string, unknown> };
      const table = async () => {
        const { body } = await apiRequest<Envelope<{ page: { lines: TableLine[] }; facets: unknown }>>(ui.browser, "GET",
          `/api/affaires/${seeded.projectId}/takeoff/items`);
        expect(body.data.page.lines.map(({ itemId }) => itemId).sort()).toEqual([seeded.basin, seeded.valve].sort());
        return { lines: body.data.page.lines.map((line) => ({ ...line, targets: { ...line.targets,
          answers: line.targets.answers.map((answer) => Object.fromEntries(Object.entries(answer)
            .filter(([field]) => field !== "marksRevision"))) } })), facets: body.data.facets };
      };
      const selectedMarks = async () => Object.fromEntries((await apiRequest<Envelope<{ page: { lines: TableLine[] } }>>(ui.browser,
        "GET", `/api/affaires/${seeded.projectId}/takeoff/items`)).body.data.page.lines
        .map((line) => [line.itemId, line.targets.answers.map(({ marksRevision }) => marksRevision)]));
      const rows = async () => (await apiRequest<Envelope<unknown>>(ui.browser, "GET", `/api/takeoff/jobs/${seeded.jobId}/items`)).body;
      const planSend = async () => (await apiRequest<unknown>(ui.browser, "POST", `/api/takeoff/jobs/${seeded.jobId}/send-to-estimate/preview`, {})).body;
      const itemSend = async () => (await apiRequest<unknown>(ui.browser, "POST", `/api/takeoff/jobs/${seeded.jobId}/item-send/preview`, {})).body;
      const before = { table: await table(), rows: await rows(), planSend: await planSend(), itemSend: await itemSend(),
        stored: await readSentInputs(seeded.projectId, seeded.jobId) };
      expect(await selectedMarks()).toEqual({ [seeded.basin]: [1], [seeded.valve]: [1] });
      // The plan's send (the route released before the items' one) would write the lavabo's row as read: 1 u, not a
      // count of marks; the send by item does not read its answers yet (its reader is a stub until it is wired).
      const legacy = before.planSend as { ok: boolean; data: { fingerprint: string; lines: Array<{ designation: string; quantity: number;
        unit: string }> } };
      expect(legacy.ok).toBe(true);
      expect(legacy.data.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(legacy.data.lines).toEqual(expect.arrayContaining([expect.objectContaining({ designation: "Lavabo", quantity: 1, unit: "u" })]));
      expect(before.itemSend).toMatchObject({ ok: false, error: { details: { guard: "item_send_answers_not_stored" } } });

      // One command: two retained, one removed with its reason, one added, page 7's object removed, both pages verified.
      const added = randomUUID();
      const lav4 = (await read(basin, 7)).body.data.marks[0]!;
      const correction = { intentKey: randomUUID(), revisions: { [basin]: 1 }, gestures: [
        { op: "retain", answer_id: basin, mark_id: lav1!.markId },
        { op: "retain", answer_id: basin, mark_id: lav2!.markId },
        { op: "remove", answer_id: basin, mark_id: lav3!.markId, reason: "not_this_item" },
        { op: "add", answer_id: basin, key: added, page: 2, x: 0.4, y: 0.8 },
        { op: "remove", answer_id: basin, mark_id: lav4.markId, reason: "legend_or_detail" },
        { op: "verify", answer_id: basin, pages: [2, 7] },
      ] };
      const saved = await edit(correction);
      expect(saved.status).toBe(200);
      expect(saved.body.data).toMatchObject({ replayed: false, revisions: { [basin]: 2 }, added: [{ key: added }],
        summaries: { [basin]: { retained: 3, reread: 3, quantity: 3, state: "verified", verifiedPages: 2 } } });
      // The same intention again: the same receipt, nothing written twice.
      const replay = await edit(correction);
      expect(replay.body.data).toMatchObject({ replayed: true, commandId: saved.body.data.commandId });

      // A mark added 2 points from a retained one, without the member's word: refused, nothing written.
      const near = { op: "add", answer_id: basin, key: randomUUID(), page: 2, x: lav1!.x + 2 / 842, y: lav1!.y };
      const duplicate = await edit({ intentKey: randomUUID(), revisions: { [basin]: 2 }, gestures: [near] });
      expect(duplicate).toMatchObject({ status: 409, body: { error: { code: "TAKEOFF_MARKS_OBJECT_DUPLICATE" } } });
      expect((await read(basin, 2)).body.data.revision).toBe(2);
      // A stale revision: refused as a whole.
      const stale = await edit({ intentKey: randomUUID(), revisions: { [basin]: 1 }, gestures: [{ ...near, object: "distinct" }] });
      expect(stale).toMatchObject({ status: 409, body: { error: { code: "TAKEOFF_MARKS_REVISION_CONFLICT" } } });
      // With the word « distinct object » on the revision shown: a fourth object, and page 2 to verify again.
      const distinct = await edit({ intentKey: randomUUID(), revisions: { [basin]: 2 }, gestures: [{ ...near, object: "distinct" }] });
      expect(distinct.body.data.summaries[basin]).toMatchObject({ retained: 4, reread: 0, quantity: null, state: "to_verify_again" });
      const verified = await edit({ intentKey: randomUUID(), revisions: { [basin]: 3 }, gestures: [{ op: "verify", answer_id: basin, pages: [2] }] });
      expect(verified.body.data.summaries[basin]).toMatchObject({ retained: 4, quantity: 4, state: "verified" });

      // The history: the analysis's proposals, then each gesture with its author and reason, page after page.
      const history: History["events"] = [];
      let after: History["next"] = null;
      do {
        const page: { body: Envelope<History> } = await apiRequest<Envelope<History>>(ui.browser, "GET",
          `${base}/history?reponse=${basin}&limite=4${after ? `&apresRevision=${after.revision}&apresOrdre=${after.ordinal}` : ""}`);
        history.push(...page.body.data.events);
        after = page.body.data.next;
      } while (after);
        // The publication journals one event per page of the answer's marks.
      expect(history.map(({ gesture, page }) => `${gesture}:${page}`)).toEqual(["proposed:2", "proposed:7",
        "retain:2", "retain:2", "remove:2", "add:2", "remove:7", "verify:2", "verify:7", "add:2", "verify:2"]);
      expect(history.find(({ gesture, page }) => gesture === "remove" && page === 2)).toMatchObject({ reasonCode: "not_this_item",
        actorKind: "member", actorId: owner.userId });
      expect(history[0]).toMatchObject({ actorKind: "worker", actorId: null });

      // The selection follows the marks the member corrected (revision 1 to 4), the other item's not.
      expect(await selectedMarks()).toEqual({ [seeded.basin]: [4], [seeded.valve]: [1] });
      // A quantity counted from marks is shown, never sent: what the table and the send read has not moved.
      expect({ table: await table(), rows: await rows(), planSend: await planSend(), itemSend: await itemSend(),
        stored: await readSentInputs(seeded.projectId, seeded.jobId) }).toEqual(before);

      // A member who may only read sees the marks and the count, and cannot correct them.
      await setOwnerRole(owner, "director");
      try {
        const reader = await read(basin, 2);
        expect(reader.body.data).toMatchObject({ edit: { allowed: false, reason: "forbidden" }, summary: { quantity: 4 } });
        const refused = await edit({ intentKey: randomUUID(), revisions: { [basin]: 4 }, gestures: [{ op: "verify", answer_id: basin, pages: [7] }] });
        expect(refused).toMatchObject({ status: 403, body: { error: { code: "TAKEOFF_MARKS_FORBIDDEN" } } });
      } finally {
        await setOwnerRole(owner, "admin");
      }

      // A plan already sent: its marks are read, never corrected here.
      await setJobSent(seeded.jobId, true);
      try {
        expect((await read(basin, 2)).body.data.edit).toEqual({ allowed: false, reason: "sent" });
        const sent = await edit({ intentKey: randomUUID(), revisions: { [basin]: 4 }, gestures: [{ op: "verify", answer_id: basin, pages: [7] }] });
        expect(sent).toMatchObject({ status: 409, body: { error: { code: "TAKEOFF_MARKS_PLAN_SENT" } } });
        expect((await read(basin, 2)).body.data.revision).toBe(4);
      } finally {
        await setJobSent(seeded.jobId, false);
      }

      // A page the reading did not cover, an answer of no affaire of the member, an answer of another of the member's
      // affaires asked under this one: not found.
      expect(await read(basin, 5)).toMatchObject({ status: 404, body: { error: { code: "TAKEOFF_MARKS_ANSWER_NOT_FOUND" } } });
      expect((await read(randomUUID(), 2)).status).toBe(404);
      const elsewhere = await seedCountMarks(owner, `${army.runPrefix}-REPERES-AUTRE`);
      const foreign = (await readCountAnswers(elsewhere.projectId))[elsewhere.basin]!;
      expect((await read(foreign, 2)).status).toBe(404);
      expect((await apiRequest(ui.browser, "GET", `${base}/history?reponse=${foreign}`)).status).toBe(404);
      expect((await apiRequest(ui.browser, "GET", `${base}/targets?reponse=${foreign}`)).status).toBe(404);

      await recordEvidence(army, "REPERES01", { projectId: seeded.projectId, summary: verified.body.data.summaries[basin],
        sendPreviews: { plan: before.planSend, items: before.itemSend },
        history: history.map(({ gesture, page, reasonCode }) => ({ gesture, page, reasonCode })),
        stored: await querySql(`select count(*) from public.takeoff_count_mark_events where project_id = '${seeded.projectId}';`) });
    });
});
