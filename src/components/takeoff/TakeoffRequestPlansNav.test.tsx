import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_PROJECT,
  fixtureActivityJob,
  fixtureActivityResponse,
  fixtureJob,
  fixtureRequest,
  fixtureThreePlans,
  fixtureUnit,
} from "@/lib/takeoff/request-activity.test-fixtures";

const hook = vi.hoisted(() => ({ data: undefined as unknown, calls: [] as unknown[] }));
vi.mock("./useTakeoffRequestActivity", () => ({
  useTakeoffRequestActivity: (input: unknown) => { hook.calls.push(input); return { data: hook.data, error: undefined, refreshMs: 0 }; },
}));

import { TakeoffRequestPlansNav } from "./TakeoffRequestPlansNav";

const nav = (jobId: string) => render(<TakeoffRequestPlansNav projectId={FIXTURE_PROJECT} jobId={jobId} viewerKey="tenant:member" />);

describe("TakeoffRequestPlansNav", () => {
  afterEach(() => { cleanup(); hook.calls = []; });

  it("names the plans still missing and leads to the next plan read, in the recorded order", () => {
    hook.data = fixtureActivityResponse(fixtureThreePlans({ bDone: true }), { view: "job" });
    nav(fixtureJob("a"));
    expect(hook.calls[0]).toMatchObject({ view: "job", target: fixtureJob("a"), poll: true });
    const strip = screen.getByRole("navigation", { name: "Plans de cette analyse" });
    expect(strip).toHaveTextContent("Plan 1 sur 3 de cette analyse");
    expect(within(strip).getByText("Plan A — niveau 1.pdf")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("takeoff-request-plans-missing")).toHaveTextContent("Plan encore manquant : Plan C — niveau 3.pdf (en attente).");
    expect(within(strip).getByRole("link", { name: "Plan suivant : Plan B — niveau 2.pdf" }))
      .toHaveAttribute("href", `/dashboard/affaires/${FIXTURE_PROJECT}/takeoff/${fixtureJob("b")}/review`);
    expect(within(strip).queryByRole("link", { name: /Plan précédent/ })).toBeNull();
  });

  it("leads back to the previous plan from the last one read", () => {
    hook.data = fixtureActivityResponse(fixtureThreePlans({ bDone: true }), { view: "job" });
    nav(fixtureJob("b"));
    expect(screen.getByRole("link", { name: "Plan précédent : Plan A — niveau 1.pdf" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Plan suivant/ })).toBeNull();
  });

  it("shows nothing for an analysis without a request, a grouped analysis or a request of one plan", () => {
    hook.data = fixtureActivityResponse(null, { view: "job" });
    nav(fixtureJob("a"));
    expect(screen.queryByRole("navigation")).toBeNull();
    cleanup();
    const grouped = fixtureRequest([fixtureUnit("d", 1, { state: "succeeded", reviewable: true }), fixtureUnit("e", 2)],
      [fixtureActivityJob("d"), fixtureActivityJob("e")]);
    hook.data = fixtureActivityResponse({ ...grouped, units: { ...grouped.units!, format: "grouped" } }, { view: "job" });
    nav(fixtureJob("d"));
    expect(screen.queryByRole("navigation")).toBeNull();
    cleanup();
    hook.data = fixtureActivityResponse(fixtureRequest([fixtureUnit("a", 1, { state: "succeeded", reviewable: true })],
      [fixtureActivityJob("a")]), { view: "job" });
    nav(fixtureJob("a"));
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
