import { describe, expect, it } from "vitest";

import { DELETE as deleteAffaire } from "@/app/api/affaires/[projectId]/route";
import { GET as getDpgfSource } from "@/app/api/affaires/[projectId]/dpgf-source/route";
import { GET as getCountMarks, POST as postCountMarks } from "@/app/api/affaires/[projectId]/takeoff/count-marks/route";
import { GET as getCountMarksHistory } from "@/app/api/affaires/[projectId]/takeoff/count-marks/history/route";
import { GET as getCountMarkTargets } from "@/app/api/affaires/[projectId]/takeoff/count-marks/targets/route";
import { GET as getItemDetailPlan } from "@/app/api/affaires/[projectId]/takeoff/item-detail/plan/route";
import { GET as getItemList } from "@/app/api/affaires/[projectId]/takeoff/item-list/route";
import { POST as postItemListItems } from "@/app/api/affaires/[projectId]/takeoff/item-list/items/route";
import { POST as postItemListRevisions } from "@/app/api/affaires/[projectId]/takeoff/item-list/revisions/route";
import { GET as getItems } from "@/app/api/affaires/[projectId]/takeoff/items/route";
import { GET as getItem } from "@/app/api/affaires/[projectId]/takeoff/items/[itemId]/route";
import { POST as postEntryScope } from "@/app/api/affaires/[projectId]/takeoff/items/[itemId]/entry-scope/route";
import { GET as getItemHistory } from "@/app/api/affaires/[projectId]/takeoff/items/[itemId]/history/route";
import { POST as postRemeasure } from "@/app/api/affaires/[projectId]/takeoff/items/remeasure/route";
import { POST as postRemeasurePreview } from "@/app/api/affaires/[projectId]/takeoff/items/remeasure/preview/route";
import { POST as postReview } from "@/app/api/affaires/[projectId]/takeoff/items/review/route";
import { POST as postSelection } from "@/app/api/affaires/[projectId]/takeoff/items/selection/route";

const VALID_ID = "11111111-1111-4111-8111-111111111111";

type ProjectHandler = (request: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>;
type ItemHandler = (request: Request, ctx: { params: Promise<{ projectId: string; itemId: string }> }) => Promise<Response>;

const projectHandlers: Array<[string, ProjectHandler]> = [
  ["DELETE affaire", deleteAffaire],
  ["GET dpgf-source", getDpgfSource],
  ["GET count-marks", getCountMarks],
  ["POST count-marks", postCountMarks],
  ["GET count-marks/history", getCountMarksHistory],
  ["GET count-marks/targets", getCountMarkTargets],
  ["GET item-detail/plan", getItemDetailPlan],
  ["GET item-list", getItemList],
  ["POST item-list/items", postItemListItems],
  ["POST item-list/revisions", postItemListRevisions],
  ["GET items", getItems],
  ["POST items/remeasure", postRemeasure],
  ["POST items/remeasure/preview", postRemeasurePreview],
  ["POST items/review", postReview],
  ["POST items/selection", postSelection],
];

const itemHandlers: Array<[string, ItemHandler]> = [
  ["GET items/[itemId]", getItem],
  ["POST items/[itemId]/entry-scope", postEntryScope],
  ["GET items/[itemId]/history", getItemHistory],
];

function request() {
  return new Request("http://localhost/api/affaires/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

async function expectNotFound(response: Response, message: string) {
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ ok: false, error: { code: "NOT_FOUND", message } });
}

describe("affaire routes refuse a malformed route parameter as not found", () => {
  it.each(projectHandlers)("%s answers 404 for a projectId that is not a UUID", async (_name, handler) => {
    await expectNotFound(
      await handler(request(), { params: Promise.resolve({ projectId: "not-a-uuid" }) }),
      "Affaire introuvable."
    );
  });

  it.each(itemHandlers)("%s answers 404 for a projectId that is not a UUID", async (_name, handler) => {
    await expectNotFound(
      await handler(request(), { params: Promise.resolve({ projectId: "not-a-uuid", itemId: VALID_ID }) }),
      "Poste introuvable."
    );
  });

  it.each(itemHandlers)("%s answers 404 for an itemId that is not a UUID", async (_name, handler) => {
    await expectNotFound(
      await handler(request(), { params: Promise.resolve({ projectId: VALID_ID, itemId: "not-a-uuid" }) }),
      "Poste introuvable."
    );
  });
});
