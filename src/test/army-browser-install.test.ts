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
});
