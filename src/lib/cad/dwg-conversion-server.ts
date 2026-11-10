import "server-only";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { DwgConversionError, dwgFormatCode } from "./dwg-conversion";
import { DWG_CONVERSION_EXIT, DWG_CONVERSION_SCRIPT, type DwgConversionScriptInput } from "./dwg-conversion-script";
import { CAD_LIMITS } from "./dxf";

// A DWG becomes the DXF of the same drawing, which the reader of src/lib/cad
// then reads like any other. The conversion is LibreDWG's and runs away from
// the server: in a Node process of its own, started without the right to
// touch the disk, the network or another program, with no secret in its
// environment, ended at a deadline and when it writes more than the reader
// takes. A DWG is a file someone outside sent: nothing it holds is trusted.

export const DWG_CONVERSION_LIMITS = {
  maxInputBytes: 50 * 1024 * 1024,
  /** A DXF the reader would refuse is not waited for. */
  maxOutputBytes: CAD_LIMITS.maxBytes,
  timeoutMs: 60_000,
  heapMb: 512,
  /** 1 GiB, which is what LibreDWG's WebAssembly memory starts with: it does not grow past it. */
  wasmPages: 16_384,
} as const;

/** The first DWG format the converter writes a DXF of: « AC1018 », AutoCAD 2004. */
const FIRST_CONVERTED_FORMAT = 1018;

export type LockedProgramOptions = {
  /** Files and directories (ending in a separator and « * ») the program may read: nothing else of the disk. */
  readable: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  heapMb?: number;
  wasmPages?: number;
};

/**
 * Runs a script in a Node process that can only compute: `input` on its
 * standard input, what it writes back and its exit code. Rejects with
 * « timeout » or « output_too_large », the process ended.
 */
export async function runLockedProgram(script: string, argument: string, input: Uint8Array, options: LockedProgramOptions) {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [
    "--permission",
    ...options.readable.map((path) => `--allow-fs-read=${path}`),
    `--max-old-space-size=${options.heapMb ?? DWG_CONVERSION_LIMITS.heapMb}`,
    `--wasm-max-mem-pages=${options.wasmPages ?? DWG_CONVERSION_LIMITS.wasmPages}`,
    "-e", script, argument,
  ], {
    stdio: ["pipe", "pipe", "ignore"],
    // The program needs no key, token or server secret.
    env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV ?? "development" },
  });
  return new Promise<{ exitCode: number | null; output: Uint8Array }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0, settled = false;
    const finish = (outcome: { exitCode: number | null } | DwgConversionError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (outcome instanceof DwgConversionError) reject(outcome);
      else resolve({ exitCode: outcome.exitCode, output: new Uint8Array(Buffer.concat(chunks)) });
    };
    const timer = setTimeout(() => finish(new DwgConversionError("timeout")), options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > options.maxOutputBytes) finish(new DwgConversionError("output_too_large"));
      else chunks.push(chunk);
    });
    child.once("error", () => finish(new DwgConversionError("failed")));
    child.once("close", (exitCode) => finish({ exitCode }));
    // A program that ends before it has read everything closes its input: that is its exit code to tell.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

let lastConversion: Promise<unknown> = Promise.resolve();

/** One conversion at a time in a server instance: each one holds up to half a gigabyte for a few seconds. */
export function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = lastConversion.then(task, task);
  lastConversion = run.catch(() => {});
  return run;
}

function libredwgLocation(): DwgConversionScriptInput & { readable: string[] } {
  // Resolved through Node's own require: bundlers rewrite static imports of node:module.
  const requireFromProject = process.getBuiltinModule("node:module").createRequire(join(process.cwd(), "package.json"));
  const wasmDirectory = join(requireFromProject.resolve(["@mlightcad", "libredwg-web"].join("/")), "..", "..", "wasm", "/");
  return { moduleUrl: pathToFileURL(join(wasmDirectory, "libredwg-web.js")).href, wasmDirectory, readable: [`${wasmDirectory}*`] };
}

/** The DXF of a DWG saved in the 2004 format or a later one; throws DwgConversionError, never a partial drawing. */
export async function convertDwgToDxf(bytes: Uint8Array, options: { timeoutMs?: number; maxOutputBytes?: number } = {}): Promise<Uint8Array> {
  if (bytes.byteLength === 0) throw new DwgConversionError("empty");
  if (bytes.byteLength > DWG_CONVERSION_LIMITS.maxInputBytes) throw new DwgConversionError("too_large");
  const format = dwgFormatCode(bytes);
  if (format === null) throw new DwgConversionError("not_dwg");
  // LibreDWG's WebAssembly build breaks down writing the DXF of the older formats: they are named instead of tried.
  if (!(Number(format.slice(2)) >= FIRST_CONVERTED_FORMAT)) throw new DwgConversionError("old_format");
  const { readable, ...location } = libredwgLocation();
  const { exitCode, output } = await oneAtATime(() => runLockedProgram(DWG_CONVERSION_SCRIPT, JSON.stringify(location), bytes, {
    readable,
    timeoutMs: options.timeoutMs ?? DWG_CONVERSION_LIMITS.timeoutMs,
    maxOutputBytes: options.maxOutputBytes ?? DWG_CONVERSION_LIMITS.maxOutputBytes,
  }));
  if (exitCode !== DWG_CONVERSION_EXIT.converted || output.byteLength === 0) throw new DwgConversionError("failed");
  return output;
}
