import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runLocalDevSupabase } from "./local-dev-supabase";

const stackId = "a".repeat(64);
const apiPort = 43211;
const statusOutput = [
  `API_URL="http://127.0.0.1:${apiPort}"`,
  "ANON_KEY=sb_publishable_fixture",
  "SERVICE_ROLE_KEY=sb_secret_fixture",
].join("\n");

describe("persistent local development Supabase", () => {
  let directory: string;
  let checkout: string;
  let home: string;
  let commands: string[][];
  let registryFile: string;
  let account: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mergeone-dev-stack-test-"));
    checkout = path.join(directory, "checkout");
    home = path.join(directory, "home");
    fs.mkdirSync(path.join(checkout, "supabase", "migrations"), { recursive: true });
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(checkout, "supabase", "config.toml"), 'project_id = "test"\n[api]\nport = 54321\n');
    fs.writeFileSync(path.join(checkout, "supabase", "migrations", "20260101120000_first.sql"), "select 1;");
    registryFile = path.join(home, ".supabase", "stacks", stackId, "state.json");
    commands = [];
    account = vi.fn(async () => {});
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  function run(args: string[], environment: Record<string, string> = {}, output = statusOutput) {
    return runLocalDevSupabase(args, {
      checkout, homeDirectory: home, environment,
      log: () => {},
      assertIgnored: () => {},
      prepareConfig: async (_checkout, projectId) => ({
        config: `project_id = "${projectId}"\n[experimental]\nstack = true\n[api]\nport = ${apiPort}\n`,
        ports: { 54321: apiPort },
      }),
      acquireStart: async () => () => {},
      ensureAccount: account,
      cli: (command, workdir) => {
        commands.push(command);
        if (command[0] === "start") {
          fs.mkdirSync(path.dirname(registryFile), { recursive: true });
          fs.writeFileSync(registryFile, JSON.stringify({
            id: stackId, identity: { projectRoot: workdir, stackName: "default", branchContext: "ordinary-workspace" },
          }));
        }
        if (command[0] === "status" && !fs.existsSync(registryFile)) return null;
        if (command[0] === "status") return output;
        if (command[0] === "migration" && command[1] === "list") {
          const files = fs.readdirSync(path.join(workdir, "supabase", "migrations"));
          return JSON.stringify({ migrations: files.map((file) => {
            const version = file.split("_", 1)[0];
            return { local: version, remote: version };
          }) });
        }
        if (command[0] === "stack") fs.rmSync(path.dirname(registryFile), { recursive: true });
        return "";
      },
    });
  }

  it.each(["start", "status", "stop", "destroy"])("refuses inherited credentials on %s", async (action) => {
    await expect(run([action], { DATABASE_URL: "postgresql://remote.example/postgres" })).rejects.toThrow(/refuses.*DATABASE_URL/);
    expect(commands).toEqual([]);
  });

  it("refuses a remote URL in CLI status before passing any credential to the backend or checkout", async () => {
    const remote = statusOutput.replace(`http://127.0.0.1:${apiPort}`, "https://remote.example");
    await expect(run(["start"], {}, remote)).rejects.toThrow(/loopback/);
    expect(account).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(checkout, ".env.supabase.local"))).toBe(false);
  });

  it("refuses a remote dedicated dotenv without reading or replacing the regular .env.local", async () => {
    const envPath = path.join(checkout, ".env.supabase.local");
    const remote = "NEXT_PUBLIC_SUPABASE_URL=https://remote.example\n";
    fs.writeFileSync(envPath, remote);
    fs.symlinkSync("missing", path.join(checkout, ".env.local"));
    await expect(run(["start"])).rejects.toThrow(/loopback/);
    expect(commands).toEqual([]);
    expect(fs.readFileSync(envPath, "utf8")).toBe(remote);
    expect(fs.readlinkSync(path.join(checkout, ".env.local"))).toBe("missing");
  });

  it("requires confirmation and refuses a foreign registry identity without issuing a stop or destroy", async () => {
    await run(["start"]);
    commands.length = 0;
    await expect(run(["destroy"])).rejects.toThrow(/--yes/);
    const original = fs.readFileSync(registryFile, "utf8");
    const foreign = JSON.parse(original);
    foreign.identity.projectRoot = checkout;
    fs.writeFileSync(registryFile, JSON.stringify(foreign));
    await expect(run(["destroy", "--yes"])).rejects.toThrow(/identity/);
    expect(commands).toEqual([]);
    expect(fs.existsSync(registryFile)).toBe(true);
    fs.writeFileSync(registryFile, original);
    await run(["destroy", "--yes"]);
    expect(commands).toEqual([
      ["stop", "--stack-id", stackId],
      ["stack", "destroy", "--yes", "--stack-id", stackId],
    ]);
    expect(fs.existsSync(registryFile)).toBe(false);
  });

  it("keeps credentials private and exports identical mode-0600 files into both checkouts", async () => {
    const other = path.join(directory, "other");
    fs.mkdirSync(other);
    const env = path.join(checkout, ".env.supabase.local");
    fs.writeFileSync(env, "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8765\n", { mode: 0o644 });
    await run(["start", "--checkout", other]);
    const otherEnv = path.join(other, ".env.supabase.local");
    expect(fs.readFileSync(otherEnv, "utf8")).toBe(fs.readFileSync(env, "utf8"));
    expect(fs.statSync(otherEnv).mode & 0o777).toBe(0o600);
    expect(fs.statSync(env).mode & 0o777).toBe(0o600);
    const login = path.join(home, ".supabase", "mergeone-dev", "active", "login.json");
    expect(fs.statSync(login).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(login)).mode & 0o777).toBe(0o700);
  });

  it("reuses the existing stack and applies new migrations without resetting or reprovisioning", async () => {
    await run(["start"]);
    commands.length = 0;
    fs.writeFileSync(path.join(checkout, "supabase", "migrations", "20260102120000_second.sql"), "select 2;");
    await run(["start"]);
    expect(commands).toEqual(expect.arrayContaining([["migration", "up"]]));
    expect(commands.some(([command]) => ["start", "db", "stop", "stack"].includes(command))).toBe(false);
    expect(account).toHaveBeenCalledTimes(1);
  });

  it("keeps the database and declines to migrate from a checkout with divergent applied SQL", async () => {
    await run(["start"]);
    commands.length = 0;
    fs.writeFileSync(path.join(checkout, "supabase", "migrations", "20260101120000_first.sql"), "select 2;");
    await expect(run(["start"])).rejects.toThrow(/changed applied migration.*destroy --yes/);
    expect(commands).toEqual([["status", "--env", "--stack-id", stackId]]);
    expect(fs.existsSync(registryFile)).toBe(true);
    expect(account).toHaveBeenCalledTimes(1);
  });
});
