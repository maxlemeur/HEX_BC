import { describe, expect, it } from "vitest";

import { ruleLinePage, type RulePageCandidate } from "@/lib/takeoff/rules/recompute-pages";

// The model's lines were matched to the job's vector pages by file name and page (TI-664 L5b, Codex): two plan files
// of one display name, the same page number, one page with a cote contradicting its scale. The line of the
// inconsistent page could take the consistent page's scale and pass, whichever page the map kept last.
const JOB = "job-1";
const pages: RulePageCandidate[] = [
  { id: "page-a", job_id: JOB, plan_file_id: "file-a", source_file_name: "Plan R+1.pdf", source_page: 1, scale_mismatch: true },
  { id: "page-b", job_id: JOB, plan_file_id: "file-b", source_file_name: "Plan R+1.pdf", source_page: 1, scale_mismatch: false },
];
const line = (source_document: unknown) => ({ job_id: JOB, source_file_name: "Plan R+1.pdf", source_page: 1, metadata: { source_document } });

describe("the vector page of a model line", () => {
  it("is the page of its own document, never another file of the same name", () => {
    expect(ruleLinePage(line({ kind: "plan_file", plan_file_id: "file-a" }), pages)).toBe("page-a");
    expect(ruleLinePage(line({ kind: "plan_file", plan_file_id: "file-b" }), pages)).toBe("page-b");
    expect([...pages].reverse().map(() => ruleLinePage(line({ kind: "plan_file", plan_file_id: "file-a" }), [...pages].reverse()))).toEqual(["page-a", "page-a"]);
  });

  it("falls back on the page whose scale is contradicted when a line names no document or two pages still match (fail closed)", () => {
    expect(ruleLinePage(line(undefined), pages)).toBe("page-a");
    expect(ruleLinePage(line(undefined), [...pages].reverse())).toBe("page-a");
    const uploads = pages.map((page) => ({ ...page, plan_file_id: null }));
    expect(ruleLinePage(line({ kind: "job_upload", job_id: JOB }), uploads)).toBe("page-a");
    expect(ruleLinePage({ ...line({ kind: "plan_file", plan_file_id: "file-c" }) }, pages)).toBeNull();
    expect(ruleLinePage({ ...line(undefined), source_page: null }, pages)).toBeNull();
  });
});
