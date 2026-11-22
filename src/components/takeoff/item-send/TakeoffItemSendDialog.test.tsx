import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

// Lot 4, PR 5c, review of #499: the send of one plan by item on its real components, the network answering as the test
// says. Each case is a review finding reproduced first: a choice or a page decision kept across a change of what it was
// made on, a lease left held, a completion acting on a screen the member left, a preview kept after the right is gone, a
// lost confirmation sent again under another key. Fictional values only.

const network = vi.hoisted(() => ({
  preview: vi.fn(), confirm: vi.fn(), renew: vi.fn(), acquire: vi.fn(), release: vi.fn(),
  toast: vi.fn(), push: vi.fn(), table: vi.fn(),
}));
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: network.push }),
  usePathname: () => "/dashboard/affaires/fiction/takeoff", useSearchParams: () => searchParams }));
vi.mock("@/components/feedback/toast-provider", () => ({ useToast: () => ({ success: network.toast }) }));
vi.mock("@/lib/estimates/client-locks", () => ({
  releaseEstimateDraftLock: network.release, renewEstimateDraftLock: network.renew, acquireEstimateDraftLock: network.acquire,
}));
vi.mock("@/lib/takeoff/client", async () => ({
  confirmTakeoffItemSend: network.confirm, previewTakeoffItemSend: network.preview,
  isTakeoffApiError: (await import("@/lib/takeoff/client-http")).isTakeoffApiError,
}));

import { TakeoffItemSendDialog } from "@/components/takeoff/item-send/TakeoffItemSendDialog";
import { EstimateApiError } from "@/lib/estimates/client-errors";
import { TakeoffApiError } from "@/lib/takeoff/client-http";
import type { ItemSendPreviewRequest, ItemSendPreviewResponse as Preview } from "@/lib/takeoff/item-send-contracts";

const job = "00000000-0000-4000-8000-000000000001";
const replacementJob = "00000000-0000-4000-8000-000000000002";
const item = "00000000-0000-4000-8000-000000000003";
const lineA = "00000000-0000-4000-8000-000000000004";
const lineB = "00000000-0000-4000-8000-000000000005";
const version = "00000000-0000-4000-8000-000000000006";
const firstDraft = { kind: "first_draft" } as const;
const draft = { kind: "existing_draft", version_id: version } as const;
const group = { key: "together", label: "Ensemble", reason: null } as const;
const entry = {
  key: `entry:${item}|together`, kind: "entered_quantity", item_id: item, label: "Lavabo", page: null,
  held_item_ids: [], earlier_lines: [], message: "Quantité saisie à la main.",
  options: [{ kind: "keep_entry" }, { kind: "use_retained" }, { kind: "leave_out" }],
  facts: { entered: 4, retained: 5, measured: 5, reference: null },
} satisfies Preview["to_resolve"][number];

const line = (id = lineA, after = 5): Preview["lines"][number] => ({
  key: `${item}|together`, item_id: item, label: "Lavabo", title: "Ligne " + (id === lineA ? "A" : "B"),
  change: "fed", target: "earlier_line", estimate_item_id: id, section_key: null, compartment: group, unit: "u",
  quantity_before: 4, quantity_after: after, reference: null, entered: 4, earlier: 3, replaced: 0, added: 2,
  measured: after, retained: after, rounded_from: null, gap: null, kept_entry: false, pages: [2], rule: null,
});
const response = (overrides: Partial<Preview> = {}): Preview => ({
  job_id: job, plan: { key: "plan-a", name: "Plan A" }, list: { revision_id: job, revision: 1 }, destinations: [],
  destination: draft, destination_label: "V1 · brouillon", version_created: false, engine: 3, breakdown: "together",
  blocked: null, sections: [], lines: [line()], not_sent: [], parts_not_sent: [], to_resolve: [], not_added: [],
  page_contributions: [], invalid_page_decisions: [], rules: [], confirmable: true, focus_item_id: lineA, plan_digest: "a".repeat(64),
  ...overrides,
});
const confirmResponse = { version_id: version, lines_written: 1, focus_item_id: lineA };
const stale = () => new TakeoffApiError("Aperçu périmé. Rien n’a été écrit.", 409, { guard: "item_send_preview_stale" }, "CONFLICT");
const view = (onSent = vi.fn(), jobId = job) =>
  <TakeoffItemSendDialog open jobId={jobId} planName="Plan A" viewerKey="tenant:actor" onOpenChange={() => undefined} onSent={onSent} />;
const sendButton = () => screen.getByRole("button", { name: /Envoyer « Plan A » dans/ }) as HTMLButtonElement;
const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  network.preview.mockResolvedValue(response());
  network.renew.mockResolvedValue({ renewed: true, lock: { isOwnedByCurrentUser: true } });
});

it.each([
  { name: "the line was replaced, with the same entered quantity", replacement: lineB, after: 5 },
  { name: "the measured quantity to retain changed", replacement: lineA, after: 7 },
])("asks again after a stale confirmation when $name", async ({ replacement, after }) => {
  let latest = false;
  network.preview.mockImplementation(async (_job: string, request: ItemSendPreviewRequest) =>
    request.resolutions?.length
      ? response({ lines: [latest ? line(replacement, after) : line()], plan_digest: (latest ? "b" : "a").repeat(64) })
      : response({ lines: [], to_resolve: [latest ? { ...entry, facts: { ...entry.facts, retained: after, measured: after } } : entry],
        confirmable: false, plan_digest: null }));
  network.confirm.mockImplementation(async () => { latest = true; throw stale(); });
  render(view());
  fireEvent.click(await screen.findByRole("radio", { name: /^Retenir le métré/ }));
  await waitFor(() => expect(sendButton()).toBeEnabled());
  fireEvent.click(sendButton());
  await waitFor(() => expect(network.preview).toHaveBeenCalledTimes(3));
  await screen.findByTestId("item-send-notice");
  await screen.findByRole("radio", { name: /^Retenir le métré/ });
  expect({ checked: radio(/^Retenir le métré/).checked, confirmable: !sendButton().disabled }).toEqual({ checked: false, confirmable: false });
});

it("says a send that ends after the member left it was written, without moving them nor acting on the old screen", async () => {
  const confirmation = deferred<typeof confirmResponse>();
  network.confirm.mockReturnValue(confirmation.promise);
  const onSent = vi.fn();
  const nextOnSent = vi.fn();
  const rendered = render(view(onSent));
  await waitFor(() => expect(sendButton()).toBeEnabled());
  fireEvent.click(sendButton());
  await waitFor(() => expect(network.confirm).toHaveBeenCalledTimes(1));
  rendered.rerender(view(nextOnSent, replacementJob));
  await waitFor(() => expect(network.preview).toHaveBeenCalledTimes(2));
  await act(async () => confirmation.resolve(confirmResponse));
  expect({ staleCallback: onSent.mock.calls.length, navigation: network.push.mock.calls.length }).toEqual({ staleCallback: 0, navigation: 0 });
  expect(network.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("n’a pas été ouvert") }));
});

it("lets the member recover a blocked breakdown after leaving the sole item out", async () => {
  const point = { ...entry, key: `breakdown:${item}`, kind: "breakdown_mixed" as const, facts: null,
    options: [{ kind: "leave_out" as const }] };
  network.preview.mockImplementation(async (_job: string, request: ItemSendPreviewRequest) =>
    request.breakdown !== "by_level" ? response()
      : response({ breakdown: "by_level", lines: [], confirmable: false, plan_digest: null,
        ...(request.resolutions?.length
          ? { blocked: { reason: "no_line", message: "Aucun poste à envoyer", href: null },
            not_sent: [{ item_id: item, label: "Lavabo", reason: "left_out", message: "Laissé de côté." }] }
          : { to_resolve: [point] }) }));
  render(view());
  fireEvent.click(await screen.findByRole("radio", { name: "Par niveau" }));
  fireEvent.click(await screen.findByRole("radio", { name: /^Laisser ce poste de côté/ }));
  await screen.findByText("Aucun poste à envoyer");
  expect(screen.getByRole("radio", { name: "Ensemble" })).toBeEnabled();
});

it("releases a lease granted to an acquisition whose response was lost, at once", async () => {
  let serverLease = false;
  let lost = true;
  network.renew.mockImplementation(async () => {
    if (serverLease) return { renewed: true, lock: { isOwnedByCurrentUser: true } };
    throw new EstimateApiError("Aucun bail.", 404, null, null);
  });
  network.acquire.mockImplementation(async () => {
    serverLease = true;
    if (lost) { lost = false; throw new TypeError("Failed to fetch"); }
    return { acquired: true, lock: { isOwnedByCurrentUser: true } };
  });
  network.release.mockImplementation(async () => { serverLease = false; return { released: true }; });
  network.confirm.mockRejectedValue(stale());
  render(view());
  await waitFor(() => expect(sendButton()).toBeEnabled());
  fireEvent.click(sendButton());
  await screen.findByText(/Failed to fetch/);
  expect({ confirmed: network.confirm.mock.calls.length, serverLease }).toEqual({ confirmed: 0, serverLease: false });
  fireEvent.click(sendButton());
  await screen.findByText(/Aperçu périmé/);
  expect({ confirmed: network.confirm.mock.calls.length, serverLease }).toEqual({ confirmed: 1, serverLease: false });
});

it("releases after the next confirmation a lease it took when that release itself was lost", async () => {
  let serverLease = false;
  let releaseLost = true;
  network.renew.mockImplementation(async () => {
    if (serverLease) return { renewed: true, lock: { isOwnedByCurrentUser: true } };
    throw new EstimateApiError("Aucun bail.", 404, null, null);
  });
  network.acquire.mockImplementation(async () => { serverLease = true; throw new TypeError("Failed to fetch"); });
  network.release.mockImplementation(async () => {
    if (releaseLost) { releaseLost = false; throw new TypeError("Failed to fetch"); }
    serverLease = false;
    return { released: true };
  });
  network.confirm.mockRejectedValue(stale());
  render(view());
  await waitFor(() => expect(sendButton()).toBeEnabled());
  fireEvent.click(sendButton());
  await screen.findByText(/Failed to fetch/);
  expect(serverLease).toBe(true);
  // The lease found again is this send's own: renewed, used, then released.
  fireEvent.click(sendButton());
  await screen.findByText(/Aperçu périmé/);
  expect({ confirmed: network.confirm.mock.calls.length, serverLease }).toEqual({ confirmed: 1, serverLease: false });
});

it("keeps a lease the member already held: it is renewed, never released", async () => {
  network.confirm.mockRejectedValue(stale());
  render(view());
  await waitFor(() => expect(sendButton()).toBeEnabled());
  fireEvent.click(sendButton());
  await screen.findByText(/Aperçu périmé/);
  expect(network.release).not.toHaveBeenCalled();
});

it("posts once when two confirmation events arrive before a render", async () => {
  network.preview.mockResolvedValue(response({ destination: firstDraft }));
  network.confirm.mockReturnValue(new Promise(() => undefined));
  render(view());
  const button = await screen.findByRole("button", { name: "Créer le devis et y envoyer « Plan A »" });
  await waitFor(() => expect(button).toBeEnabled());
  await act(async () => {
    button.click();
    button.click();
  });
  expect(network.confirm).toHaveBeenCalledTimes(1);
});

const heldPage = { ...entry, key: "page:2", kind: "page_decision", label: null, item_id: null, facts: null, page: 2,
  earlier_lines: [{ estimate_item_id: lineA, title: "Ancien apport", quantity: 3 }],
  held_item_ids: [item], options: [{ kind: "leave_out" }] } satisfies Preview["to_resolve"][number];

it("asks for a new page decision when another contribution has become the replacement target", async () => {
  let latest = false;
  network.preview.mockImplementation(async (_job: string, request: ItemSendPreviewRequest) =>
    request.page_decisions?.length
      ? response({
        lines: [line(lineA, 2)].map((value) => ({ ...value, quantity_before: latest ? 8 : 3, retained: 2, replaced: latest ? 8 : 3 })),
        plan_digest: (latest ? "c" : "a").repeat(64),
      })
      : response({
        lines: [], to_resolve: [{ ...heldPage, earlier_lines: latest
          ? [{ estimate_item_id: lineA, title: "Nouvel apport", quantity: 8 }] : heldPage.earlier_lines }],
        confirmable: false, plan_digest: null,
      }));
  network.confirm.mockImplementation(async () => { latest = true; throw stale(); });
  render(view());
  fireEvent.click(await screen.findByRole("radio", { name: /^Remplacer/ }));
  await waitFor(() => expect(sendButton()).toBeEnabled());
  fireEvent.click(sendButton());
  await waitFor(() => expect(network.preview.mock.calls.length).toBeGreaterThanOrEqual(3));
  await screen.findByRole("radio", { name: /^Remplacer/ });
  expect({ checked: radio(/^Remplacer/).checked, confirmable: !sendButton().disabled,
    freshHolder: screen.getByTestId("item-send-page-2").textContent?.includes("Nouvel apport") })
    .toEqual({ checked: false, confirmable: false, freshHolder: true });
});

it("keeps the edited page note through another gesture before the debounce fires", async () => {
  const noteBefore = "The original fictional note";
  const noteAfter = "The corrected fictional note";
  network.preview.mockImplementation(async (_job: string, request: ItemSendPreviewRequest) =>
    request.page_decisions?.length ? response({ breakdown: request.breakdown ?? "together" })
      : response({ lines: [], confirmable: false, plan_digest: null, to_resolve: [heldPage] }));
  render(view());
  fireEvent.click(await screen.findByRole("radio", { name: /^Garder les deux/ }));
  fireEvent.click(await screen.findByRole("radio", { name: "Périmètre complémentaire" }));
  const noteField = () => screen.getByRole("textbox", { name: "Ce que ce plan ajoute (obligatoire)" }) as HTMLTextAreaElement;
  fireEvent.change(noteField(), { target: { value: noteBefore } });
  await waitFor(() => expect(sendButton()).toBeEnabled(), { timeout: 2500 });
  fireEvent.change(noteField(), { target: { value: noteAfter } });
  fireEvent.click(screen.getByRole("radio", { name: "Par niveau" }));
  await screen.findByRole("textbox", { name: "Ce que ce plan ajoute (obligatoire)" });
  expect(noteField().value).toBe(noteAfter);
});

it("reuses the lost confirmation's intention key after leaving and reopening the same send", async () => {
  network.preview.mockResolvedValue(response({ destination: firstDraft }));
  network.confirm.mockRejectedValue(new TypeError("Failed to fetch"));
  const first = render(view());
  const createButton = () => screen.getByRole("button", { name: "Créer le devis et y envoyer « Plan A »" });
  await waitFor(() => expect(createButton()).toBeEnabled());
  fireEvent.click(createButton());
  await screen.findByText("Failed to fetch");
  first.unmount();
  render(view());
  await waitFor(() => expect(createButton()).toBeEnabled());
  fireEvent.click(createButton());
  await screen.findByText("Failed to fetch");
  expect(network.confirm.mock.calls[1][1]).toEqual(network.confirm.mock.calls[0][1]);
});

vi.mock("@/components/takeoff/useTakeoffRequestActivity", () => ({
  isTakeoffReadRefusal: () => false,
  useTakeoffRequestActivity: () => ({ data: undefined, refused: false, mutate: () => undefined }),
}));
vi.mock("@/components/takeoff/TakeoffPlanLocationDialog", () => ({ TakeoffPlanLocationDialog: () => null }));
vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({ assumeTakeoffLaunchRequestAction: vi.fn() }));

import { TakeoffRequestActivity } from "@/components/takeoff/TakeoffRequestActivity";
import { FIXTURE_PROJECT, fixtureActivityResponse, fixtureThreePlans } from "@/lib/takeoff/request-activity.test-fixtures";

it("withdraws the open preview when a fresh activity read removes the plan's write right", async () => {
  const activity = (writes: boolean) => {
    const request = fixtureThreePlans({ reader: !writes });
    request.order = "item_list";
    request.jobs[0].canSendItems = writes;
    return <TakeoffRequestActivity projectId={FIXTURE_PROJECT} viewerKey="tenant:actor"
      live={{ data: fixtureActivityResponse(request), error: undefined, refused: false, refreshMs: 0, refresh: vi.fn(), isLoading: false }}
      linked={null} onChanged={vi.fn()} onShowLatest={vi.fn()} />;
  };
  const rendered = render(activity(true));
  const entrant = () => screen.queryByRole("button", { name: /Envoyer ce plan au devis : « Plan A/ });
  fireEvent.click(entrant()!);
  await waitFor(() => expect(sendButton()).toBeEnabled());
  rendered.rerender(activity(false));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("never navigates or posts a newly leased confirmation after the member has left that screen", async () => {
  const lock = deferred<{ renewed: true; lock: { isOwnedByCurrentUser: true } }>();
  network.renew.mockReturnValueOnce(lock.promise);
  network.confirm.mockResolvedValue(confirmResponse);
  const rendered = render(view());
  await waitFor(() => expect(sendButton()).toBeEnabled());
  fireEvent.click(sendButton());
  await waitFor(() => expect(network.renew).toHaveBeenCalledTimes(1));
  rendered.unmount();
  await act(async () => lock.resolve({ renewed: true, lock: { isOwnedByCurrentUser: true } }));
  expect({ sentAfterLeaving: network.confirm.mock.calls.length, navigation: network.push.mock.calls.length })
    .toEqual({ sentAfterLeaving: 0, navigation: 0 });
});

vi.mock("@/lib/takeoff/item-table-client", async (original) => ({
  ...await original<typeof import("@/lib/takeoff/item-table-client")>(),
  fetchItemTable: network.table,
}));
import { SWRConfig } from "swr";
import { TakeoffItemTable } from "@/components/takeoff/item-table/TakeoffItemTable";
import { FIXTURE_ITEM_PROJECT, fixtureAnswer, fixtureItemTable, fixturePoste, fixtureReading } from "@/lib/takeoff/item-table.test-fixtures";

it("keeps the table on plan B when an earlier confirmation for plan A resolves after browser history changed scope", async () => {
  const plans = ["plan-rdc", "plan-r1"] as const;
  const readings = [
    fixtureReading(0, plans[0], fixtureAnswer("measured", 3, { jobId: job })),
    fixtureReading(0, plans[1], fixtureAnswer("measured", 2, { jobId: replacementJob })),
  ];
  network.table.mockImplementation(async (_project: string, address: Parameters<typeof fixtureItemTable>[0]) =>
    fixtureItemTable({ items: [fixturePoste(0, "Lavabo")], readings, scope: address.scope }));
  const confirmation = deferred<typeof confirmResponse>();
  network.confirm.mockReturnValue(confirmation.promise);
  const table = () => <SWRConfig value={{ provider: () => new Map() }}>
    <TakeoffItemTable projectId={FIXTURE_ITEM_PROJECT} viewerKey="tenant:actor" />
  </SWRConfig>;
  searchParams = new URLSearchParams({ postePlan: plans[0] });
  const rendered = render(table());
  fireEvent.click(await screen.findByRole("button", { name: "Envoyer ce plan au devis" }));
  await waitFor(() => expect(sendButton()).toBeEnabled());
  fireEvent.click(sendButton());
  await waitFor(() => expect(network.confirm).toHaveBeenCalledTimes(1));
  searchParams = new URLSearchParams({ postePlan: plans[1] });
  rendered.rerender(table());
  await waitFor(() => expect(network.table.mock.calls.at(-1)?.[1].scope.planKey).toBe(plans[1]));
  await act(async () => confirmation.resolve(confirmResponse));
  expect(network.push).not.toHaveBeenCalled();
});
