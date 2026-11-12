import type { Browser } from "@e2e-dev/web";
import { credentials, expect, type App, type Screen } from "e2e";

type Ui = { app: App; screen: Screen; browser: Browser };

/**
 * A page load shows the server HTML before React handles it: a press is then lost, and the login form
 * posts natively and comes back empty. On `next dev`, Next starts hydrating only after the `load` event
 * that `app.open` and `reload` wait for, and each loading.tsx boundary hydrates after the root. React
 * attaches its props to every element it hydrates (the key auth.setup's diagnostics read): this waits
 * until every control of the page has them and no streamed segment is still hidden.
 */
export async function waitForHydration(browser: Browser) {
  const read = () => browser.evaluate(() => {
    const controls = Array.from(document.querySelectorAll(
      "a[href], button, input:not([type='hidden']), select, textarea, summary, [tabindex], [contenteditable]",
    )).filter((control) => !control.closest("[hidden]") && !Object.keys(control).some((key) => key.startsWith("__reactProps$")));
    return {
      hiddenSegments: document.querySelectorAll("div[hidden][id^='S:']").length,
      serverOnlyControls: controls.length,
      examples: controls.slice(0, 3).map((control) =>
        `${control.tagName.toLowerCase()} ${(control.getAttribute("aria-label") ?? control.textContent ?? "").trim().slice(0, 40)}`),
    };
  });
  let state: Awaited<ReturnType<typeof read>> | undefined;
  try {
    await expect.poll(async () => {
      state = await read();
      return state.hiddenSegments + state.serverOnlyControls;
    }, { timeout: 30_000 }).toBe(0);
  } catch (error) {
    throw new Error(`The page did not hydrate: ${JSON.stringify(state ?? null)}.`, { cause: error });
  }
}

/** The journey's UI on its own server: every page it opens is hydrated before the next action. */
export function hydratedUi({ app, screen, browser }: Ui, origin: string): Ui {
  const open = async (url = "/") => {
    await app.open(new URL(url, origin).href);
    await waitForHydration(browser);
  };
  return { app: { ...app, baseUrl: origin, open }, screen, browser };
}

/** Signs `email` in with the campaign password on `origin`, once the login form handles its submission. */
export async function signIn(ui: Ui, origin: string, email: string) {
  const account = { ...credentials.user("army"), username: email };
  await hydratedUi(ui, origin).app.open("/login");
  await ui.screen.getByLabel("Email", { exact: true }).fill(account.username);
  await ui.screen.getByLabel(/Mot de passe/).fill(account.password);
  await ui.screen.getByRole("button", "Se connecter", { exact: true }).tap();
  try {
    await expect(ui.browser).toHaveURL(/\/dashboard/);
  } catch (error) {
    // A page that closes or navigates under the reading must not hide the failure it explains.
    const reading = await readStalledNavigation(ui.browser).catch((unreadable: unknown) => ({ unreadable: String(unreadable) }));
    throw new Error(`The sign-in did not reach the dashboard: ${JSON.stringify(reading)}.`, { cause: error });
  }
}

/**
 * What the page is doing when a sign-in stays on /login. LOCAL03 stayed there twice on its development server
 * (runs 43102369999 and 43158298104) after that server had answered /dashboard, the form still filled and Next's
 * indicator on « Rendering… », and nothing retained said why; 150 sign-ins in a row on an owned development server
 * did not reproduce it. Three readings tell the cases apart: the lanes React still has to render and those it
 * waits on, whether its scheduler keeps posting tasks (a render that never settles posts hundreds in half a
 * second), and which requests of the sign-in the browser has finished. Paths only: a query may carry a token.
 */
async function readStalledNavigation(browser: Browser) {
  return browser.evaluate(async () => {
    const host: Element = document.querySelector("main") ?? document.body;
    const key = Object.keys(host).find((name) => name.startsWith("__reactFiber$"));
    let fiber = key ? (host as unknown as Record<string, { return: unknown; stateNode: unknown } | undefined>)[key] : undefined;
    while (fiber?.return) fiber = fiber.return as typeof fiber;
    const root = fiber?.stateNode as Record<string, unknown> | undefined;
    const lanes = root ? Object.fromEntries(["pendingLanes", "suspendedLanes", "pingedLanes", "expiredLanes"]
      .map((name) => [name, Number(root[name]).toString(2)])) : null;
    let schedulerTasks = 0;
    const post = MessagePort.prototype.postMessage as (this: MessagePort, ...args: unknown[]) => void;
    MessagePort.prototype.postMessage = function (this: MessagePort, ...args: unknown[]) {
      schedulerTasks += 1;
      post.apply(this, args);
    } as typeof MessagePort.prototype.postMessage;
    await new Promise((resolve) => setTimeout(resolve, 500));
    MessagePort.prototype.postMessage = post as typeof MessagePort.prototype.postMessage;
    const requests = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .map((entry) => ({ entry, url: new URL(entry.name) }))
      .filter(({ url }) => url.pathname.startsWith("/dashboard") || url.pathname.startsWith("/auth/v1/"))
      .map(({ entry, url }) => `${url.pathname}${url.searchParams.has("_rsc") ? " (RSC)" : ""} ${Math.round(entry.startTime)}-${Math.round(entry.responseEnd)} ms, status ${entry.responseStatus}`);
    return { path: location.pathname, now: Math.round(performance.now()), lanes, schedulerTasksInHalfASecond: schedulerTasks, requests };
  });
}
