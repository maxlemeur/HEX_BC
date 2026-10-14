import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function redactSetupError(value) {
  let text = String(value);
  for (const [key, secret] of Object.entries(process.env)) {
    if (!secret || !/(?:PASSWORD|SECRET|TOKEN|API_?KEY|ANON_KEY|SERVICE_ROLE_KEY|LOGIN_EMAIL)/i.test(key)) continue;
    for (const encoded of new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), new URLSearchParams({ value: secret }).toString().slice(6)])) text = text.replaceAll(encoded, "[REDACTED]");
  }
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED-JWT]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:password|access_token|refresh_token|token|code|apikey|api_key)=)[^&\s"']*/gi, "$1[REDACTED]")
    .replace(/("(?:password|access_token|refresh_token|token|apikey|api_key)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2")
    .replace(/((?:draftLockSessionId|session_id|sessionId)(?:\\*["'])?\s*:\s*(?:\\*["'])?)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "$1[REDACTED-SESSION]");
}

export async function assertSetupPath(root, file, { allowMissing = false } = {}) {
  const base = path.resolve(root);
  const target = path.resolve(file);
  const relative = path.relative(base, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Setup evidence path is outside the workspace.");
  let current = base;
  for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) { if (error.code === "ENOENT" && allowMissing) return; throw error; }
    if (info.isSymbolicLink()) throw new Error("Setup evidence path must not contain links.");
    if (current !== target && !info.isDirectory()) throw new Error("Setup evidence parent must be a directory.");
  }
}

async function optionalBytes(root, file) {
  try {
    await assertSetupPath(root, file);
    if (!(await lstat(file)).isFile()) return { reason: "unsafe-path" };
    return { bytes: await readFile(file) };
  } catch (error) { return { reason: error.code === "ENOENT" ? "missing" : "unsafe-path" }; }
}

export async function readSetupLogBaseline(root, file) {
  const value = await optionalBytes(root, file);
  return value.reason === "missing" ? { bytes: Buffer.alloc(0) } : value;
}

export async function readSetupLogDelta(root, file, before) {
  if (!before) return { reason: "runner-not-started" };
  if (before.reason) return before;
  const after = await optionalBytes(root, file);
  if (after.reason) return after;
  if (after.bytes.length < before.bytes.length || !after.bytes.subarray(0, before.bytes.length).equals(before.bytes)) return { reason: "log-replaced" };
  const bytes = after.bytes.subarray(before.bytes.length);
  return bytes.length ? { bytes } : { reason: "no-current-bytes" };
}

async function ownedDirectory(root, directory) {
  await assertSetupPath(root, directory, { allowMissing: true });
  try { await mkdir(directory, { recursive: true }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  await assertSetupPath(root, directory);
  if (!(await lstat(directory)).isDirectory()) throw new Error("Setup archive parent must be a directory.");
}

export async function archiveSetupFailure({ root, output, manifest, runnerOutput, appLog, networkFile, inputsDirectory }) {
  const stamp = new Date(manifest.startedAt).toISOString().replace(/[:.]/g, "-");
  const runs = path.join(output, "runs");
  await ownedDirectory(root, runs);
  const archive = path.join(runs, `${stamp}-setup-failed`);
  await assertSetupPath(root, archive, { allowMissing: true });
  try { await mkdir(archive); }
  catch (error) { if (error.code === "EEXIST") throw new Error("Setup failure archive already exists; nothing was replaced."); throw error; }
  const relative = (file) => path.relative(root, file).split(path.sep).join("/");
  const failureEvidence = { scope: "unavailable fresh report; execution results unknown", appLogScope: "only bytes appended after a verified initial prefix; captured before cumulative-log redaction", files: [], unavailable: [], runnerOutputTruncated: Boolean(runnerOutput?.truncated) };
  const unavailable = (kind, reason) => failureEvidence.unavailable.push({ kind, reason });
  async function retain(kind, target, bytes) {
    if (bytes.includes(0)) { unavailable(kind, "non-text"); return; }
    const clean = redactSetupError(bytes.toString("utf8"));
    const file = path.join(archive, target);
    await ownedDirectory(root, path.dirname(file));
    await assertSetupPath(root, file, { allowMissing: true });
    await writeFile(file, clean, { flag: "wx" });
    failureEvidence.files.push({ kind, path: relative(file), sha256: digest(clean), bytes: Buffer.byteLength(clean) });
  }
  if (runnerOutput) {
    for (const stream of ["stdout", "stderr"]) {
      let bytes = Buffer.concat(runnerOutput[stream]);
      if (runnerOutput.truncated) {
        const newline = bytes.lastIndexOf(10);
        bytes = bytes.subarray(0, newline === -1 ? 0 : newline + 1);
      }
      await retain(`runner-${stream}`, `logs/runner-${stream}.log`, bytes);
    }
  } else unavailable("runner-output", "runner-not-started");
  if (appLog.bytes) await retain("app-log", "logs/app-current.log", appLog.bytes);
  else unavailable("app-log", appLog.reason);
  if (networkFile) {
    const value = await optionalBytes(root, networkFile);
    if (value.bytes) await retain("network", "server-network.jsonl", value.bytes);
    else unavailable("network", value.reason);
  } else unavailable("network", "not-configured");
  async function retainInputs(directory) {
    try {
      await assertSetupPath(root, directory);
      if (!(await lstat(directory)).isDirectory()) { unavailable("inputs", "unsafe-path"); return; }
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) { unavailable("inputs", "unsafe-path"); continue; }
        if (entry.isDirectory()) await retainInputs(file);
        else if (entry.isFile()) {
          const value = await optionalBytes(root, file);
          if (value.bytes) await retain("inputs", path.join("inputs", path.relative(inputsDirectory, file)), value.bytes);
          else unavailable("inputs", value.reason);
        } else unavailable("inputs", "unsafe-path");
      }
    } catch (error) { unavailable("inputs", error.code === "ENOENT" ? "missing" : "unsafe-path"); }
  }
  if (inputsDirectory) await retainInputs(inputsDirectory);
  else unavailable("inputs", "not-configured");
  const copy = structuredClone(manifest);
  delete copy.report;
  delete copy.artifacts;
  delete copy.tracePaths;
  copy.failureEvidence = failureEvidence;
  if (copy.result.error) copy.result.error = redactSetupError(copy.result.error);
  const file = path.join(archive, "manifest.json");
  const bytes = `${JSON.stringify(copy, null, 2)}\n`;
  await writeFile(file, bytes, { flag: "wx" });
  return { status: "retained", path: relative(archive), manifestSha256: digest(bytes) };
}
