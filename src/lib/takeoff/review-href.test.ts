import { describe, expect, it } from "vitest";

import { takeoffDpgfExceptionsHref, takeoffReviewHref } from "@/lib/takeoff/review-href";

// The links to a takeoff's review were written by hand in each screen; the journeys compare them as strings, so the
// builder keeps their exact shape: the version first, then the review mode, the view, the DPGF view and the line.

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const LINE_ID = "44444444-4444-4444-8444-444444444444";
const REVIEW = `/dashboard/affaires/${PROJECT_ID}/takeoff/${JOB_ID}/review`;
const ids = { projectId: PROJECT_ID, jobId: JOB_ID, versionId: VERSION_ID };

describe("takeoffReviewHref", () => {
  it("opens the review on the estimate version", () => {
    expect(takeoffReviewHref(ids)).toBe(`${REVIEW}?versionId=${VERSION_ID}`);
  });

  it("opens the targeted review, on a line when one is named", () => {
    expect(takeoffReviewHref({ ...ids, targeted: true })).toBe(`${REVIEW}/targeted?versionId=${VERSION_ID}`);
    expect(takeoffReviewHref({ ...ids, targeted: true, line: LINE_ID }))
      .toBe(`${REVIEW}/targeted?versionId=${VERSION_ID}&line=${LINE_ID}`);
  });

  it("keeps the order version, mode, view, DPGF view, line", () => {
    expect(takeoffReviewHref({ ...ids, line: LINE_ID, view: "dpgf", reviewMode: "production" }))
      .toBe(`${REVIEW}?versionId=${VERSION_ID}&reviewMode=production&view=dpgf&line=${LINE_ID}`);
  });

  it("encodes the query values", () => {
    expect(takeoffReviewHref({ ...ids, versionId: "a b&c", line: "x/y" }))
      .toBe(`${REVIEW}?versionId=a%20b%26c&line=x%2Fy`);
  });
});

describe("takeoffDpgfExceptionsHref", () => {
  it("opens the DPGF exceptions, after the review mode when one is named", () => {
    expect(takeoffDpgfExceptionsHref(ids)).toBe(`${REVIEW}?versionId=${VERSION_ID}&view=dpgf&dpgfView=exceptions_only`);
    expect(takeoffDpgfExceptionsHref({ ...ids, reviewMode: "validation" }))
      .toBe(`${REVIEW}?versionId=${VERSION_ID}&reviewMode=validation&view=dpgf&dpgfView=exceptions_only`);
  });
});
