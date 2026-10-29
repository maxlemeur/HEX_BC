import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Zip, ZipDeflate, zipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// A browser cannot check Git's tracked/ignored file selection, symlink traversal
// or secrets inside an Office archive. Exercise the real offline CLI in owned
// disposable repositories, without inheriting credentials or network access.
const script = path.resolve("scripts/check-repository-hygiene.mjs");
const syntheticSecret = ["ghp", "_", "x".repeat(36)].join("");

describe("repository confidentiality guard", () => {
  let root: string;
  const put = (name: string, content: string | Uint8Array) => {
    const destination = path.join(root, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  };
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  };
  const run = () => spawnSync(process.execPath, [script], {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: { PATH: process.env.PATH, NODE_ENV: "test", SYSTEMROOT: process.env.SYSTEMROOT },
  });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mergeone-hygiene-"));
    git("init", "--quiet");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("checks new public sources and permits placeholders without reading ignored private originals", () => {
    put(".gitignore", ".private/\n.env.local\n");
    put(".private/original.xlsx", syntheticSecret);
    put(".env.local", syntheticSecret);
    put(".env.example", "SUPABASE_SERVICE_ROLE_KEY=\n");
    put("src/valid.ts", "export const value = 1;\n");
    put("e2e/fixtures/business/sample.xlsx", zipSync({ "xl/worksheets/sheet1.xml": strToU8("<row>ARMY fictif</row>") }));
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Repository hygiene passed");
  });

  it("rejects already tracked private basenames even after they become ignored", () => {
    put("nested/CLAUDE.local.md", "private configuration");
    put("nested/settings.local.json", "{}");
    put("e2e/.auth.json", "opaque browser session");
    git("add", "--", "nested/CLAUDE.local.md", "nested/settings.local.json", "e2e/.auth.json");
    put(".gitignore", "CLAUDE.local.md\nsettings.local.json\ne2e/.auth.json\n");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("nested/CLAUDE.local.md");
    expect(result.stderr).toContain("nested/settings.local.json");
    expect(result.stderr).toContain("e2e/.auth.json");
  });

  it("rejects untracked originals and transmission archives while retaining their notices", () => {
    put("docs/prd_file/README.md", "Private corpus has a local preservation manifest.");
    put("docs/prd_file/original.xlsx", "private business data");
    put("docs/handoff-prestataire-2026-10-14/LISEZ-MOI.md", "Local private archive.");
    put("docs/handoff-prestataire-2026-10-14/handoff.zip", "archive");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/prd_file/original.xlsx");
    expect(result.stderr).toContain("handoff.zip");
    expect(result.stderr).not.toContain("README.md");
    expect(result.stderr).not.toContain("LISEZ-MOI.md");
  });

  it("finds high confidence credential signatures inside Office members without printing their values", () => {
    put("e2e/fixtures/business/sample.xlsx", zipSync({ "xl/sharedStrings.xml": strToU8(`<t>${syntheticSecret}</t>`) }));
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("xl/sharedStrings.xml");
    expect(result.stderr).toContain("credential signature");
    expect(result.stdout + result.stderr).not.toContain(syntheticSecret);
  });

  it("refuses duplicate archive names that could conceal a credential in an overwritten member", () => {
    const chunks: Uint8Array[] = [];
    const archive = new Zip((error, data) => {
      if (error) throw error;
      chunks.push(data);
    });
    for (const value of [syntheticSecret, "public synthetic row"]) {
      const member = new ZipDeflate("xl/sharedStrings.xml", { level: 9 });
      archive.add(member);
      member.push(strToU8(value), true);
    }
    archive.end();
    const bytes = Buffer.concat(chunks);
    expect(bytes.includes(Buffer.from(syntheticSecret))).toBe(false);
    put("e2e/fixtures/business/sample.xlsx", bytes);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("duplicate archive member");
    expect(result.stdout + result.stderr).not.toContain(syntheticSecret);
  });

  it("refuses filesystem links instead of reading a private target", () => {
    put(".gitignore", ".private/\n");
    put(".private/target.txt", syntheticSecret);
    fs.symlinkSync(path.join(root, ".private/target.txt"), path.join(root, "public.txt"));
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("public.txt");
    expect(result.stderr).toContain("symbolic link");
    expect(result.stdout + result.stderr).not.toContain(syntheticSecret);
  });

  it("fails closed on an unreadable or oversized archive member", () => {
    put("e2e/fixtures/business/sample.xlsx", zipSync({ "xl/sharedStrings.xml": new Uint8Array(8 * 1024 * 1024 + 1) }));
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("archive limit");
  });
});
