import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { COLLECTOR_SENTINEL, startCollector } from "../../scripts/tester-army/offer-collector.mjs";

test("collector incidents stay local, bounded and idempotent without relaxing packet validation", async () => {
  const run = await mkdtemp(path.join(os.tmpdir(), "army-offer-faults-"));
  const directory = path.join(run, "collector");
  const faultPlanPath = path.join(run, "private", "collector-faults.json");
  const attemptLogPath = path.join(run, "public", "collector-attempts.jsonl");
  await Promise.all([directory, path.dirname(faultPlanPath), path.dirname(attemptLogPath)].map((folder) => mkdir(folder)));
  let collector: Awaited<ReturnType<typeof startCollector>> | undefined;
  const recipient = "ARMY-OFFER-fault-test@offer.invalid";
  const payload = { from: "ARMY Local <offer@army.invalid>", to: recipient, subject: "Local test",
    html: "<p>Local test</p>", text: "Local test", attachments: [{ filename: "fixture.pdf", content: Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64") }] };
  try {
    await expect(startCollector({ directory, faultPlanPath: path.join(run, "faults.json"), attemptLogPath })).rejects.toThrow("exact private plan");
    collector = await startCollector({ directory, faultPlanPath, attemptLogPath });
    const post = (key: string, body = payload, authorization = `Bearer ${COLLECTOR_SENTINEL}`) => fetch(`${collector!.origin}/emails`, {
      method: "POST", headers: { authorization, "idempotency-key": key, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const plan = (responses: string[]) => writeFile(faultPlanPath, JSON.stringify({ schemaVersion: 1, id: randomUUID(), recipient, responses }));
    await plan(["rejected", "retryable", "accepted-unknown"]);
    expect((await post("bad-auth", payload, "Bearer fake")).status).toBe(401);
    expect((await post("external", { ...payload, to: "external@example.com" })).status).toBe(422);
    expect(await readdir(path.join(directory, "receipts"))).toEqual([]);
    expect((await post("stable")).status).toBe(422);
    expect((await post("stable")).status).toBe(503);
    expect(await readdir(path.join(directory, "receipts"))).toEqual([]);
    expect((await post("stable")).status).toBe(409);
    const receipts = await readdir(path.join(directory, "receipts"));
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(await readFile(path.join(directory, "receipts", receipts[0], "public", "receipt.json"), "utf8"));
    const replay = await post("stable");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ id: receipt.id });
    expect((await post("stable", { ...payload, subject: "Changed" })).status).toBe(409);
    expect(await readdir(path.join(directory, "receipts"))).toEqual(receipts);
    await plan(["rejected"]);
    expect((await post("unrelated", { ...payload, to: "ARMY-OFFER-other@offer.invalid" })).status).toBe(200);
    expect((await post("scoped")).status).toBe(422);
    const attempts = (await readFile(attemptLogPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(attempts.map((entry) => entry.fault)).toEqual(["rejected", "retryable", "accepted-unknown", null, null, null, "rejected"]);
    expect(new Set(attempts.slice(0, 4).map((entry) => entry.payloadSha256)).size).toBe(1);
    expect(await readFile(attemptLogPath, "utf8")).not.toContain(recipient);
  } finally {
    await collector?.close();
    await rm(run, { recursive: true, force: true });
  }
});
