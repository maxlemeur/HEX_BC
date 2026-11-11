import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/page-contributions-client", () => ({
  fetchTakeoffJobPageContributions: vi.fn(),
  fetchLaunchPageContributions: vi.fn(),
}));

import {
  TakeoffLaunchPagesNotice,
  TakeoffPagesAlreadyInEstimateBanner,
  useTakeoffJobPageContributions,
} from "@/components/takeoff/review/TakeoffPagesAlreadyInEstimate";
import { fetchLaunchPageContributions, fetchTakeoffJobPageContributions } from "@/lib/takeoff/page-contributions-client";
import type { TakeoffPageContributionsResponse } from "@/lib/takeoff/page-contributions-contracts";

// TI-682 lot D, PR 1: the estimator sees, before the last click, that a page of this takeoff is already in the
// estimate through another takeoff. Ways it fails, written before the screens:
// - nothing is shown at all (today: two takeoffs of one page are never compared);
// - the page is shown without the earlier takeoff, or without how many lines it brought;
// - a page whose lines the estimator has all excluded is still reported (a false alarm teaches to ignore it);
// - the launch reads every source, not the active plans the takeoff will read;
// - once this takeoff is applied on screen, the banner keeps the read taken before, which holds none of its lines,
//   and hides the page just added a second time;
// - a Z1/Z2 duplicate with a line of the earlier takeoff on another of its pages is called « the same page read
//   twice »: the estimator would keep a run counted twice;
// - a takeoff carried over into a copied version is compared with the version it was launched in, not the copy the
//   review shows and the wizard locks;
// - a line's source page corrected and saved keeps the read taken before: a page now matched shows nothing, a page no
//   longer matched keeps a false warning, until a reload.

const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const EARLIER_JOB = "11111111-1111-4111-8111-111111111111";
const EARLIER_VERSION = "44444444-4444-4444-8444-444444444444";
const PLAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const line = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;

const READ: TakeoffPageContributionsResponse = {
  version_id: VERSION_ID,
  pages: [{ file_name: "plan-fictif-R+1.pdf", page: 1, item_ids: [line(1), line(2)], earlier: [{ job_id: EARLIER_JOB, line_count: 3, takeoff_item_ids: [line(50)] }], own_line_count: 0 }],
  jobs: [{ id: EARLIER_JOB, estimate_version_id: EARLIER_VERSION, created_at: "2026-11-10T09:30:00.000Z", source_file_name: "plan-fictif-R+1.pdf" }],
  unidentified_item_ids: [line(9)],
  other_takeoff_line_count: 3,
};
const item = (n: number, is_excluded = false, rule_results: Array<{ rule: string; status: string; details?: unknown }> = []) => ({ id: line(n), is_excluded, rule_results });
const duplicateOf = (jobId: string, partnerId = line(50)) => ({ rule: "zone_overlap", status: "fail", details: { partners: [{ item_id: partnerId, job_id: jobId, zone: "Z1" }] } });
const href = (job: { id: string; estimate_version_id: string }) => `/review/${job.id}?versionId=${job.estimate_version_id}`;

beforeEach(() => {
  vi.mocked(fetchLaunchPageContributions).mockReset();
  vi.mocked(fetchTakeoffJobPageContributions).mockReset();
});
afterEach(() => cleanup());

describe("the review banner", () => {
  it("names the page, the earlier takeoff, its lines, and opens it", () => {
    render(<TakeoffPagesAlreadyInEstimateBanner read={{ data: READ, error: null }} items={[item(1), item(2), item(9)]} applied={false} jobHref={href} />);
    const banner = screen.getByRole("region", { name: "Pages déjà au devis" });
    expect(banner).toHaveTextContent("plan-fictif-R+1.pdf, page 1 : déjà au devis par le métré du 10/11/2026 (plan-fictif-R+1.pdf), 3 lignes");
    expect(within(banner).getByRole("link", { name: "Ouvrir le métré" })).toHaveAttribute("href", `/review/${EARLIER_JOB}?versionId=${EARLIER_VERSION}`);
    expect(banner).toHaveTextContent("Appliquer ce métré ajouterait ces pages une seconde fois");
    expect(banner).toHaveTextContent("1 ligne de ce métré sans plan ni page : non comparée.");
    // Nothing to decide here: the banner holds no button.
    expect(within(banner).queryByRole("button")).toBeNull();
    expect(banner).not.toHaveTextContent("doublon entre zones");
  });

  it("says the page is in the estimate twice once this takeoff is applied, while its own lines are still there", () => {
    const twice = { ...READ, pages: [{ ...READ.pages[0], own_line_count: 1 }] };
    render(<TakeoffPagesAlreadyInEstimateBanner read={{ data: twice, error: null }} items={[item(1)]} applied jobHref={href} />);
    expect(screen.getByRole("region", { name: "Pages déjà au devis" })).toHaveTextContent("ces pages sont au devis deux fois");
  });

  it("says nothing of a page an applied takeoff no longer has in the estimate (its lines were removed or replaced)", () => {
    render(<TakeoffPagesAlreadyInEstimateBanner read={{ data: READ, error: null }} items={[item(1)]} applied jobHref={href} />);
    expect(screen.queryByRole("region", { name: "Pages déjà au devis" })).toBeNull();
  });

  it("stops reporting a page whose lines are all excluded", () => {
    render(<TakeoffPagesAlreadyInEstimateBanner read={{ data: READ, error: null }} items={[item(1, true), item(2, true)]} applied={false} jobHref={href} />);
    expect(screen.queryByRole("region", { name: "Pages déjà au devis" })).toBeNull();
  });

  it("shows nothing when no page of this takeoff is in the estimate", () => {
    const { container } = render(<TakeoffPagesAlreadyInEstimateBanner read={{ data: { ...READ, pages: [], jobs: [], unidentified_item_ids: [] }, error: null }}
      items={[item(1)]} applied={false} jobHref={href} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("tells not to remove a line for a Z1/Z2 duplicate with the earlier takeoff of its page", () => {
    render(<TakeoffPagesAlreadyInEstimateBanner read={{ data: READ, error: null }} applied={false} jobHref={href}
      items={[item(1, false, [duplicateOf(EARLIER_JOB)]), item(2)]} />);
    expect(screen.getByRole("region", { name: "Pages déjà au devis" }))
      .toHaveTextContent("ce n’est pas une autre zone, ne retirez pas la ligne pour le régler");
  });

  it("says nothing of a Z1/Z2 duplicate with a line the earlier takeoff read on another page", () => {
    // The earlier takeoff read zones A and B; this one rereads A but overlaps B's line: a real duplicate between zones.
    render(<TakeoffPagesAlreadyInEstimateBanner read={{ data: READ, error: null }} applied={false} jobHref={href}
      items={[item(1, false, [duplicateOf(EARLIER_JOB, line(60))]), item(2)]} />);
    const banner = screen.getByRole("region", { name: "Pages déjà au devis" });
    expect(banner).toHaveTextContent("plan-fictif-R+1.pdf, page 1");
    expect(banner).not.toHaveTextContent("ne retirez pas la ligne");
  });

  it("keeps two documents of the same name as two rows, and drops the one whose lines are all excluded", () => {
    // Two plan files named alike, page 1 of each already in the estimate: the reader gives one row per document.
    const twoDocuments = { ...READ, pages: [
      { ...READ.pages[0], item_ids: [line(1)], earlier: [{ job_id: EARLIER_JOB, line_count: 3, takeoff_item_ids: [line(50)] }] },
      { ...READ.pages[0], item_ids: [line(2)], earlier: [{ job_id: EARLIER_JOB, line_count: 5, takeoff_item_ids: [line(60)] }] },
    ] };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(<TakeoffPagesAlreadyInEstimateBanner read={{ data: twoDocuments, error: null }} items={[item(1), item(2)]} applied={false} jobHref={href} />);
    const rows = () => within(screen.getByRole("list", { name: "Pages concernées" })).getAllByRole("listitem");
    expect(rows().map((row) => row.textContent)).toEqual([expect.stringContaining("3 lignes"), expect.stringContaining("5 lignes")]);
    expect(errors).not.toHaveBeenCalled();
    // The first document's line excluded: only the second document's row and lines stay.
    rerender(<TakeoffPagesAlreadyInEstimateBanner read={{ data: twoDocuments, error: null }} applied={false} jobHref={href}
      items={[item(1, true), item(2, false, [duplicateOf(EARLIER_JOB, line(50))])]} />);
    expect(rows().map((row) => row.textContent)).toEqual([expect.stringContaining("5 lignes")]);
    // The Z1/Z2 partner is a line the earlier takeoff read on the other document: two zones, not one page read twice.
    expect(screen.getByRole("region", { name: "Pages déjà au devis" })).not.toHaveTextContent("ne retirez pas la ligne");
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("says nothing of a Z1/Z2 duplicate when the earlier takeoff's lines on the page are not known", () => {
    const unknown = { ...READ, pages: [{ ...READ.pages[0], earlier: [{ job_id: EARLIER_JOB, line_count: 3, takeoff_item_ids: [] }] }] };
    render(<TakeoffPagesAlreadyInEstimateBanner read={{ data: unknown, error: null }} applied={false} jobHref={href}
      items={[item(1, false, [duplicateOf(EARLIER_JOB)]), item(2)]} />);
    expect(screen.getByRole("region", { name: "Pages déjà au devis" })).not.toHaveTextContent("ne retirez pas la ligne");
  });

  it("reads the pages again once this takeoff is applied on screen, and names the page now there twice", async () => {
    vi.mocked(fetchTakeoffJobPageContributions)
      .mockResolvedValueOnce(READ)
      .mockResolvedValueOnce({ ...READ, pages: [{ ...READ.pages[0], own_line_count: 1 }] });
    function Review({ applied }: Readonly<{ applied: boolean }>) {
      const read = useTakeoffJobPageContributions(line(70), VERSION_ID, { applied });
      return <TakeoffPagesAlreadyInEstimateBanner read={read} items={[item(1)]} applied={applied} jobHref={href} />;
    }
    const { rerender } = render(<Review applied={false} />);
    expect(await screen.findByRole("region", { name: "Pages déjà au devis" })).toHaveTextContent("Appliquer ce métré ajouterait ces pages une seconde fois");
    rerender(<Review applied />);
    await waitFor(() => expect(screen.getByRole("region", { name: "Pages déjà au devis" })).toHaveTextContent("ces pages sont au devis deux fois"));
    expect(fetchTakeoffJobPageContributions).toHaveBeenCalledTimes(2);
  });

  it("reads the version the review shows, a copy the takeoff was carried over into", async () => {
    vi.mocked(fetchTakeoffJobPageContributions).mockResolvedValue(READ);
    function Review() {
      const read = useTakeoffJobPageContributions(line(70), VERSION_ID);
      return <TakeoffPagesAlreadyInEstimateBanner read={read} items={[item(1)]} applied={false} jobHref={href} />;
    }
    render(<Review />);
    await screen.findByRole("region", { name: "Pages déjà au devis" });
    expect(fetchTakeoffJobPageContributions).toHaveBeenCalledWith(line(70), VERSION_ID, expect.anything());
  });

  it("reads the pages again after a line's source page is saved, and keeps the banner until the new read", async () => {
    // Saved from page 1 to page 2: page 1 is no longer this takeoff's; then back to page 1, matched again.
    let answer!: (read: TakeoffPageContributionsResponse) => void;
    vi.mocked(fetchTakeoffJobPageContributions)
      .mockResolvedValueOnce(READ)
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }))
      .mockResolvedValueOnce(READ);
    function Review({ revision }: Readonly<{ revision: number }>) {
      const read = useTakeoffJobPageContributions(line(70), VERSION_ID, { revision });
      return <TakeoffPagesAlreadyInEstimateBanner read={read} items={[item(1)]} applied={false} jobHref={href} />;
    }
    const { rerender } = render(<Review revision={0} />);
    await screen.findByRole("region", { name: "Pages déjà au devis" });
    rerender(<Review revision={1} />);
    await waitFor(() => expect(fetchTakeoffJobPageContributions).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("region", { name: "Pages déjà au devis" })).toBeInTheDocument();
    answer({ ...READ, pages: [], jobs: [], unidentified_item_ids: [] });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Pages déjà au devis" })).toBeNull());
    rerender(<Review revision={2} />);
    expect(await screen.findByRole("region", { name: "Pages déjà au devis" })).toHaveTextContent("plan-fictif-R+1.pdf, page 1");
    expect(fetchTakeoffJobPageContributions).toHaveBeenCalledTimes(3);
  });

  it("keeps a Z1/Z2 duplicate with a takeoff of another zone as it is", () => {
    render(<TakeoffPagesAlreadyInEstimateBanner read={{ data: READ, error: null }} applied={false} jobHref={href}
      items={[item(1, false, [duplicateOf("55555555-5555-4555-8555-555555555555"), { rule: "zone_overlap", status: "fail" }]), item(2)]} />);
    expect(screen.getByRole("region", { name: "Pages déjà au devis" })).not.toHaveTextContent("ne retirez pas la ligne");
  });
});

describe("the launch notice", () => {
  it("asks about the active plans to read, then names their pages already in the estimate", async () => {
    vi.mocked(fetchLaunchPageContributions).mockResolvedValue({ ...READ, pages: [{ ...READ.pages[0], item_ids: [] }], unidentified_item_ids: [] });
    render(<TakeoffLaunchPagesNotice versionId={VERSION_ID} sources={[
      { document_id: PLAN, document_name: "plan-fictif-R+1.pdf", kind: "plan", active: true, content_hash: null, logical_document_id: "PLB-R1", pages: [1] },
      { document_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", document_name: "CCTP.pdf", kind: "cctp", active: true, content_hash: null, logical_document_id: null, pages: [] },
    ]} />);
    const notice = await screen.findByRole("region", { name: "Pages déjà au devis" });
    expect(notice).toHaveTextContent("plan-fictif-R+1.pdf, page 1 : déjà au devis par le métré du 10/11/2026");
    expect(notice).toHaveTextContent("Vous pouvez lancer ce métré");
    expect(fetchLaunchPageContributions).toHaveBeenCalledWith({ estimate_version_id: VERSION_ID, documents: [
      { plan_file_id: PLAN, content_hash: null, logical_document_id: "PLB-R1", file_name: "plan-fictif-R+1.pdf", pages: [1] }] }, expect.anything());
  });

  it("asks nothing without a target version or a plan to read", async () => {
    render(<TakeoffLaunchPagesNotice versionId={null} sources={[{ document_id: PLAN, document_name: "plan.pdf", kind: "plan", active: true, pages: [] }]} />);
    render(<TakeoffLaunchPagesNotice versionId={VERSION_ID} sources={[]} />);
    await waitFor(() => expect(fetchLaunchPageContributions).not.toHaveBeenCalled());
  });
});
