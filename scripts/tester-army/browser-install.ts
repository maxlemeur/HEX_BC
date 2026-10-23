import fs from "node:fs";
import path from "node:path";

import { SafeDiagnosticError } from "../../src/test/local-supabase-ci";

type InstallStatus = "success" | "failed" | "invalid_exit" | "timeout" | "read_error";
type RetentionStatus = "retained" | "missing" | "read_error" | "redaction_error" | "write_error";

const TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 500;
const LOG_FILE = "browser-install.log";
const FAILURE_MESSAGES: Record<Exclude<InstallStatus, "success">, string> = {
  failed: "The background Chromium install failed with a nonzero exit code; see browser-install evidence.",
  invalid_exit: "The background Chromium install returned an invalid exit status; see browser-install evidence.",
  timeout: "The background Chromium install did not finish within 10 minutes; see browser-install evidence.",
  read_error: "The background Chromium install exit status could not be read; see browser-install evidence.",
};

// Retention is diagnostic only: it must neither hide an install failure nor
// turn a successful install into a failed qualification before the SDK runs.
function retainLog(input: { directory: string; evidence: string; redact: (value: string) => string }): RetentionStatus {
  let log: string;
  try { log = fs.readFileSync(path.join(input.directory, "install.log"), "utf8"); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "read_error"; }
  try { log = input.redact(log); }
  catch { return "redaction_error"; }
  try { fs.writeFileSync(path.join(input.evidence, LOG_FILE), log); }
  catch { return "write_error"; }
  return "retained";
}

export async function awaitBrowserInstall(input: {
  directory: string;
  evidence: string;
  manifest: Record<string, unknown>;
  redact: (value: string) => string;
}) {
  const { directory, manifest } = input;
  if (!path.isAbsolute(directory)) throw new SafeDiagnosticError("ARMY_BROWSER_INSTALL_DIR must be an absolute directory.");
  const exitFile = path.join(directory, "exit-code");
  const startedAt = Date.now();
  let status: InstallStatus = "timeout";
  let exitCode: number | null = null;
  for (;;) {
    try {
      // The workflow atomically moves a completed file into place. Empty,
      // malformed or out-of-range values are never a successful exit.
      const value = fs.readFileSync(exitFile, "utf8").trim();
      if (/^[0-9]{1,3}$/.test(value) && Number(value) <= 255) {
        exitCode = Number(value);
        status = exitCode === 0 ? "success" : "failed";
      } else status = "invalid_exit";
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        status = "read_error";
        break;
      }
    }
    if (Date.now() - startedAt > TIMEOUT_MS) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  const retentionStatus = retainLog(input);
  manifest.browserInstall = {
    mode: "background", status, exitCode,
    timeoutMs: TIMEOUT_MS, pollMs: POLL_MS,
    waitedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    retentionStatus, ...(retentionStatus === "retained" ? { log: LOG_FILE } : {}),
  };
  if (status !== "success") throw new SafeDiagnosticError(FAILURE_MESSAGES[status]);
}
