import { request as httpRequest } from "node:http";
import { createServerClient } from "@supabase/ssr";
import type { Browser } from "@e2e-dev/web";
import { expect, type JsonValue } from "e2e";

// Helpers of the takeoff lab journeys (TI-661 LAB0x, TI-662 VEC01): a local
// account's session cookies as the browser holds them, requests with an
// explicit Host header (fetch cannot set one) to prove the 127.0.0.1 check,
// and the launch of an essai read from its own response.
// Nothing here logs a cookie, a password or a body.

const LAB_RUNS = "**/api/admin/takeoff/lab/runs";

type LabLaunchResponse = { status: number; body: JsonValue };
type LaunchCapture = { original: typeof fetch; posts: number; response: LabLaunchResponse | null; failed: boolean };
type LaunchWindow = Window & { __armyLabLaunch?: LaunchCapture };

/**
 * Triggers a launch and returns its HTTP status and parsed JSON body. browser.waitForResponse matches a URL only.
 * The page loads its history with a GET of the launch's URL (on mount, twice in development): on a loaded runner a history load
 * still in flight at the click answered first, its 200 was read as the launch's, and the journey's cleanup then removed
 * the key under the launch still running (#398). The page's own fetch is observed instead, for its POST only, without
 * changing the request or the reply. The body is read from a clone.
 */
export async function launchLabRun(browser: Browser, trigger: () => Promise<void>): Promise<LabLaunchResponse> {
  await browser.evaluate((pathname) => {
    const capture: LaunchCapture = { original: window.fetch, posts: 0, response: null, failed: false };
    (window as LaunchWindow).__armyLabLaunch = capture;
    window.fetch = async (input, init) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (method !== "POST" || url.origin !== location.origin || url.pathname !== pathname) return capture.original.call(window, input, init);
      capture.posts += 1;
      try {
        const response = await capture.original.call(window, input, init);
        void response.clone().json().catch(() => null).then((body: JsonValue) => {
          capture.response = { status: response.status, body };
        });
        return response;
      } catch (error) {
        capture.failed = true;
        throw error;
      }
    };
    return true;
  }, "/api/admin/takeoff/lab/runs");
  try {
    await trigger();
    await expect.poll(() => browser.evaluate(() => {
      const capture = (window as LaunchWindow).__armyLabLaunch;
      return !capture || capture.response !== null || capture.failed;
    }), { timeout: 120_000, message: "The launch (POST /api/admin/takeoff/lab/runs) never answered." }).toBe(true);
    const capture = await browser.evaluate(() => {
      const capture = (window as LaunchWindow).__armyLabLaunch;
      return capture ? { posts: capture.posts, response: capture.response, failed: capture.failed } : null;
    });
    // One launch for the click, and it answered.
    expect(capture?.posts).toBe(1);
    expect(capture?.failed).toBe(false);
    if (!capture?.response) throw new Error("The launch response could not be captured.");
    return capture.response;
  } finally {
    await browser.evaluate(() => {
      const scope = window as LaunchWindow;
      if (scope.__armyLabLaunch) {
        window.fetch = scope.__armyLabLaunch.original;
        delete scope.__armyLabLaunch;
      }
      return true;
    });
  }
}

/**
 * The order that turned main red in #398, made certain. The page loads its history with a GET of the runs URL (on
 * mount, twice in development): those loads are held until the first launch (a POST to the same URL) leaves the page,
 * and answer before it is sent. A launch read from the first response to that URL then reads a history's 200.
 * `reproduced()` says that order took place, for the journey to assert (an error thrown in a route handler can be
 * swallowed by the next poll); `release()` frees the held loads of a journey that stops before launching.
 */
export async function holdLabHistoryUntilLaunch(browser: Browser) {
  let open!: () => void;
  const launched = new Promise<void>((resolve) => { open = resolve; });
  let held = 0;
  let done = false;
  let reproduced = false;
  await browser.route(LAB_RUNS, async (route) => {
    if (!done && route.request.method === "GET") {
      held += 1;
      await launched;
    } else if (!done && route.request.method === "POST") {
      done = true;
      try {
        if (held > 0) {
          const answered = browser.waitForResponse(LAB_RUNS, { timeout: 30_000 });
          open();
          await answered;
          reproduced = true;
        }
      } finally {
        open();
        await route.fallback();
      }
      return;
    }
    await route.fallback();
  });
  return { reproduced: () => reproduced, release: () => { done = true; open(); } };
}

/** Supabase SSR cookies of a local account, as the browser would hold them; nothing is logged. */
export async function labSessionCookies(email: string) {
  const jar = new Map<string, string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => { for (const { name, value } of values) jar.set(name, value); } },
  });
  const login = await client.auth.signInWithPassword({ email, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error) throw new Error("Lab fixture login failed.");
  return { jar, header: [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ") };
}

export type LabRawRequest = { method: string; path: string; host: string; cookie?: string; body?: unknown; origin?: string; contentType?: string };

/** A request to the local server on 127.0.0.1:`port` with an explicit Host header. */
export function rawLabRequest(port: number, input: LabRawRequest) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const payload = input.body === undefined ? undefined : JSON.stringify(input.body);
    const request = httpRequest({ host: "127.0.0.1", port, method: input.method, path: input.path,
      headers: { host: input.host, ...(input.cookie ? { cookie: input.cookie } : {}), ...(input.origin ? { origin: input.origin } : {}),
        ...(payload ? { "content-type": input.contentType ?? "application/json" } : {}) } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    request.setTimeout(120_000, () => request.destroy(new Error("Lab request timed out.")));
    request.end(payload);
  });
}
