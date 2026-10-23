import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { awaitBrowserInstall } from "../../scripts/tester-army/browser-install";
import { redactOutput } from "../../scripts/tester-army/local-recipe-common.mjs";
import { SafeDiagnosticError } from "./local-supabase-ci";

const directories: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "army-browser-install-test-"));
  directories.push(root);
  const directory = path.join(root, "installer");
  const evidence = path.join(root, "evidence");
  fs.mkdirSync(directory);
  fs.mkdirSync(evidence);
  const manifest: Record<string, unknown> = {};
  const redact = (value: string) => redactOutput(value, { NODE_ENV: "test", SECRET_0: "private-credential" });
  return { directory, evidence, manifest, redact };
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("background Chromium installation evidence", () => {
  it("retains the redacted installer log and timeout before refusing journeys", async () => {
    vi.useFakeTimers();
    const input = fixture();
    fs.writeFileSync(path.join(input.directory, "install.log"), "still downloading private-credential\n");
    const result = awaitBrowserInstall(input).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(600_500);

    expect(fs.existsSync(path.join(input.evidence, "browser-install.log"))).toBe(true);
    expect(fs.readFileSync(path.join(input.evidence, "browser-install.log"), "utf8")).toBe("still downloading [REDACTED]\n");
    expect(input.manifest.browserInstall).toMatchObject({
      status: "timeout", exitCode: null, waitedSeconds: 600.5,
      timeoutMs: 600_000, pollMs: 500, retentionStatus: "retained", log: "browser-install.log",
    });
    const error = await result;
    expect(error).toBeInstanceOf(SafeDiagnosticError);
    expect((error as Error).message).toBe("The background Chromium install did not finish within 10 minutes; see browser-install evidence.");
  });

  it("waits for the completed exit file without changing the ten-minute deadline or polling interval", async () => {
    vi.useFakeTimers();
    const input = fixture();
    const completed = vi.fn();
    const result = awaitBrowserInstall(input).then(completed);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(completed).not.toHaveBeenCalled();
    fs.writeFileSync(path.join(input.directory, "exit-code"), "0\n");
    await vi.advanceTimersByTimeAsync(499);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(input.manifest.browserInstall).toMatchObject({ status: "success", exitCode: 0, waitedSeconds: 600.5 });
  });

  it.each([0, 1, 137, 255])("retains only redacted output for completed exit %s", async (exitCode) => {
    const input = fixture();
    fs.writeFileSync(path.join(input.directory, "exit-code"), `${exitCode}\n`);
    fs.writeFileSync(path.join(input.directory, "install.log"), "installer output private-credential\n");
    const result = awaitBrowserInstall(input);
    if (exitCode === 0) await expect(result).resolves.toBeUndefined();
    else {
      await expect(result).rejects.toBeInstanceOf(SafeDiagnosticError);
      await expect(result).rejects.toThrow("failed with a nonzero exit code");
    }
    expect(fs.readFileSync(path.join(input.evidence, "browser-install.log"), "utf8")).toBe("installer output [REDACTED]\n");
    expect(input.manifest.browserInstall).toEqual({
      mode: "background", status: exitCode === 0 ? "success" : "failed", exitCode,
      waitedSeconds: 0, timeoutMs: 600_000, pollMs: 500, retentionStatus: "retained", log: "browser-install.log",
    });
    expect(JSON.stringify(input.manifest)).not.toContain("private-credential");
  });

  it.each(["", "-1", "0 trailing", "1.2", "256", "0000", "private-credential@example.test"])(
    "rejects invalid completed status %j without exposing its raw contents", async (value) => {
      const input = fixture();
      fs.writeFileSync(path.join(input.directory, "exit-code"), value);
      fs.writeFileSync(path.join(input.directory, "install.log"), "partial private-credential\n");
      const result = awaitBrowserInstall(input);
      await expect(result).rejects.toBeInstanceOf(SafeDiagnosticError);
      await expect(result).rejects.toThrow("returned an invalid exit status");
      expect(input.manifest.browserInstall).toMatchObject({ status: "invalid_exit", exitCode: null, retentionStatus: "retained" });
      expect(fs.readFileSync(path.join(input.evidence, "browser-install.log"), "utf8")).not.toContain("private-credential");
      expect(JSON.stringify(input.manifest)).not.toContain("private-credential");
    }
  );

  it("records an unreadable exit file and retains the available installer output", async () => {
    const input = fixture();
    fs.mkdirSync(path.join(input.directory, "exit-code"));
    fs.writeFileSync(path.join(input.directory, "install.log"), "partial private-credential\n");
    const result = awaitBrowserInstall(input);
    await expect(result).rejects.toBeInstanceOf(SafeDiagnosticError);
    await expect(result).rejects.toThrow("exit status could not be read");
    expect(input.manifest.browserInstall).toMatchObject({ status: "read_error", exitCode: null, retentionStatus: "retained" });
    expect(fs.readFileSync(path.join(input.evidence, "browser-install.log"), "utf8")).toBe("partial [REDACTED]\n");
  });

  it.each(["missing", "read_error", "write_error", "redaction_error"] as const)(
    "allows the SDK to run after exit zero when log retention is %s", async (retentionStatus) => {
      const input = fixture();
      fs.writeFileSync(path.join(input.directory, "exit-code"), "0\n");
      if (retentionStatus === "read_error") fs.mkdirSync(path.join(input.directory, "install.log"));
      else if (retentionStatus !== "missing") fs.writeFileSync(path.join(input.directory, "install.log"), "private-credential\n");
      if (retentionStatus === "write_error") fs.mkdirSync(path.join(input.evidence, "browser-install.log"));
      if (retentionStatus === "redaction_error") input.redact = () => { throw new Error("private-credential"); };
      await expect(awaitBrowserInstall(input)).resolves.toBeUndefined();
      expect(input.manifest.browserInstall).toMatchObject({ status: "success", exitCode: 0, retentionStatus });
      expect(input.manifest.browserInstall).not.toHaveProperty("log");
    }
  );

  it("keeps the timeout primary when the retained log cannot be written", async () => {
    vi.useFakeTimers();
    const input = fixture();
    fs.writeFileSync(path.join(input.directory, "install.log"), "private-credential\n");
    fs.mkdirSync(path.join(input.evidence, "browser-install.log"));
    const result = awaitBrowserInstall(input).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(600_500);
    expect(input.manifest.browserInstall).toMatchObject({ status: "timeout", exitCode: null, retentionStatus: "write_error" });
    const error = await result;
    expect(error).toBeInstanceOf(SafeDiagnosticError);
    expect((error as Error).message).toContain("did not finish within 10 minutes");
    expect((error as Error).message).not.toContain(input.evidence);
  });

  it("retains no raw output if redaction fails during a failed install", async () => {
    const input = fixture();
    fs.writeFileSync(path.join(input.directory, "exit-code"), "1\n");
    fs.writeFileSync(path.join(input.directory, "install.log"), "private-credential\n");
    input.redact = () => { throw new Error("private-credential"); };
    const result = awaitBrowserInstall(input);
    await expect(result).rejects.toThrow("failed with a nonzero exit code");
    expect(input.manifest.browserInstall).toMatchObject({ status: "failed", exitCode: 1, retentionStatus: "redaction_error" });
    expect(fs.existsSync(path.join(input.evidence, "browser-install.log"))).toBe(false);
  });

  it("refuses a relative installer directory with a safe configuration diagnostic", async () => {
    const input = fixture();
    await expect(awaitBrowserInstall({ ...input, directory: "relative/private-credential" })).rejects.toThrow(SafeDiagnosticError);
    expect(input.manifest).toEqual({});
  });
});
