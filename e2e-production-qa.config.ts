import { web, surfaceOf } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";
import { defineEngine } from "e2e/engine";

export const origin = "https://hex-bc.vercel.app";
// Public project and dedicated tenant identifiers recorded in the shared QA purge receipt.
export const authTokenUrl = "https://ijropnynpwjbllievrip.supabase.co/auth/v1/token?grant_type=password";
export const qaTenantId = "a8d1292a-bfd1-4a44-9820-dc9536ecad25";
export const output = ".e2e/production-qa";

// Even with trace off, TesterArmy collects failure screenshots and screen text when
// the engine can. Keep exact locators but opt out of failure capture and app logging.
const engine = web({ headers: {} }); // Blocks service workers, which bypass HTTP routing.
const live = surfaceOf(engine)!;
const hooks = { ...engine };
// defineEngine computes its own capability manifest from the hooks below.
Reflect.deleteProperty(hooks, "capabilities");
const privateEngine = defineEngine({
  ...hooks,
  artifacts: undefined,
  state: undefined,
  observe: async () => { throw new Error("QA_OBSERVATION_DISABLED"); },
  async startAttempt(context) {
    await engine.startAttempt!({
      ...context,
      appLog: () => {},
      navigation: () => {},
      screen: undefined,
    });
    await live.context().routeWebSocket("**/*", (socket) => socket.close());
  },
});

export default {
  tests: ["e2e/production-qa/production-qa.e2e.ts"],
  output,
  targets: [{ engine: privateEngine, app: { url: origin } }],
  credentials: {
    qa: {
      username: "qa@example.invalid",
      password: () => process.env.E2E_LOGIN_PASSWORD ?? "",
    },
  },
  secrets: {
    qaEmail: () => process.env.E2E_LOGIN_EMAIL ?? "",
  },
  workers: 1,
  retries: 0,
  cache: "off",
  trace: "off",
  video: "off",
} satisfies E2EConfig;
