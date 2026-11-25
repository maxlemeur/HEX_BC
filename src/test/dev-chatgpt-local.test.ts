import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const launch = promisify(execFile);
const launcher = fileURLToPath(new URL("../../scripts/dev-chatgpt-local.mjs", import.meta.url));

async function launchWithNextOutput(output: string, waitForSignal: boolean) {
  const cwd = await mkdtemp(join(tmpdir(), "mergeone-dev-chatgpt-"));
  try {
    const nextDir = join(cwd, "node_modules/next/dist/bin");
    await mkdir(nextDir, { recursive: true });
    await writeFile(join(nextDir, "next"), `
      process.on("SIGTERM", () => {
        console.log("Next received SIGTERM");
        process.exitCode = 0;
        clearInterval(keepAlive);
      });
      const keepAlive = ${waitForSignal} ? setInterval(() => {}, 5000) : undefined;
      const output = ${JSON.stringify(output)};
      const boundary = output.indexOf("Compiled") + 4;
      process.stdout.write(output.slice(0, boundary));
      setTimeout(() => process.stdout.write(output.slice(boundary)), 30);
    `);
    try {
      const result = await launch(process.execPath, [launcher], { cwd, timeout: 3000 });
      return { ...result, code: 0 };
    } catch (error) {
      const result = error as { stdout: string; stderr: string; code: number | null };
      return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const compile = "✓ \u001b[32mCompiled in 36ms\u001b[39m\n";
const request = (path: string) => ` GET ${path} 200 in 105ms (application-code: 100ms)\n`;

describe("dev:chatgpt reload-loop guard", () => {
  it("stops Next with a nonzero status and explains a burst of compiles and repeated page requests", async () => {
    const output = Array.from({ length: 12 }, (_, i) => compile + request(`/fictional-page?_rsc=${i}`)).join("");
    const result = await launchWithNextOutput(output, true);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Next received SIGTERM");
    expect(result.stderr).toContain("Possible reload loop");
    expect(result.stderr).toContain("Stopping Next");
    expect(result.stderr).not.toContain("/fictional-page");
  });

  it("allows ordinary recompiles and repeated page requests by themselves", async () => {
    const traffic = request("/fictional-page").repeat(12);
    const compilesAcrossPages = Array.from({ length: 12 }, (_, i) => compile + request(`/page-${i}`)).join("");
    const result = await launchWithNextOutput(traffic, false);
    const recompiles = await launchWithNextOutput(compilesAcrossPages, false);

    expect(result.code).toBe(0);
    expect(recompiles.code).toBe(0);
    expect(result.stdout).toContain(traffic);
    expect(recompiles.stdout).toContain(compilesAcrossPages);
    expect(result.stderr + recompiles.stderr).not.toContain("reload loop");
  });
});
