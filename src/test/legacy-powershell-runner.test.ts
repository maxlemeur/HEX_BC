import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The PowerShell scripts can return zero after printing PASS (skipped ...).
// A browser journey cannot verify the parent CLI's exit classification. Exercise
// that process boundary with a disposable PowerShell executable, without Auth or
// a live backend. The executable fixture uses POSIX shebang resolution, as on CI.
const wrapper = path.resolve("e2e/run-ps1.mjs");
type OutputChunk = { stream: "stdout" | "stderr"; text: string };

function legacyFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "hex-legacy-runner-"));
  const shell = path.join(directory, "pwsh");
  writeFileSync(shell, `#!${process.execPath}
const { chunks, code } = JSON.parse(process.env.HEX_LEGACY_RUNNER_FIXTURE);
for (const chunk of chunks) {
  process[chunk.stream].write(chunk.text);
  await new Promise((resolve) => setTimeout(resolve, 10));
}
if (code === null) {
  const timer = setInterval(() => {}, 1000);
  process.on('SIGTERM', () => {
    process.stdout.write('CHILD_TERMINATED\\n');
    clearInterval(timer);
  });
  process.stdout.write('CHILD_READY ' + process.pid + '\\n');
} else process.exitCode = code;
`, { mode: 0o700 });
  writeFileSync(path.join(directory, "journey.ps1"), "# Disposable process fixture\n");
  return directory;
}

function runLegacy(chunks: OutputChunk[], code = 0) {
  const directory = legacyFixture();
  try {
    const result = spawnSync(process.execPath, [wrapper, "journey.ps1"], {
      cwd: directory,
      env: {
        NODE_ENV: "test",
        PATH: directory,
        HEX_LEGACY_RUNNER_FIXTURE: JSON.stringify({ chunks, code }),
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe.skipIf(process.platform === "win32")("legacy PowerShell CLI exit classification", () => {
  it.each([
    "EST-101 KEYBOARD PASS (skipped due to missing editable line fixture)",
    "EST-102 INLINE EDIT PASS (skipped due to missing inline row fixture)",
    "EST-104 CLIPBOARD PASS (skipped due to paste dialog transport limitation)",
    "EST-104 CLIPBOARD PASS (skipped due to paste import limitation)",
    "EST-105 PASS (skipped due to missing editable line row)",
    "EST-030 PASS (skipped due to insufficient alternatives)",
  ])("rejects an incomplete zero-exit journey: %s", (line) => {
    const result = runLegacy([
      { stream: "stdout", text: `${line}\n` },
      { stream: "stdout", text: "PASS journey.ps1\nHEX suite 'editor' passed (1/1).\n" },
    ]);
    expect(result.code, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain(line);
    expect(result.stderr).toContain("incomplete");
  });

  it.each(["stdout", "stderr"] as const)("detects a marker split across %s chunks without a final newline", (stream) => {
    const result = runLegacy([
      { stream, text: "EST-104 CLIPBOARD PA" },
      { stream, text: "SS (skip" },
      { stream, text: "ped due to paste import limitation)" },
    ]);
    expect(result.code).toBe(1);
    expect(result[stream]).toContain("PASS (skipped due to paste import limitation)");
    expect(result.stderr).toContain("incomplete");
  });

  it("keeps a completed journey green and preserves both output streams", () => {
    const result = runLegacy([
      { stream: "stdout", text: "EST-104 CLIPBOARD PASS\n" },
      { stream: "stderr", text: "Diagnostic: 2 noneditable header cells skipped\n" },
    ]);
    expect(result).toEqual({
      code: 0,
      stdout: "EST-104 CLIPBOARD PASS\n",
      stderr: "Diagnostic: 2 noneditable header cells skipped\n",
    });
  });

  it("preserves a failing child's exit code even when the output contains an incomplete pass", () => {
    const result = runLegacy([{ stream: "stdout", text: "EST-104 PASS (skipped due to fixture failure)\n" }], 7);
    expect(result.code).toBe(7);
  });

  it("forwards cancellation to the owned child and never reports the cancelled run passed", async () => {
    const directory = legacyFixture();
    let shellPid: number | undefined;
    const child = spawn(process.execPath, [wrapper, "journey.ps1"], {
      cwd: directory,
      env: { NODE_ENV: "test", PATH: directory, HEX_LEGACY_RUNNER_FIXTURE: JSON.stringify({ chunks: [], code: null }) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(() => reject(new Error("Legacy cancellation fixture did not close.")), 5_000);
        child.stdout.on("data", (chunk) => {
          output += chunk.toString();
          const ready = /CHILD_READY (\d+)/u.exec(output);
          if (ready && shellPid === undefined) {
            shellPid = Number(ready[1]);
            child.kill("SIGTERM");
          }
        });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("close", (code) => { clearTimeout(timer); resolve({ code, output }); });
      });
      expect(result.code).toBe(130);
      expect(result.output).toContain("CHILD_TERMINATED");
    } finally {
      child.kill("SIGKILL");
      if (shellPid !== undefined) {
        try { process.kill(shellPid, "SIGKILL"); } catch { /* The wrapper normally reaped its child. */ }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);
});
