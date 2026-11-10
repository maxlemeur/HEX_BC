import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { DwgConversionError, dwgFormatCode } from "@/lib/cad/dwg-conversion";
import { convertDwgToDxf, DWG_CONVERSION_LIMITS, nodeLocksTheNetwork, oneAtATime, runLockedProgram } from "@/lib/cad/dwg-conversion-server";
import { readDxf } from "@/lib/cad/dxf";
import { listCadPaths } from "@/lib/cad/model";
import { measureCadDrawing } from "@/lib/cad/quantities";

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "src/test/fixtures/cad", name)));

// The sample drawing LibreDWG ships with its own tests (see the NOTICE beside it): tables, blocks,
// texts, a hatch and two splines on five layers, saved by AutoCAD in the 2018 format.
const SAMPLE = fixture("libredwg-example-2018.dwg");
// The same drawing saved in the 2000 and R13 formats, and a door saved in the R14 format.
const SAMPLE_2000 = fixture("libredwg-example-2000.dwg");
const SAMPLE_R13 = fixture("libredwg-example-r13.dwg");
const DOOR_R14 = fixture("libredwg-door-r14.dwg");

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

  it("gives a DWG of the 2000 format the quantities of the same drawing saved in the 2018 format", async () => {
    expect(dwgFormatCode(SAMPLE_2000)).toBe("AC1015");
    const drawing = readDxf(await convertDwgToDxf(SAMPLE_2000));
    expect(drawing.truncated).toBe(false);
    expect(drawing.version).toEqual({ code: "AC1015", label: "AutoCAD 2000" });
    expect(drawing.units.name).toBe("millimètre");
    expect(drawing.layers.map((layer) => layer.name)).toEqual(expect.arrayContaining(["0", "Tavolo 2", "Tavolo 3"]));
    expect(drawing.layers).toHaveLength(5);
    expect(drawing.inserts).toHaveLength(10);
    expect(drawing.texts).toHaveLength(14);
    const { totals, extents, partial } = measureCadDrawing(drawing);
    expect(partial).toBe(false);
    expect(totals.blocks).toBe(10);
    expect(totals.blockLength).toBeCloseTo(6019.552, 3);
    expect(totals.closedArea).toBeCloseTo(133.602, 3);
    expect(totals.hatchArea).toBeCloseTo(0.122, 3);
    expect(totals.length).toBeCloseTo(103.631, 3);
    expect(drawing.warnings).toEqual([{ code: "spline_fit_points", detail: "2" }]);
    expect(extents?.width).toBeCloseTo(3411.857, 3);
    expect(extents?.height).toBeCloseTo(2645.183, 3);
    // What is not drawn is named as it is for the 2018 format, the entities LibreDWG's reading leaves out included.
    const named = async (bytes: Uint8Array) => readDxf(await convertDwgToDxf(bytes)).unsupported;
    expect(drawing.unsupported).toEqual(await named(SAMPLE));
    expect(drawing.unsupported).toEqual(expect.arrayContaining([{ type: "REGION", count: 2 }, { type: "POLYLINE (maillage)", count: 1 }, { type: "ARC_DIMENSION", count: 1 }]));
  }, 60_000);

  it("keeps the text of the attribute definitions of an older format, which LibreDWG's reading hands over without it", async () => {
    const lines = new TextDecoder().decode(await convertDwgToDxf(SAMPLE_2000)).split("\n");
    const records: Map<string, string>[] = [];
    for (let at = 0; at + 1 < lines.length; at += 2) {
      if (lines[at] === "0") records.push(new Map([["0", lines[at + 1]]]));
      else if (!records[records.length - 1].has(lines[at])) records[records.length - 1].set(lines[at], lines[at + 1]);
    }
    const definitions = records.filter((record) => record.get("0") === "ATTDEF");
    // AutoCAD's own DXF of this drawing holds the same three definitions.
    expect(definitions.map((record) => ["2", "1", "3", "70"].map((code) => record.get(code)))).toEqual([
      ["ETIKEDO", "valoro", "invitilo", "0"], ["ATRIBUTO", "at", "atrib", "0"], ["ETIKEDO", "valoro", "invitilo", "0"],
    ]);
  }, 60_000);

  it("reads a DWG of the R14 format, which has no unit and no layer kept off the plot", async () => {
    expect(dwgFormatCode(DOOR_R14)).toBe("AC1014");
    const drawing = readDxf(await convertDwgToDxf(DOOR_R14));
    expect(drawing.truncated).toBe(false);
    expect(drawing.version).toEqual({ code: "AC1014", label: "AutoCAD R14" });
    expect(drawing.units.metresPerUnit).toBeNull();
    expect(drawing.layers.map((layer) => [layer.name, layer.color, layer.plot])).toEqual([
      ["0", 0xffffff, true], ["R-DOOR-ANNO", 0xffffff, true], ["R-DOOR-DETL", 0x00ff00, true], ["R-DOOR-OTLN", 0xff0000, true], ["R-DOOR-PATT", 0x0000ff, true],
    ]);
    const paths = listCadPaths(drawing);
    expect(paths).toHaveLength(16);
    expect(paths.every((path) => path.kind === "line")).toBe(true);
    expect(measureCadDrawing(drawing).totals.length).toBeCloseTo(571.182, 3);
    expect(drawing.texts).toHaveLength(1);
    expect(drawing.unsupported).toEqual([]);
  }, 60_000);

  it("reads a DWG of the R13 format, with its polylines of the old kind and its hatch kept as a block", async () => {
    expect(dwgFormatCode(SAMPLE_R13)).toBe("AC1012");
    const drawing = readDxf(await convertDwgToDxf(SAMPLE_R13));
    expect(drawing.truncated).toBe(false);
    expect(drawing.version).toEqual({ code: "AC1012", label: "AutoCAD R13" });
    expect(drawing.layers.map((layer) => layer.name)).toEqual(expect.arrayContaining(["0", "TAVOLO_2", "TAVOLO_3"]));
    expect(drawing.layers.every((layer) => layer.plot)).toBe(true);
    // The drawing of the 2018 sample, with two blocks more: R13 keeps a hatch and a multileader as blocks.
    expect(drawing.inserts).toHaveLength(12);
    const polylines = listCadPaths(drawing).filter((path) => path.kind === "polyline" && path.block === null);
    expect(polylines).toHaveLength(12);
    expect(polylines.filter((path) => path.closed)).toHaveLength(11);
    // R13 has no unit of its own: the quantities are in the millimetres the plan is drawn in.
    expect(drawing.units.metresPerUnit).toBeNull();
    const { totals, partial } = measureCadDrawing(drawing);
    expect(partial).toBe(false);
    expect(totals.length / 1000).toBeCloseTo(103.631, 3);
    expect(totals.closedArea / 1_000_000).toBeCloseTo(133.602, 3);
    expect(totals.hatchArea).toBe(0);
  }, 60_000);

  it("says a DWG saved before the R13 format is not converted", async () => {
    for (const magic of ["AC1011", "AC1010", "AC1009", "AC1006", "AC1004", "AC1002", "AC2.10", "AC1.40"]) expect(await reasonOf(convertDwgToDxf(withMagic(magic))), magic).toBe("old_format");
  });

  it("fails on a file that only has the first bytes of a DWG, whatever format it says", async () => {
    for (const magic of ["AC1032", "AC1018", "AC1017", "AC1015", "AC1014", "AC1013", "AC1012"]) expect(await reasonOf(convertDwgToDxf(withMagic(magic))), magic).toBe("failed");
  }, 120_000);

  it("holds a DWG of an older format to the same deadline and to the same size", async () => {
    expect(await reasonOf(convertDwgToDxf(SAMPLE_2000, { timeoutMs: 5 }))).toBe("timeout");
    expect(await reasonOf(convertDwgToDxf(SAMPLE_2000, { maxOutputBytes: 100_000 }))).toBe("output_too_large");
  }, 60_000);

  it("stops the conversion at its deadline", async () => {
    expect(await reasonOf(convertDwgToDxf(SAMPLE, { timeoutMs: 5 }))).toBe("timeout");
  }, 60_000);

  it("stops a conversion whose DXF passes the size the reader takes", async () => {
    expect(await reasonOf(convertDwgToDxf(SAMPLE, { maxOutputBytes: 100_000 }))).toBe("output_too_large");
  }, 60_000);
});

describe("nodeLocksTheNetwork", () => {
  it("is true from Node 25, the first whose permission model closes the network", () => {
    for (const version of ["25.0.0", "26.12.1", "v27.1.0", "100.0.0"]) expect(nodeLocksTheNetwork(version), version).toBe(true);
    for (const version of ["24.11.1", "22.20.0", "v20.19.5", "9.11.2", "", "latest", "25"]) expect(nodeLocksTheNetwork(version), version).toBe(false);
    // The Node these tests run on is one of them: the probe below shows what it refuses.
    expect(nodeLocksTheNetwork(process.versions.node)).toBe(true);
  });
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
    // No key, token or server secret reaches the program. macOS itself sets __CF_USER_TEXT_ENCODING in
    // every process it starts, even one given an empty environment: it is the system's, not the server's.
    const fromThePlatform = process.platform === "darwin" ? ["__CF_USER_TEXT_ENCODING"] : [];
    expect(outcome.environment.filter((name: string) => !["NODE_ENV", "PATH", ...fromThePlatform].includes(name))).toEqual([]);
  }, 30_000);

  it("starts nothing on a Node that would leave the program the network, and says so to who runs the server", async () => {
    const actual = Object.getOwnPropertyDescriptor(process.versions, "node")!;
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(process.versions, "node", { ...actual, value: "24.11.1" });
    try {
      expect(await reasonOf(run("process.stdout.write('started', () => process.exit(0));"))).toBe("failed");
      expect(await reasonOf(convertDwgToDxf(SAMPLE))).toBe("failed");
      expect(await reasonOf(convertDwgToDxf(SAMPLE_2000))).toBe("failed");
      expect(said).toHaveBeenCalledTimes(3);
      expect(String(said.mock.calls[0][0])).toContain("Node 24.11.1");
    } finally {
      Object.defineProperty(process.versions, "node", actual);
      said.mockRestore();
    }
    expect((await run("process.stdout.write('started', () => process.exit(0));")).exitCode).toBe(0);
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
