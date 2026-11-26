import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const launch = promisify(execFile);
const launcher = fileURLToPath(new URL("../../scripts/dev-local.mjs", import.meta.url));
const chatgpt = fileURLToPath(new URL("../../scripts/dev-chatgpt-local.mjs", import.meta.url));
const production = [
  "NEXT_PUBLIC_SUPABASE_URL=https://project-fixture.supabase.co",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-public-production",
  "SUPABASE_SERVICE_ROLE_KEY=fixture-service-production",
].join("\n");
const local = [
  "NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-public-local",
].join("\n");

async function withDevFixture(
  run: (start: (args?: string[], options?: { script?: string; env?: Partial<NodeJS.ProcessEnv> }) => Promise<{
    code: number | null; stdout: string; stderr: string;
  }>, cwd: string) => Promise<void>,
) {
  const cwd = await mkdtemp(join(tmpdir(), "mergeone-dev-target-"));
  try {
    const nextDir = join(cwd, "node_modules/next/dist/bin");
    await mkdir(nextDir, { recursive: true });
    await writeFile(join(nextDir, "next"), `
      console.log(JSON.stringify({
        args: process.argv.slice(2),
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        target: process.env.MERGEONE_DEV_SUPABASE_TARGET,
        chatgpt: process.env.MERGEONE_CHATGPT_LOCAL,
      }));
    `);
    await writeFile(join(cwd, ".env.local"), production);
    const env = { ...process.env };
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY", "E2E_ARMY", "MERGEONE_CHATGPT_LOCAL", "MERGEONE_DEV_SUPABASE_TARGET"]) delete env[key];
    const start = async (args: string[] = [], options: { script?: string; env?: Partial<NodeJS.ProcessEnv> } = {}) => {
      try {
        const result = await launch(process.execPath, [options.script ?? launcher, ...args], {
          cwd, env: { ...env, ...options.env }, timeout: 4000,
        });
        return { ...result, code: 0 };
      } catch (error) {
        return error as { code: number | null; stdout: string; stderr: string };
      }
    };
    await run(start, cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function childSettings(stdout: string) {
  return JSON.parse(stdout.split("\n").find((line) => line.startsWith("{")) ?? "null");
}

describe("development Supabase target", () => {
  it("blocks a hosted .env.local on the default launcher before Next starts", async () => {
    await withDevFixture(async (start) => {
      const result = await start(["--port", "3001"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("--supabase=production");
      expect(result.stderr).not.toContain("fixture-service-production");
    });
  });

  it("uses a dedicated loopback configuration without inheriting the production service key", async () => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, ".env.supabase.local"), local);
      const result = await start(["--port", "3001"]);
      expect(result.code).toBe(0);
      expect(childSettings(result.stdout)).toEqual({
        args: ["dev", "--hostname", "127.0.0.1", "--port", "3001"],
        url: "http://localhost:54321",
        publicKey: "fixture-public-local",
        serviceKey: "",
        target: "local",
      });
    });
  });

  it("requires its own public key even when the hosted configuration has one", async () => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, ".env.supabase.local"), "NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321");
      const result = await start();
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    });
  });

  it("selects production explicitly, without local workers or service privileges", async () => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, ".env.supabase.local"), local);
      const result = await start(["--supabase=production", "-p", "3002"], {
        script: chatgpt,
        env: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-shell-local" },
      });
      expect(result.code).toBe(0);
      expect(childSettings(result.stdout)).toEqual({
        args: ["dev", "--hostname", "127.0.0.1", "-p", "3002"],
        url: "https://project-fixture.supabase.co",
        publicKey: "fixture-public-production",
        serviceKey: "",
        chatgpt: "0",
        target: "production",
      });
    });
  });

  it("refuses a non-loopback Next listener in production mode", async () => {
    await withDevFixture(async (start) => {
      const result = await start(["--supabase=production", "--hostname", "127.0.0.1", "-H0.0.0.0"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/loopback/i);
    });
  });

  it("preserves the owned TesterArmy setup for the ChatGPT launcher", async () => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, ".env.supabase.local"), local);
      const result = await start(["--webpack", "--port", "3120"], {
        script: chatgpt,
        env: {
          E2E_ARMY: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:51234",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-public-army", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-army",
        },
      });
      expect(result.code).toBe(0);
      expect(childSettings(result.stdout)).toMatchObject({
        args: ["dev", "--hostname", "127.0.0.1", "--webpack", "--port", "3120"],
        url: "http://127.0.0.1:51234",
        publicKey: "fixture-public-army",
        serviceKey: "fixture-service-army",
        chatgpt: "1",
      });
    });
  });

  it("keeps Next help available with no database configuration", async () => {
    await withDevFixture(async (start, cwd) => {
      await rm(join(cwd, ".env.local"));
      const result = await start(["--help"]);
      expect(result.code).toBe(0);
      expect(childSettings(result.stdout)).toMatchObject({ args: ["dev", "--hostname", "127.0.0.1", "--help"] });
    });
  });
});
