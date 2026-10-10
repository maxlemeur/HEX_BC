import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

const secret = "synthetic-report-secret-5439";
const email = "report-check@example.invalid";
const script = path.resolve("scripts/check-playwright-report-secrets.mjs");

async function probe(body, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "playwright-report-safety-"));
  try {
    const report = path.join(dir, options.uppercase ? "index.HTML" : "index.html");
    const zip = zipSync({ "report.json": strToU8(JSON.stringify({ title: body })) });
    const html = options.corrupt ? '<template id="playwrightReportBase64">data:application/zip;base64,bm90IGEgemlw</template>'
      : '<template id="playwrightReportBase64">data:application/zip;base64,' + Buffer.from(zip).toString("base64") + "</template>";
    await fs.writeFile(report, html);
    const env = { ...process.env, E2E_LOGIN_EMAIL: email, E2E_LOGIN_PASSWORD: secret };
    if (options.missing) delete env.E2E_LOGIN_PASSWORD;
    const result = spawnSync(process.execPath, [script, report], { env, encoding: "utf8" });
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    assert(!output.includes(secret), "The CLI must not echo a credential");
    return result.status;
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test("accepts an actual compressed report without credentials", async () => {
  assert.equal(await probe("Evaluate login input"), 0);
});
test("blocks a password hidden inside the embedded report ZIP", async () => {
  assert.equal(await probe('Fill "' + secret + '"'), 1);
});
test("blocks the login identity in embedded metadata", async () => {
  assert.equal(await probe('Fill "' + email + '"'), 1);
});
test("checks embedded credentials regardless of HTML filename case", async () => {
  assert.equal(await probe('Fill "' + secret + '"', { uppercase: true }), 1);
});
test("fails closed on an invalid compressed report", async () => {
  assert.equal(await probe("safe", { corrupt: true }), 1);
});
test("fails closed if a required credential is absent", async () => {
  assert.equal(await probe("safe", { missing: true }), 1);
});
