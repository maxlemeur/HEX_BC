import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const launch = promisify(execFile);
const launcher = fileURLToPath(new URL("../../scripts/dev-local.mjs", import.meta.url));
const chatgpt = fileURLToPath(new URL("../../scripts/dev-chatgpt-local.mjs", import.meta.url));
const packageJson = new URL("../../package.json", import.meta.url);
const scripts = fileURLToPath(new URL("../../scripts", import.meta.url));
const productionPublic = [
  "NEXT_PUBLIC_SUPABASE_URL=https://project-fixture.supabase.co",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-public-production",
].join("\n");
const production = `${productionPublic}\nSUPABASE_SERVICE_ROLE_KEY=fixture-service-production`;
const local = [
  "NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-public-local",
].join("\n");
const fullTarget = "--supabase=production-full";
const restrictedTarget = "--supabase=production";
const productionConfigFile = ".env.supabase.production.local";
const nextEnv = createRequire(import.meta.url).resolve("@next/env");
const nonLoopbackHostOptions = [
  ["--hostname", "0.0.0.0"], ["--hostname=0.0.0.0"],
  ["-H", "0.0.0.0"], ["-H0.0.0.0"], ["-H=0.0.0.0"],
];

async function withDevFixture(
  run: (start: (args?: string[], options?: { script?: string; npmScript?: string; env?: Partial<NodeJS.ProcessEnv> }) => Promise<{
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
    const start = async (args: string[] = [], options: { script?: string; npmScript?: string; env?: Partial<NodeJS.ProcessEnv> } = {}) => {
      if (options.npmScript) {
        await copyFile(packageJson, join(cwd, "package.json"));
        await symlink(scripts, join(cwd, "scripts"));
      }
      try {
        const [command, commandArgs] = options.npmScript
          ? ["npm", ["run", options.npmScript, "--", ...args]]
          : [process.execPath, [options.script ?? launcher, ...args]];
        const result = await launch(command, commandArgs, { cwd, env: { ...env, ...options.env }, timeout: 4000 });
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

describe("npm run start port convention", () => {
  it.each([
    { npmScript: "start", args: [], portEnv: undefined, port: "3000" },
    { npmScript: "start", args: ["-p3009"], portEnv: "4200", port: "3009" },
    { npmScript: "start:local", args: [], portEnv: "4200", port: "3001" },
  ])("uses local Supabase on $port", async ({ npmScript, args, portEnv, port }) => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, ".env.supabase.local"), local);
      const result = await start(args, { npmScript, env: { PORT: portEnv } });
      expect(result.code, result.stderr).toBe(0);
      expect(childSettings(result.stdout)).toMatchObject({
        args: ["dev", "--hostname", "127.0.0.1", "--port", port],
        url: "http://localhost:54321",
        publicKey: "fixture-public-local",
        serviceKey: "",
        target: "local",
      });
    });
  });

  it.each([
    { npmScript: "start", args: ["--port=4200"], portEnv: "3002", port: "4200" },
    { npmScript: "start", args: [], portEnv: "4209", port: "4209" },
    { npmScript: "start:prod", args: [], portEnv: "3002", port: "4200" },
  ])("uses full production Supabase with $npmScript on $port", async ({ npmScript, args, portEnv, port }) => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, ".env.supabase.local"), local);
      await writeFile(join(cwd, productionConfigFile), production);
      await writeFile(join(cwd, ".env.local"), productionPublic.replace("project-fixture", "other-fixture"));
      const result = await start(args, {
        npmScript,
        env: { PORT: portEnv, MERGEONE_CHATGPT_LOCAL: "0", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-shell" },
      });
      expect(result.code, result.stderr).toBe(0);
      expect(childSettings(result.stdout)).toEqual({
        args: ["dev", "--hostname", "127.0.0.1", "--port", port],
        url: "https://project-fixture.supabase.co",
        publicKey: "fixture-public-production",
        serviceKey: "fixture-service-production",
        chatgpt: "1",
        target: "production-full",
      });
    });
  });

  it("requires the dedicated full production configuration even when shell and Next settings exist", async () => {
    await withDevFixture(async (start) => {
      const result = await start([], {
        npmScript: "start:prod",
        env: { SUPABASE_SERVICE_ROLE_KEY: "fixture-service-shell" },
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(productionConfigFile);
      expect(result.stderr).not.toContain("fixture-service-shell");
      expect(childSettings(result.stdout)).toBeNull();
    });
  });

  it.each(["300", "3010", "420", "4210", "4200oops"])("rejects port %s before starting Next", async (port) => {
    await withDevFixture(async (start) => {
      const result = await start(["--port", port], { npmScript: "start" });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("3000–3009");
      expect(result.stderr).toContain("4200–4209");
      expect(childSettings(result.stdout)).toBeNull();
    });
  });

  it.each(["--supabase=production-full", "--hostname=0.0.0.0"])("rejects %s on the local launcher", async (option) => {
    await withDevFixture(async (start) => {
      const result = await start(["--port", "4200", option], { npmScript: "start" });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown option");
      expect(childSettings(result.stdout)).toBeNull();
    });
  });

  it("keeps the local shortcut from switching to production through an extra port option", async () => {
    await withDevFixture(async (start) => {
      const result = await start(["--port", "4200"], { npmScript: "start:local" });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Pass the port once");
      expect(childSettings(result.stdout)).toBeNull();
    });
  });
});

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

  it("runs dev:prod with restricted production rights and forwards the port", async () => {
    await withDevFixture(async (start) => {
      const result = await start(["--port", "3001"], {
        npmScript: "dev:prod", env: { MERGEONE_CHATGPT_LOCAL: "1" },
      });
      expect(result.code, result.stderr).toBe(0);
      expect(childSettings(result.stdout)).toEqual({
        args: ["dev", "--hostname", "127.0.0.1", "--port", "3001"],
        url: "https://project-fixture.supabase.co",
        publicKey: "fixture-public-production",
        serviceKey: "",
        chatgpt: "0",
        target: "production",
      });
    });
  });

  describe.each([restrictedTarget, fullTarget])("binding for %s", (target) => {
    it.each(nonLoopbackHostOptions.map((args) => ({ spelling: args.join(" "), args })))(
      "refuses $spelling even after an explicit loopback binding",
      async ({ args }) => {
        await withDevFixture(async (start) => {
          const result = await start([target, "--hostname", "127.0.0.1", ...args]);
          expect(result.code).toBe(1);
          expect(result.stdout).toBe("");
          expect(result.stderr).toMatch(/loopback/i);
        });
      },
    );
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

  describe.each([
    { mode: "local", target: [] },
    { mode: "production", target: [restrictedTarget] },
    { mode: "production-full", target: [fullTarget] },
  ])("legacy service key warning for $mode", ({ target }) => {
    it.each([".env.local", ".env"])("warns once when %s would give direct Next production service rights", async (file) => {
      await withDevFixture(async (start, cwd) => {
        await writeFile(join(cwd, ".env.supabase.local"), local);
        await writeFile(join(cwd, productionConfigFile), production);
        await rm(join(cwd, ".env.local"));
        await writeFile(join(cwd, file), production);
        if (file === ".env.local") await writeFile(join(cwd, ".env"), production);

        const result = await start(target);
        expect(result.code, result.stderr).toBe(0);
        const warnings = result.stderr.split("\n").filter((line) => line.includes("Direct next dev"));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("would hold production's service rights");
        expect(warnings[0]).toContain(`from ${file}.`);
        expect(warnings[0]).toContain(productionConfigFile);
        expect(result.stderr).not.toContain("fixture-service-production");
        expect(result.stderr).not.toContain("project-fixture.supabase.co");
      });
    });
  });
});

describe("full production Supabase target", () => {
  it.each(["development", "production"] as const)("keeps the full service key out of Next's direct %s environment", async (nodeEnv) => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, productionConfigFile), production);
      await writeFile(join(cwd, ".env.local"), productionPublic);
      const launched = await start([fullTarget]);
      expect(launched.code, launched.stderr).toBe(0);
      expect(childSettings(launched.stdout)).toMatchObject({ serviceKey: "fixture-service-production" });
      expect(launched.stderr).not.toContain("Direct next dev");

      const direct = await launch(process.execPath, ["-e", `
        require(${JSON.stringify(nextEnv)}).loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development");
        console.log(JSON.stringify({
          url: process.env.NEXT_PUBLIC_SUPABASE_URL,
          publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          hasServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined,
        }));
      `], { cwd, env: { NODE_ENV: nodeEnv }, timeout: 4000 });
      expect(childSettings(direct.stdout)).toEqual({
        url: "https://project-fixture.supabase.co",
        publicKey: "fixture-public-production",
        hasServiceKey: false,
      });
    });
  });

  it.each([
    ["dev:prod:full", []],
    ["dev", [fullTarget]],
    ["dev:chatgpt", [fullTarget]],
  ])("starts through npm run %s with the file's service rights and enables local ChatGPT", async (npmScript, targetArgs) => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, productionConfigFile), production);
      await writeFile(join(cwd, ".env.local"), productionPublic.replace("project-fixture", "other-fixture")
        .replace("fixture-public-production", "fixture-public-other"));
      await writeFile(join(cwd, ".env.supabase.local"), local);
      await writeFile(join(cwd, ".env.development.local"), local);
      await writeFile(join(cwd, ".env"), local);
      const result = await start([...targetArgs, "--hostname=localhost", "--port", "3001"], {
        npmScript,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: "https://shell-fixture.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-public-shell",
          SUPABASE_SERVICE_ROLE_KEY: "fixture-service-shell",
          MERGEONE_CHATGPT_LOCAL: "0",
        },
      });
      expect(result.code, result.stderr).toBe(0);
      expect(childSettings(result.stdout)).toEqual({
        args: ["dev", "--hostname=localhost", "--port", "3001"],
        url: "https://project-fixture.supabase.co",
        publicKey: "fixture-public-production",
        serviceKey: "fixture-service-production",
        chatgpt: "1",
        target: "production-full",
      });
      expect(result.stdout.split("\n").filter((line) => line === "This server holds production's service rights.")).toHaveLength(1);
    });
  });

  it("falls back to .env for restricted public settings when .env.local has no public settings", async () => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, ".env.local"), "SUPABASE_SERVICE_ROLE_KEY=fixture-service-other");
      await writeFile(join(cwd, ".env"), production);
      const result = await start([restrictedTarget]);
      expect(result.code, result.stderr).toBe(0);
      expect(childSettings(result.stdout)).toMatchObject({
        args: ["dev", "--hostname", "127.0.0.1"],
        url: "https://project-fixture.supabase.co",
        publicKey: "fixture-public-production",
        serviceKey: "",
      });
    });
  });

  it("requires a service key alongside the public settings in the dedicated production file", async () => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, productionConfigFile), productionPublic);
      await writeFile(join(cwd, ".env"), production);
      const result = await start([fullTarget], { env: { SUPABASE_SERVICE_ROLE_KEY: "fixture-service-shell" } });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`SUPABASE_SERVICE_ROLE_KEY in ${productionConfigFile}.`);
    });
  });

  it("names the dedicated file when its service key is blank", async () => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, productionConfigFile), production.replace("fixture-service-production", '"  "'));
      const result = await start([fullTarget]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`SUPABASE_SERVICE_ROLE_KEY in ${productionConfigFile}.`);
    });
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])("refuses when %s is absent from the dedicated file even with a complete .env", async (missing) => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, productionConfigFile), production.split("\n").filter((line) => !line.startsWith(`${missing}=`)).join("\n"));
      await writeFile(join(cwd, ".env"), production);
      const result = await start([fullTarget]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY together in ${productionConfigFile}.`);
    });
  });

  it.each([".env.local", ".env"])("refuses to use %s in place of the missing dedicated file", async (file) => {
    await withDevFixture(async (start, cwd) => {
      await rm(join(cwd, ".env.local"));
      await writeFile(join(cwd, file), production);
      const result = await start([fullTarget]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(productionConfigFile);
    });
  });

  it("rejects shell and Next development overrides as the only production sources", async () => {
    await withDevFixture(async (start, cwd) => {
      await rm(join(cwd, ".env.local"));
      await writeFile(join(cwd, ".env.development.local"), production);
      const result = await start([fullTarget], { env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://shell-fixture.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-public-shell",
        SUPABASE_SERVICE_ROLE_KEY: "fixture-service-shell",
      } });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY together in ${productionConfigFile}.`);
    });
  });

  it.each(["http://project-fixture.supabase.co", "https://localhost:54321"])("refuses the full target URL %s", async (url) => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, productionConfigFile), production.replace("https://project-fixture.supabase.co", url));
      const result = await start([fullTarget]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("requires a hosted HTTPS URL");
    });
  });

  it.each([
    "sb_secret_fixture",
    `fixture.${Buffer.from('{"role":"service_role"}').toString("base64url")}.fixture`,
    "fixture-service-production",
  ])("refuses a privileged key in the public slot (%s)", async (publicKey) => {
    await withDevFixture(async (start, cwd) => {
      await writeFile(join(cwd, productionConfigFile), production.replace("fixture-public-production", publicKey));
      const result = await start([fullTarget]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("must be a public Supabase key");
      expect(result.stderr).not.toContain(publicKey);
    });
  });

  it("refuses the full target under TesterArmy", async () => {
    await withDevFixture(async (start) => {
      const result = await start([fullTarget], { env: { E2E_ARMY: "1" } });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("outside TesterArmy");
    });
  });
});
