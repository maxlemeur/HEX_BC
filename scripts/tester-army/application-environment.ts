import fs from "node:fs";
import path from "node:path";

import { createLocalCiEnvironment } from "../../src/test/supabase-cli";

/** The application port of an Army run that names none (run-tester-army-ci.ts --app-port). */
export const ARMY_DEFAULT_APP_PORT = 3107;

/**
 * The app, build and journey environment of a backend, without the ARMY account: what run-tester-army-ci.ts gives its
 * production build and server, and what the army-build job gives the build it hands the shards (army-build.ts).
 */
export function armyApplicationEnvironment(input: {
  root: string; backend: URL; anonKey: string; serviceRoleKey: string; appPort: number; recoverySecret: string;
}): NodeJS.ProcessEnv {
  const { root, backend, appPort } = input;
  fs.mkdirSync(path.join(root, ".e2e/army/coverage"), { recursive: true });
  return {
    ...createLocalCiEnvironment(process.env),
    CI: "1", E2E_TELEMETRY_DISABLED: "1", NEXT_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1",
    NEXT_PUBLIC_SUPABASE_URL: backend.origin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: input.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: input.serviceRoleKey,
    E2E_ALLOWED_SUPABASE_HOST: backend.hostname,
    E2E_ARMY_BASE_URL: `http://localhost:${appPort}`, E2E_ARMY_SERVER_MODE: "production",
    E2E_COVERAGE_BACKEND_ORIGIN: backend.origin,
    E2E_COVERAGE_NETWORK_LOG: path.join(root, ".e2e/army/coverage/ci-server-network.jsonl"),
    TAKEOFF_MODULE_ENABLED_BY_DEFAULT: "1",
    E2E_ARMY_LOCAL_RECOVERY_SECRET: input.recoverySecret,
    RESEND_API_KEY: "", EMAIL_FROM: "", GEMINI_API_KEY: "", GOOGLE_GENERATIVE_AI_API_KEY: "",
  };
}
