import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectProcessEnvKeysFromDirectory,
  collectProcessEnvKeysFromSource,
  isInventorySourceFile,
  parseEnvExampleKeys,
  PLATFORM_ENV_KEYS,
} from "@/test/env-inventory";

const ROOT_DIRECTORY = process.cwd();

describe("env inventory", () => {
  it("extracts process.env keys from direct, quoted, bound, typed, and forwarded access", () => {
    expect(
      collectProcessEnvKeysFromSource(`
        const bound = "ESTIMATE_BATCH_MAX_OPERATIONS";
        void process.env.NEXT_PUBLIC_SUPABASE_URL;
        void process.env["ENABLE_OPENAPI_DOCS"];
        void process.env[bound];
        function readSecret(name: "RESEND_API_KEY" | "EMAIL_FROM") {
          return process.env[name];
        }
        function readFlag(envVarKey: string) {
          return process.env[envVarKey];
        }
        readFlag("TAKEOFF_LEVEL_C_TIMEOUT_MS");
      `)
    ).toEqual([
      "EMAIL_FROM",
      "ENABLE_OPENAPI_DOCS",
      "ESTIMATE_BATCH_MAX_OPERATIONS",
      "NEXT_PUBLIC_SUPABASE_URL",
      "RESEND_API_KEY",
      "TAKEOFF_LEVEL_C_TIMEOUT_MS",
    ]);
  });

  it("parses .env.example assignments and ignores comments", () => {
    expect(
      parseEnvExampleKeys(`
# Runtime
NEXT_PUBLIC_SUPABASE_URL=
# GEMINI_API_KEY=ignored-comment
EMAIL_FROM=
      `)
    ).toEqual(["EMAIL_FROM", "NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("skips tests, declaration files, and src/test when scanning the tree", () => {
    expect(isInventorySourceFile("src/lib/supabase/server.ts")).toBe(true);
    expect(isInventorySourceFile("src/lib/supabase/server.test.ts")).toBe(false);
    expect(isInventorySourceFile("src/test/env-inventory.ts")).toBe(false);
    expect(isInventorySourceFile("src/types/database.ts")).toBe(true);
    expect(isInventorySourceFile("src/types/side-effect-imports.d.ts")).toBe(false);

    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "env-inventory-"));
    fs.mkdirSync(path.join(rootDirectory, "src", "lib"), { recursive: true });
    fs.mkdirSync(path.join(rootDirectory, "src", "test"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "src", "lib", "runtime.ts"),
      'void process.env.GEMINI_API_KEY;\n'
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src", "lib", "runtime.test.ts"),
      'void process.env.RLS_E2E;\n'
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src", "test", "helper.ts"),
      'void process.env.E2E_LOGIN_EMAIL;\n'
    );

    expect(collectProcessEnvKeysFromDirectory(rootDirectory)).toEqual([
      "GEMINI_API_KEY",
    ]);
    fs.rmSync(rootDirectory, { force: true, recursive: true });
  });

  // Whole-tree scan: explicit budget instead of the 5s default (observed 3.2s
  // idle, over the limit under CI contention).
  it(
    "requires every src process.env key to appear in .env.example except the platform allowlist",
    () => {
      const documented = new Set(
        parseEnvExampleKeys(
          fs.readFileSync(path.join(ROOT_DIRECTORY, ".env.example"), "utf8")
        )
      );
      const allowlist = new Set<string>(PLATFORM_ENV_KEYS);
      const missing = collectProcessEnvKeysFromDirectory(ROOT_DIRECTORY).filter(
        (key) => !documented.has(key) && !allowlist.has(key)
      );

      expect(PLATFORM_ENV_KEYS).toEqual([
        "CI",
        "NODE_ENV",
        "VERCEL_ENV",
        "NEXT_RUNTIME",
      ]);
      expect(missing).toEqual([]);
    },
    30_000
  );
});
