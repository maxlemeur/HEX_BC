import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const repositoryRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const relativePath = (file) => path.relative(repositoryRoot, file).replaceAll("\\", "/");
export const digestPattern = /^[0-9a-f]{64}$/;
export const buildCommands = [["scripts/validate-openapi-runner.mjs"], ["--max-old-space-size=4096", "node_modules/next/dist/bin/next", "build", "--webpack"], ["--import", "tsx", "scripts/check-performance-budgets.ts"]];

/**
 * Keep Next's generated config updates separate from another active dev server.
 * Vitest files are left to `npm run typecheck` (root tsconfig, verify:pr): a
 * red-first test importing a module that does not exist yet must not fail the
 * production build every TesterArmy run starts with.
 */
export async function prepareArmyTypeScriptConfig(root = repositoryRoot) {
  await mkdir(path.join(root, ".e2e/army"), { recursive: true });
  await writeFile(path.join(root, ".e2e/army/tsconfig.json"), `${JSON.stringify({
    extends: "../../tsconfig.json",
    compilerOptions: { paths: { "@/*": ["../../src/*"] } },
    include: ["../../next-env.d.ts", "../../src/**/*.ts", "../../src/**/*.tsx", "next/types/**/*.ts", "next/dev/types/**/*.ts"],
    exclude: ["../../node_modules", "../../src/**/*.test.ts", "../../src/**/*.test.tsx"],
  }, null, 2)}\n`);
}

export async function buildSourceEvidence() {
  const git = (args, encoding = "utf8") => {
    const result = spawnSync("git", ["-c", `safe.directory=${repositoryRoot}`, ...args], { cwd: repositoryRoot,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, encoding, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    requireValue(result.status === 0, "Read-only Git source evidence is unavailable.");
    return result.stdout;
  };
  const scopes = ["src", "public", "scripts", "tools", "next.config.ts", "postcss.config.mjs", "package.json", "package-lock.json", "tsconfig.json", "openapi.json"];
  const names = [...new Set([...git(["ls-files", "-z", "--", ...scopes]).split("\0"),
    ...git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...scopes]).split("\0")])].filter(Boolean).sort();
  const inputs = await Promise.all(names.map(async (file) => {
    try { return { path: file, sha256: sha256(await readFile(path.join(repositoryRoot, file))) }; }
    catch (error) { if (error.code === "ENOENT") return { path: file, missing: true }; throw error; }
  }));
  return { revision: git(["rev-parse", "HEAD"]).trim(), diffSha256: sha256(git(["diff", "HEAD", "--binary"], "buffer")), inputs };
}

/**
 * Untracked, non-ignored journey, support and TesterArmy config files (e2e/**,
 * e2e*.config.ts), with their digests: the part of a run's source identity
 * that the revision and diffSha256 (tracked changes only) leave out. Kept out
 * of buildSourceEvidence, which is also the application build identity.
 */
export function untrackedJourneyInputs(root = repositoryRoot) {
  const result = spawnSync("git", ["-c", `safe.directory=${root}`, "ls-files", "--others", "--exclude-standard", "-z", "--", "e2e", "e2e*.config.ts"],
    { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  requireValue(result.status === 0, "Read-only Git source evidence is unavailable.");
  return [...new Set(result.stdout.split("\0").filter(Boolean))].sort()
    .map((file) => ({ path: file, sha256: sha256(readFileSync(path.join(root, file))) }));
}

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

// Report artifact paths are relative to the run's SDK evidence directory:
// <output>/results since e2e 0.20 (downloads, screenshots, trace.md pages),
// <output>/artifacts before. An unidentified runner is not readable evidence.
export function sdkEvidenceDirectory(report) {
  const runner = report?.run?.runner;
  const version = runner?.name === "e2e" && typeof runner.version === "string" ? /^(\d+)\.(\d+)\.\d+/.exec(runner.version) : null;
  requireValue(version, "Report runner identity is required to locate its evidence.");
  return Number(version[1]) > 0 || Number(version[2]) >= 20 ? "results" : "artifacts";
}

export function assertRecipeHost() {
  requireValue(process.cwd() === repositoryRoot && /^v24\./.test(process.version), "Run from the repository root with Node 24.");
}

export function loopbackOrigin(value) {
  const url = new URL(value);
  requireValue(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    url.port && url.port !== "0" && !url.username && !url.password && value === url.origin,
  "An explicit loopback HTTP origin with fixed port is required.");
  return url;
}

export function nonSecretMetadata(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    requireValue(!/password|secret|token|cookie|authorization|service.?role|anon.?key/i.test(key), "Configuration must contain non-secret metadata only.");
    requireValue(typeof child !== "string" || !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(child), "Configuration must contain non-secret metadata only.");
    nonSecretMetadata(child);
  }
}

function inside(base, file) {
  const value = path.relative(base, file);
  return Boolean(value) && value !== ".." && !value.startsWith(`..${path.sep}`) && !path.isAbsolute(value);
}

export async function ignoredFile(value) {
  requireValue(typeof value === "string" && value.startsWith(".e2e/") && !value.includes("\\") &&
    !value.split("/").some((part) => !part || part === "." || part === ".."), "An explicit owned ignored evidence path is required.");
  const root = await realpath(repositoryRoot), base = await realpath(path.join(root, ".e2e"));
  requireValue(inside(root, base), "The ignored evidence directory escaped this checkout.");
  const file = await realpath(path.resolve(root, value));
  requireValue(inside(base, file) && (await stat(file)).isFile(), "The ignored evidence file escaped this checkout.");
  return file;
}

export async function readProof(value, expectedSha256) {
  requireValue(digestPattern.test(expectedSha256 ?? ""), "An explicit SHA-256 is required.");
  const file = await ignoredFile(value), bytes = await readFile(file);
  requireValue(sha256(bytes) === expectedSha256, "The evidence SHA-256 differs from its configuration.");
  return { file, bytes, data: JSON.parse(bytes.toString("utf8")), sha256: expectedSha256 };
}

export async function newEvidenceDirectory(branch, name) {
  requireValue(/^[a-z0-9/-]+$/.test(branch) && !branch.split("/").includes("..") && /^[a-zA-Z0-9-]+$/.test(name), "Invalid evidence directory.");
  await mkdir(path.join(repositoryRoot, ".e2e"), { recursive: true });
  const root = await realpath(repositoryRoot), base = await realpath(path.join(root, ".e2e"));
  requireValue(inside(root, base), "The ignored evidence directory escaped this checkout.");
  const parent = path.join(base, branch);
  await mkdir(parent, { recursive: true });
  requireValue(inside(base, await realpath(parent)), "The ignored evidence parent escaped this checkout.");
  const directory = path.join(parent, name);
  await mkdir(directory);
  return directory;
}

export async function sqlInventory(directory) {
  const files = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      requireValue(!entry.isSymbolicLink(), "Source inventories must not contain symlinks.");
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith(".sql")) files.push(file);
    }
  }
  await walk(directory);
  return Promise.all(files.sort().map(async (file) => ({ name: path.relative(directory, file).replaceAll("\\", "/"), sha256: sha256(await readFile(file)) })));
}

export function redactOutput(value, environment = process.env) {
  let text = String(value ?? "");
  for (const [key, secret] of Object.entries(environment)) {
    if (secret && /PASSWORD|SECRET|TOKEN|KEY|E2E_.*EMAIL/i.test(key)) {
      text = text.replaceAll(secret, "[REDACTED]").replaceAll(encodeURIComponent(secret), "[REDACTED]");
    }
  }
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED-JWT]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[REDACTED-DSN]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
}
