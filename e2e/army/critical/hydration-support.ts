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
  await expect(ui.browser).toHaveURL(/\/dashboard/);
}
