// Reading the JSONL witness logs of the offer journeys while another process
// appends to them (e2e/army/local/jsonl-witness.ts). RD01 failed in CI run
// 44895801766 with « Expected ':' after property name in JSON at position
// 122881 »: the server network witness ended exactly at its 30th 4 KiB page,
// inside a record, because a reader can see the start of a write before its
// end. A journey cannot reproduce that ordering on demand. Ways a reader can
// fail, each pinned below:
// 1. a last line without its newline (a write in progress) breaks the parse
//    of the records written before it;
// 2. an empty log, or one ending with its newline, loses or invents records;
// 3. a caller that needs the latest record gets it left out instead of
//    waiting for its write to end, or waits for records started after its read;
// 4. a record that never ends passes silently, or blocks the journey;
// 5. a complete line that is not JSON (two records sharing one line) is
//    skipped instead of failing the journey;
// 6. a cut inside a multi-byte character, or CRLF line ends, corrupt a record;
// 7. a missing log reads as empty where the journey requires its witness.
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readJsonlWitness } from "../../e2e/army/local/jsonl-witness";

type Entry = { schemaVersion: string; kind: string; n: number };

let directory: string;
let log: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "jsonl-witness-"));
  log = path.join(directory, "server-network.jsonl");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const line = (n: number) => `${JSON.stringify({ schemaVersion: "offer-network-1", kind: "fetch", n })}\n`;

describe("readJsonlWitness", () => {
  it("leaves out a last line cut inside a record, as at the page boundary of RD01", async () => {
    const cut = 4096 * 30;
    let content = "";
    for (let n = 0; content.length <= cut; n++) content += line(n);
    expect(content[cut - 1]).not.toBe("\n");
    await writeFile(log, content.slice(0, cut));

    const records = await readJsonlWitness<Entry>(log);

    const complete = content.slice(0, content.lastIndexOf("\n", cut - 1) + 1).split("\n").filter(Boolean);
    expect(records).toEqual(complete.map((text) => JSON.parse(text)));
    expect(records.length).toBeGreaterThan(2_000);
  });

  it("reads an empty log as no record", async () => {
    await writeFile(log, "");
    expect(await readJsonlWitness(log)).toEqual([]);
  });

  it("keeps every record of a log ending with its newline", async () => {
    await writeFile(log, line(1) + line(2) + line(3));
    expect((await readJsonlWitness<Entry>(log)).map((entry) => entry.n)).toEqual([1, 2, 3]);
  });

  it("waits for the record being written when asked, not for records started after the read", async () => {
    const record = line(2);
    await writeFile(log, line(1) + record.slice(0, 20));
    const finish = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      await appendFile(log, record.slice(20) + line(3));
    })();

    const records = await readJsonlWitness<Entry>(log, { awaitTrailingRecordMs: 2_000 });
    await finish;

    expect(records.map((entry) => entry.n)).toEqual([1, 2]);
  });

  it("fails with the log name when the record being written never ends", async () => {
    await writeFile(log, line(1) + line(2).slice(0, 20));
    await expect(readJsonlWitness(log, { awaitTrailingRecordMs: 60 }))
      .rejects.toThrow("server-network.jsonl still ends with an incomplete record 60 ms after it was read.");
  });

  it("fails on a complete line that is not JSON, such as two records sharing one line", async () => {
    await writeFile(log, line(1) + line(2).slice(0, 20) + line(3) + line(4));
    await expect(readJsonlWitness(log)).rejects.toThrow(/^server-network\.jsonl line 2 is complete but is not JSON: /);
  });

  it("decodes complete records when the cut falls inside a multi-byte character, and CRLF lines", async () => {
    const accented = Buffer.from(JSON.stringify({ role: "collector", route: "accusé" }));
    await writeFile(log, Buffer.concat([Buffer.from(`${JSON.stringify({ route: "reçu" })}\r\n`), accented.subarray(0, accented.indexOf(0xc3) + 1)]));
    expect(await readJsonlWitness(log)).toEqual([{ route: "reçu" }]);
  });

  it("reads a missing log as empty only when the caller allows it", async () => {
    expect(await readJsonlWitness(log, { missingIsEmpty: true })).toEqual([]);
    await expect(readJsonlWitness(log)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
