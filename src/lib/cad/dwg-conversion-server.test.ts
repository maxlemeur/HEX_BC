import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DwgConversionError, dwgFormatCode } from "@/lib/cad/dwg-conversion";
import { convertDwgToDxf, DWG_CONVERSION_LIMITS, oneAtATime, runLockedProgram } from "@/lib/cad/dwg-conversion-server";
import { readDxf } from "@/lib/cad/dxf";
import { measureCadDrawing } from "@/lib/cad/quantities";

// The sample drawing LibreDWG ships with its own tests (see the NOTICE beside it): tables, blocks,
// texts, a hatch and two splines on five layers, saved by AutoCAD in the 2018 format.
const SAMPLE = new Uint8Array(readFileSync(join(process.cwd(), "src/test/fixtures/cad/libredwg-example-2018.dwg")));

const withMagic = (magic: string, length = 4096) => {
  const bytes = new Uint8Array(length);
  bytes.set(new TextEncoder().encode(magic));
  return bytes;
};

const reasonOf = async (conversion: Promise<unknown>) => {
  try {
    await conversion;
  } catch (error) {
    if (error instanceof DwgConversionError) return error.reason;
    throw error;
  }
  return "converted";
};

describe("dwgFormatCode", () => {
  it("reads the format a DWG says it is saved in", () => {
    expect(dwgFormatCode(SAMPLE)).toBe("AC1032");
    expect(dwgFormatCode(withMagic("AC1015"))).toBe("AC1015");
    expect(dwgFormatCode(withMagic("AC2.10"))).toBe("AC2.10");
    expect(dwgFormatCode(withMagic("  0\nSECTION"))).toBeNull();
    expect(dwgFormatCode(new Uint8Array(3))).toBeNull();
  });
});

describe("convertDwgToDxf", () => {
  it("turns a DWG into the DXF of the same drawing, with the quantities AutoCAD's own DXF gives", async () => {
    const dxf = await convertDwgToDxf(SAMPLE);
    const drawing = readDxf(dxf);
    expect(drawing.version.code).toBe("AC1032");
    expect(drawing.units.name).toBe("millimètre");
    expect(drawing.layers.map((layer) => layer.name)).toEqual(expect.arrayContaining(["0", "Tavolo 2", "Tavolo 3"]));
    expect(drawing.layers).toHaveLength(5);
    expect(drawing.inserts).toHaveLength(10);
    expect(drawing.texts).toHaveLength(14);
    const { totals, extents, partial } = measureCadDrawing(drawing);
    expect(partial).toBe(false);
    expect(totals.blocks).toBe(10);
    // AutoCAD's DXF of this drawing reads 6019.552, 133.602 and 0.122 too.
    expect(totals.blockLength).toBeCloseTo(6019.552, 3);
    expect(totals.closedArea).toBeCloseTo(133.602, 3);
    expect(totals.hatchArea).toBeCloseTo(0.122, 3);
    // It reads 103.939 m there: a DWG keeps the two splines by their fit points only, which the reader says.
    expect(totals.length).toBeCloseTo(103.631, 3);
    expect(drawing.warnings).toEqual([{ code: "spline_fit_points", detail: "2" }]);
    expect(extents?.width).toBeCloseTo(3411.857, 3);
    expect(extents?.height).toBeCloseTo(2645.183, 3);
  }, 60_000);

  it("refuses without starting anything a file that is empty, too large or not a DWG", async () => {
    expect(await reasonOf(convertDwgToDxf(new Uint8Array(0)))).toBe("empty");
    expect(await reasonOf(convertDwgToDxf(withMagic("AC1032", DWG_CONVERSION_LIMITS.maxInputBytes + 1)))).toBe("too_large");
    expect(await reasonOf(convertDwgToDxf(withMagic("  0\nSECTION")))).toBe("not_dwg");
  });

  it("says a DWG saved before the 2004 format is not converted", async () => {
    for (const magic of ["AC1015", "AC1014", "AC1012", "AC1009", "AC2.10"]) expect(await reasonOf(convertDwgToDxf(withMagic(magic))), magic).toBe("old_format");
  });

  it("fails on a file that only has the first bytes of a DWG", async () => {
    expect(await reasonOf(convertDwgToDxf(withMagic("AC1032")))).toBe("failed");
  }, 60_000);

  it("stops the conversion at its deadline", async () => {
    expect(await reasonOf(convertDwgToDxf(SAMPLE, { timeoutMs: 5 }))).toBe("timeout");
  }, 60_000);

  it("stops a conversion whose DXF passes the size the reader takes", async () => {
    expect(await reasonOf(convertDwgToDxf(SAMPLE, { maxOutputBytes: 100_000 }))).toBe("output_too_large");
  }, 60_000);
});

describe("runLockedProgram", () => {
  const limits = { timeoutMs: 20_000, maxOutputBytes: 1_000_000 };
  const run = (script: string, input = new Uint8Array(0)) => runLockedProgram(script, "{}", input, { ...limits, readable: [] });
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

  it("hands the input over and returns what the program writes, with its exit code", async () => {
    const result = await run(
      "const chunks = []; process.stdin.on('data', (chunk) => chunks.push(chunk)); process.stdin.on('end', () => process.stdout.write(Buffer.concat(chunks).toString().toUpperCase(), () => process.exit(7)));",
      new TextEncoder().encode("plan"),
    );
    expect(text(result.output)).toBe("PLAN");
    expect(result.exitCode).toBe(7);
  }, 30_000);

  it("gives the program no way to the disk, to the network or to another program", async () => {
    const probe = `
      const outcome = {};
      const attempt = async (name, action) => { try { await action(); outcome[name] = "allowed"; } catch (error) { outcome[name] = error.code ?? error.cause?.code ?? "refused"; } };
      (async () => {
        await attempt("write", () => require("node:fs").writeFileSync(require("node:path").join(require("node:os").tmpdir(), "mergeone-dwg-probe"), "x"));
        await attempt("read", () => require("node:fs").readFileSync(process.execPath));
        await attempt("spawn", () => require("node:child_process").spawnSync(process.execPath, ["-v"]));
        await attempt("worker", () => new (require("node:worker_threads").Worker)("1", { eval: true }));
        await attempt("connect", () => new Promise((resolve, reject) => { const socket = require("node:net").connect(9, "127.0.0.1"); socket.once("connect", resolve); socket.once("error", reject); }));
        outcome.environment = Object.keys(process.env).sort();
        process.stdout.write(JSON.stringify(outcome), () => process.exit(0));
      })();`;
    const outcome = JSON.parse(text((await run(probe)).output));
    expect(outcome).toMatchObject({ write: "ERR_ACCESS_DENIED", read: "ERR_ACCESS_DENIED", spawn: "ERR_ACCESS_DENIED", worker: "ERR_ACCESS_DENIED", connect: "ERR_ACCESS_DENIED" });
    // No key, token or server secret reaches the program.
    expect(outcome.environment.filter((name: string) => !["NODE_ENV", "PATH"].includes(name))).toEqual([]);
  }, 30_000);

  it("takes the exit code of a program that ends before it has read what it was sent", async () => {
    const result = await run("process.exit(4);", new Uint8Array(8 * 1024 * 1024));
    expect(result.exitCode).toBe(4);
    expect(result.output.byteLength).toBe(0);
  }, 30_000);

  it("ends the program when the request it serves is given up, and starts none for a request already given up", async () => {
    const endless = "setInterval(() => {}, 1000);";
    const given = new AbortController();
    const running = reasonOf(runLockedProgram(endless, "{}", new Uint8Array(0), { ...limits, readable: [], signal: given.signal }));
    setTimeout(() => given.abort(), 300);
    const started = Date.now();
    expect(await running).toBe("failed");
    // Long before the deadline of 20 s.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await reasonOf(runLockedProgram(endless, "{}", new Uint8Array(0), { ...limits, readable: [], signal: given.signal }))).toBe("failed");
    expect(await reasonOf(convertDwgToDxf(SAMPLE, { signal: given.signal }))).toBe("failed");
  }, 30_000);

  // The refusal comes once the program is gone: were it left running, these would wait for it and never end.
  it("ends a program that does not finish, and one that writes too much", async () => {
    expect(await reasonOf(runLockedProgram("setInterval(() => {}, 1000);", "{}", new Uint8Array(0), { timeoutMs: 300, maxOutputBytes: 1000, readable: [] }))).toBe("timeout");
    expect(await reasonOf(runLockedProgram("const more = () => process.stdout.write('x'.repeat(65536), more); more();", "{}", new Uint8Array(0), { timeoutMs: 20_000, maxOutputBytes: 100_000, readable: [] }))).toBe("output_too_large");
  }, 30_000);
});

describe("oneAtATime", () => {
  const events: string[] = [];
  const task = (name: string, fails = false) => () => new Promise<string>((resolve, reject) => {
    events.push(`start ${name}`);
    setTimeout(() => {
      events.push(`end ${name}`);
      if (fails) reject(new Error(name));
      else resolve(name);
    }, 15);
  });
  const told = (outcomes: PromiseSettledResult<string>[]) => outcomes.map((outcome) => (outcome.status === "fulfilled" ? outcome.value : outcome.reason instanceof DwgConversionError ? outcome.reason.reason : "refused"));

  it("starts a conversion when the one before it has ended, whether that one succeeded or not", async () => {
    events.length = 0;
    const queue = oneAtATime(3);
    const outcomes = await Promise.allSettled([queue(task("a", true)), queue(task("b")), queue(task("c"))]);
    expect(events).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(told(outcomes)).toEqual(["refused", "b", "c"]);
  });

  it("turns away a conversion that would wait behind too many, and takes the next one once they have ended", async () => {
    events.length = 0;
    const queue = oneAtATime(2);
    const outcomes = await Promise.allSettled([queue(task("a")), queue(task("b")), queue(task("c"))]);
    expect(told(outcomes)).toEqual(["a", "b", "busy"]);
    expect(events).not.toContain("start c");
    expect(await queue(task("d"))).toBe("d");
  });
});
