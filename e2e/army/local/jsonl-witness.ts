import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Witness logs of the offer journeys (server network witness, collector
// attempts and HTTP responses) hold one JSON object per line and are appended
// by another process while a journey reads them. One record is one write, but
// a reader can still see only its beginning: on Linux the file size grows page
// by page during a write, and RD01 once read a log that ended exactly at its
// 30th page, inside a record (CI run 44895801766). A last line without its
// newline is therefore a write in progress, not a record yet.

const NEWLINE = 0x0a;
const POLL_MS = 10;

export type JsonlWitnessOptions = {
  /** A log its writer has not created yet holds no record. */
  missingIsEmpty?: boolean;
  /**
   * For a caller that needs the latest record: wait up to this long for the
   * record being written when the log was read, instead of leaving it out.
   * Records started after that read are left out either way.
   */
  awaitTrailingRecordMs?: number;
};

/** The complete records of a JSONL witness log; a complete line that is not JSON throws. */
export async function readJsonlWitness<T>(file: string, options: JsonlWitnessOptions = {}): Promise<T[]> {
  let content = await readLog(file, options.missingIsEmpty ?? false);
  let end = content.lastIndexOf(NEWLINE) + 1;
  if (end < content.length && options.awaitTrailingRecordMs !== undefined) {
    const deadline = Date.now() + options.awaitTrailingRecordMs;
    for (;;) {
      await delay(POLL_MS);
      const next = await readLog(file, false);
      if (next.length < content.length) throw new Error(`${path.basename(file)} shrank while a record was being appended.`);
      content = next;
      const newline = content.indexOf(NEWLINE, end);
      if (newline !== -1) {
        end = newline + 1;
        break;
      }
      if (Date.now() >= deadline) {
        throw new Error(`${path.basename(file)} still ends with an incomplete record ${options.awaitTrailingRecordMs} ms after it was read.`);
      }
    }
  }
  return parseRecords<T>(path.basename(file), content.subarray(0, end));
}

async function readLog(file: string, missingIsEmpty: boolean) {
  try {
    return await readFile(file);
  } catch (error) {
    if (missingIsEmpty && (error as NodeJS.ErrnoException).code === "ENOENT") return Buffer.alloc(0);
    throw error;
  }
}

function parseRecords<T>(name: string, complete: Buffer): T[] {
  // A newline byte never occurs inside a multi-byte UTF-8 character, so the
  // complete part decodes on its own even when the cut fell inside one.
  return complete.toString("utf8").split("\n").flatMap((line, index) => {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (text.trim() === "") return [];
    try {
      return [JSON.parse(text) as T];
    } catch (error) {
      throw new Error(`${name} line ${index + 1} is complete but is not JSON: ${(error as Error).message}`);
    }
  });
}
