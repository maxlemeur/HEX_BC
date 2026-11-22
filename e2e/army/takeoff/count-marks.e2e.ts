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
// refused. Until a send verifies the marks revision, a quantity counted from marks is shown and never sent. Both items
// are accepted in the table first, on the tenant's default engine (3), as the send by item requires: the job's rows,
// the plan's send preview (it refuses a job read against the list, whose send is item by item) and the valve's line of
// the items' send preview (its reviewed row, never a count) answer the same before and after the correction; the
// lavabo's acceptance, taken on marks the correction changed, is reopened (#485): its line is pending again and it
// leaves the items' send, named with its reason. Fictional values.

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
const ITEM_LIST_JOB = "Ce métré a été lu contre la liste des postes : il s’envoie poste par poste. Rien n’a été écrit.";
type History = { events: Array<{ gesture: string; actorKind: string; actorId: string | null; reasonCode: string | null; page: number }>;
  next: { revision: number; ordinal: number } | null };

describe("Repères comptés d’un poste", () => {
  test("REPERES01 lit, corrige et retrace les repères d’un poste ; refuse un lecteur, un plan envoyé et une page non lue ; n’envoie rien",
    options, async ({ ui }) => {
      const { app, army } = ui;
      // A new tenant's default engine (no policy row: 3), the only one the send by item writes into.
      const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "REPERES", calcPolicy: "absent" });
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

      // Both items accepted through the table's command, as the table does it: their selection frozen (each answer's
      // marks revision with it), then accepted; the command verifies their rows.
      const selection = await apiRequest<Envelope<{ items: Array<{ itemId: string; target: unknown }> }>>(ui.browser, "POST",
        `/api/affaires/${seeded.projectId}/takeoff/items/selection`, { command_version: 1, scope: { kind: "affaire" },
          selection: { kind: "items", item_ids: [seeded.basin, seeded.valve] } });
      expect(selection.status).toBe(200);
      const accepted = await apiRequest<Envelope<{ outcome: string; applied: Array<{ itemId: string }>; skipped: unknown[] }>>(ui.browser,
        "POST", `/api/affaires/${seeded.projectId}/takeoff/items/review`, { command_version: 1, intent_key: randomUUID(),
          gesture: "accept_measured", scope: { kind: "affaire" }, targets: selection.body.data.items.map(({ target }) => target) });
      expect(accepted.status).toBe(200);
      expect(accepted.body.data).toMatchObject({ outcome: "applied", skipped: [] });
      expect(accepted.body.data.applied.map(({ itemId }) => itemId).sort()).toEqual([seeded.basin, seeded.valve].sort());

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
      type SendLine = { item_id: string; label: string; unit: string; measured: number; retained: number; quantity_after: number;
        pages: number[] };
      type SendPreview = { lines: SendLine[]; not_sent: unknown[]; parts_not_sent: unknown[]; page_contributions: unknown[];
        plan_digest: string | null } & Record<string, unknown>;
      const previewData = (preview: unknown) => (preview as { data: SendPreview }).data;
      const omit = (value: object, fields: string[]) => Object.fromEntries(Object.entries(value).filter(([field]) => !fields.includes(field)));
      const previewRest = (preview: SendPreview) => omit(preview, ["lines", "not_sent", "parts_not_sent", "page_contributions", "plan_digest"]);
      // The lavabo's decision as the table shows it (its line, its reading, what it retains, whether it can be accepted, the
      // facets of decisions), and the table without it.
      type Table = Awaited<ReturnType<typeof table>>;
      const basinLine = (snapshot: Table) => snapshot.lines.find((line) => line.itemId === seeded.basin) as unknown as {
        decision: string; retained: unknown; readings: Array<{ decision: unknown }>; eligibility: Record<string, unknown> };
      const basinDecision = (snapshot: Table) => {
        const line = basinLine(snapshot);
        return { decision: line.decision, retained: line.retained, reading: line.readings[0]!.decision,
          accept: line.eligibility.accept_measured, decisions: (snapshot.facets as { decisions: unknown }).decisions };
      };
      const withoutBasinDecision = (snapshot: Table) => ({
        facets: omit(snapshot.facets as object, ["decisions"]),
        lines: snapshot.lines.map((line) => {
          if (line.itemId !== seeded.basin) return line;
          const { readings, eligibility } = line as unknown as { readings: object[]; eligibility: object };
          return { ...omit(line, ["decision", "retained"]), readings: readings.map((reading) => omit(reading, ["decision"])),
            eligibility: omit(eligibility, ["accept_measured"]) };
        }),
      });
      const sentLines = (preview: unknown) => ((preview as { data: { lines: SendLine[] } }).data.lines)
        .map((line) => ({ itemId: line.item_id, label: line.label, unit: line.unit, measured: line.measured, retained: line.retained,
          quantityAfter: line.quantity_after, pages: line.pages }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const before = { table: await table(), rows: await rows(), planSend: await planSend(), itemSend: await itemSend(),
        stored: await readSentInputs(seeded.projectId, seeded.jobId) };
      expect(await selectedMarks()).toEqual({ [seeded.basin]: [1], [seeded.valve]: [1] });
      // The plan's send (the route released before the items' one) refuses a job read against the list: such a job is sent
      // item by item, and the member reads why.
      expect(before.planSend).toMatchObject({ ok: false, error: { code: "CONFLICT", message: ITEM_LIST_JOB,
        details: { guard: "send_item_list_job" } } });
      // The items' send retains each accepted item's reviewed row, 1 u on page 2: never a count of marks (three proposed
      // for the lavabo here, three then four retained below).
      expect(before.itemSend).toMatchObject({ ok: true, data: { engine: 3, blocked: null, confirmable: true, not_sent: [],
        parts_not_sent: [] } });
      expect(sentLines(before.itemSend)).toEqual([
        { itemId: seeded.basin, label: "Lavabo", unit: "u", measured: 1, retained: 1, quantityAfter: 1, pages: [2] },
        { itemId: seeded.valve, label: "Vanne", unit: "u", measured: 1, retained: 1, quantityAfter: 1, pages: [2] },
      ]);

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
      // A quantity counted from marks is shown, never sent. The correction moves one thing only: the lavabo's acceptance,
      // taken on the marks it changed, is a decision to take again (#485). The job's rows, the stored inputs, the plan's
      // send and the rest of the table have not moved.
      const corrected = { table: await table(), rows: await rows(), planSend: await planSend(), itemSend: await itemSend(),
        stored: await readSentInputs(seeded.projectId, seeded.jobId) };
      expect(corrected.rows).toEqual(before.rows);
      expect(corrected.stored).toEqual(before.stored);
      expect(corrected.planSend).toEqual(before.planSend);
      expect(withoutBasinDecision(corrected.table)).toEqual(withoutBasinDecision(before.table));
      expect(basinDecision(before.table)).toEqual({ decision: "accepted", retained: { quantity: 1, unit: "u", source: "measured", partial: false },
        reading: expect.objectContaining({ kind: "accepted", revision: 1, actorId: owner.userId }),
        accept: { eligible: false, reason: "already_decided" }, decisions: { pending: 0, accepted: 2, set_aside: 0, entered: 0, none: 0 } });
      expect(basinDecision(corrected.table)).toEqual({ decision: "pending", retained: null, reading: null,
        accept: { eligible: true, reason: null }, decisions: { pending: 1, accepted: 1, set_aside: 0, entered: 0, none: 0 } });
      // The items' send: the valve's line as before, from its reviewed row (1 u), never its marks; the lavabo, undecided
      // again, leaves the plan and is named with its reason, its row among the parts not sent. Everything else of the
      // preview is as before; its digest follows the plan.
      const [shown, reshown] = [previewData(before.itemSend), previewData(corrected.itemSend)];
      expect(reshown.lines).toEqual(shown.lines.filter((line) => line.item_id === seeded.valve));
      expect(reshown.not_sent).toEqual([{ item_id: seeded.basin, label: "Lavabo", reason: "not_accepted",
        message: "Mesure à accepter dans le tableau des postes : seul ce qui est retenu part au devis." }]);
      expect(reshown.parts_not_sent).toEqual([expect.objectContaining({ item_id: seeded.basin, kind: "measured", pages: [2], quantity: 1,
        unit: "u", reason: "not_accepted" })]);
      expect(reshown.page_contributions).toEqual([{ page: 2, item_ids: [seeded.valve] }]);
      expect(previewRest(reshown)).toEqual(previewRest(shown));
      expect(reshown.plan_digest).not.toBe(shown.plan_digest);

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

      // A page the reading did not cover, an answer of no affaire of the member: not found.
      expect(await read(basin, 5)).toMatchObject({ status: 404, body: { error: { code: "TAKEOFF_MARKS_ANSWER_NOT_FOUND" } } });
      expect((await read(randomUUID(), 2)).status).toBe(404);
      expect((await apiRequest(ui.browser, "GET", `${base}/history?reponse=${randomUUID()}`)).status).toBe(404);

      await recordEvidence(army, "REPERES01", { projectId: seeded.projectId, summary: verified.body.data.summaries[basin],
        sendPreviews: { plan: before.planSend, items: before.itemSend, itemsAfterCorrection: corrected.itemSend },
        history: history.map(({ gesture, page, reasonCode }) => ({ gesture, page, reasonCode })),
        stored: await querySql(`select count(*) from public.takeoff_count_mark_events where project_id = '${seeded.projectId}';`) });
    });
});
