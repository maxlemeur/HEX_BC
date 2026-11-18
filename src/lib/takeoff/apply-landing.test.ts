import { describe, expect, it } from "vitest";

import { takeoffApplyLandingHref } from "@/lib/takeoff/apply-landing";

// After the takeoff is sent to the estimate table, the estimator lands in the editor on the takeoff's lines: the first
// line it created, else the first line it updated (a DPGF line it fed, a page replaced in place), else the table alone.
// Written before the function: the review stayed on its own page (affaire) or opened the legacy job page.

const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const CREATED = "33333333-3333-4333-8333-333333333331";
const CREATED_LATER = "33333333-3333-4333-8333-333333333332";
const UPDATED = "44444444-4444-4444-8444-444444444441";
const TAKEOFF_ITEM = "55555555-5555-4555-8555-555555555551";

const link = (estimate_item_id: string) => ({ takeoff_item_id: TAKEOFF_ITEM, estimate_item_id });

describe("takeoffApplyLandingHref", () => {
  it("lands on the first line the application created", () => {
    expect(takeoffApplyLandingHref(VERSION_ID, { created_ids: [CREATED, CREATED_LATER], item_links: [link(UPDATED)] }))
      .toBe(`/dashboard/estimates/${VERSION_ID}/edit?focusItemId=${CREATED}`);
  });

  it("lands on the first linked line when the application created none", () => {
    expect(takeoffApplyLandingHref(VERSION_ID, { created_ids: [], item_links: [link(UPDATED), link(CREATED)] }))
      .toBe(`/dashboard/estimates/${VERSION_ID}/edit?focusItemId=${UPDATED}`);
  });

  it("opens the table without a line when the application names none", () => {
    expect(takeoffApplyLandingHref(VERSION_ID, { created_ids: [], item_links: [] }))
      .toBe(`/dashboard/estimates/${VERSION_ID}/edit`);
  });

  it("encodes what it puts in the address", () => {
    expect(takeoffApplyLandingHref("a/b", { created_ids: ["c&d"], item_links: [] }))
      .toBe("/dashboard/estimates/a%2Fb/edit?focusItemId=c%26d");
  });
});
