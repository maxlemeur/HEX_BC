import "server-only";

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { DwgConversionError, dwgFormatCode, type DwgConversionErrorReason } from "./dwg-conversion";
import { DWG_CONVERSION_SCRIPT, DWG_DATABASE_SCRIPT } from "./dwg-conversion-script";
import { CAD_LIMITS } from "./dxf";

// A DWG becomes the DXF of the same drawing, which the reader of src/lib/cad
// then reads like any other. The conversion is LibreDWG's and runs away from
// the server: in a Node process of its own, started without the right to
// touch the disk, the network or another program, with no secret in its
// environment, ended at a deadline, when it writes more than the reader takes
// and when who asked has left. A DWG is a file someone outside sent: nothing
// it holds is trusted.

export const DWG_CONVERSION_LIMITS = {
  maxInputBytes: 50 * 1024 * 1024,
  /** A DXF the reader would refuse is not waited for. */
  maxOutputBytes: CAD_LIMITS.maxBytes,
  timeoutMs: 60_000,
  heapMb: 512,
  /** 1 GiB, which is what LibreDWG's WebAssembly memory starts with: it does not grow past it. */
  wasmPages: 16_384,
  /** Conversions a server instance takes at once, the one running included: the last one waits three deadlines at most. */
  maxPending: 4,
} as const;

/** The first DWG format that is converted: « AC1012 », AutoCAD R13. Before it a file names all its dimension blocks alike. */
const FIRST_CONVERTED_FORMAT = 1012;
/** The first DWG format LibreDWG writes the DXF of itself: « AC1018 », AutoCAD 2004. Before it the DXF is written from what LibreDWG read. */
const FIRST_FORMAT_LIBREDWG_WRITES = 1018;
/** The first Node whose `--permission` closes the network too: before it a locked program could still open a connection. */
const FIRST_NODE_THAT_LOCKS_THE_NETWORK = 25;

/** How the conversion script ends: 0 with the whole DXF written out, otherwise what it wrote is dropped. */
const CONVERTED = 0;

export type LockedProgramOptions = {
  /** Files and directories (ending in a separator and « * ») the program may read: nothing else of the disk. */
  readable: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  heapMb?: number;
  wasmPages?: number;
  /** Given up by who asked: the program is ended, or not started. */
  signal?: AbortSignal;
};

/** Whether a program started with `--permission` by this Node (« 26.12.1 ») is kept off the network as it is off the disk. */
export function nodeLocksTheNetwork(version: string): boolean {
  const major = /^v?(\d+)\.\d+\.\d+/.exec(version.trim());
  return major !== null && Number(major[1]) >= FIRST_NODE_THAT_LOCKS_THE_NETWORK;
}

/**
 * Runs a script in a Node process that can only compute: `input` on its
 * standard input, what it writes back and its exit code. Rejects with
 * « timeout », « output_too_large » or « failed », once the process is gone;
 * with « failed » and nothing started on a Node that would leave it the network.
 */
export async function runLockedProgram(script: string, argument: string, input: Uint8Array, options: LockedProgramOptions) {
  const { spawn } = await import("node:child_process");
  const { signal } = options;
  if (!nodeLocksTheNetwork(process.versions.node)) {
    // The fault is the server's, not the file's: said where who runs the server reads it.
    console.error(`DWG conversion refused: Node ${process.versions.node} does not keep a locked program off the network, Node ${FIRST_NODE_THAT_LOCKS_THE_NETWORK} or later does.`);
    throw new DwgConversionError("failed");
  }
  if (signal?.aborted) throw new DwgConversionError("failed");
  return new Promise<{ exitCode: number | null; output: Uint8Array }>((resolve, reject) => {
    const failed = () => reject(new DwgConversionError("failed"));
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, [
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
    } catch {
      return failed();
    }
    const chunks: Buffer[] = [];
    let size = 0, refusal: DwgConversionError | null = null, settled = false;
    /** Ends the program for `reason`; the refusal is told once it is gone. */
    const stop = (reason: DwgConversionErrorReason) => {
      if (refusal) return;
      refusal = new DwgConversionError(reason);
      child.kill("SIGKILL");
    };
    const giveUp = () => stop("failed");
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    const settle = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", giveUp);
      if (refusal) reject(refusal);
      else resolve({ exitCode, output: Buffer.concat(chunks) });
    };
    // A program that could not be started tells it here, and never closes.
    child.once("error", () => {
      refusal ??= new DwgConversionError("failed");
      settle(null);
    });
    child.once("close", settle);
    signal?.addEventListener("abort", giveUp, { once: true });
    // A server out of file descriptors is given a child without its pipes.
    if (!child.stdin || !child.stdout) return giveUp();
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > options.maxOutputBytes) stop("output_too_large");
      else if (!refusal) chunks.push(chunk);
    });
    // A program that ends before it has read everything closes its input: that is its exit code to tell.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/**
 * A queue that runs one task at a time and holds `maxPending` of them at most, the running one
 * included; a task past that is refused with « busy ». Each conversion holds up to a gigabyte for a few seconds.
 */
export function oneAtATime(maxPending: number) {
  let last: Promise<unknown> = Promise.resolve(), pending = 0;
  return <T>(task: () => Promise<T>): Promise<T> => {
    if (pending >= maxPending) return Promise.reject(new DwgConversionError("busy"));
    pending += 1;
    const run = last.then(task).finally(() => {
      pending -= 1;
    });
    last = run.catch(() => {});
    return run;
  };
}

const conversions = oneAtATime(DWG_CONVERSION_LIMITS.maxPending);

/**
 * What a conversion script is told (the file: URLs of the module that creates the WebAssembly instance and of the one
 * that reads a drawing into objects, the directory of the .wasm file), and what of the disk each script may read.
 */
function libredwgLocation() {
  // Resolved through Node's own require: bundlers rewrite static imports of node:module.
  const requireFromProject = process.getBuiltinModule("node:module").createRequire(join(process.cwd(), "package.json"));
  const packageDirectory = join(requireFromProject.resolve(["@mlightcad", "libredwg-web"].join("/")), "..", "..");
  const wasmDirectory = join(packageDirectory, "wasm", "/"), reader = join(packageDirectory, "dist", "libredwg-web.js");
  return {
    told: { moduleUrl: pathToFileURL(join(wasmDirectory, "libredwg-web.js")).href, readerUrl: pathToFileURL(reader).href, wasmDirectory },
    wasmOnly: [`${wasmDirectory}*`],
    // The reader is a module of the package: Node looks at the package's own description to load it.
    withReader: [`${wasmDirectory}*`, reader, join(packageDirectory, "package.json")],
  };
}

/** The DXF of a DWG saved in the R13 format or a later one; throws DwgConversionError, never a partial drawing. */
export async function convertDwgToDxf(bytes: Uint8Array, options: { timeoutMs?: number; maxOutputBytes?: number; signal?: AbortSignal } = {}): Promise<Uint8Array> {
  if (bytes.byteLength === 0) throw new DwgConversionError("empty");
  if (bytes.byteLength > DWG_CONVERSION_LIMITS.maxInputBytes) throw new DwgConversionError("too_large");
  const format = dwgFormatCode(bytes);
  if (format === null) throw new DwgConversionError("not_dwg");
  const release = Number(format.slice(2));
  // The formats before R13 are named instead of tried.
  if (!(release >= FIRST_CONVERTED_FORMAT)) throw new DwgConversionError("old_format");
  // LibreDWG's WebAssembly build breaks down writing the DXF of a format before 2004: there it only reads.
  const written = release >= FIRST_FORMAT_LIBREDWG_WRITES;
  const { told, wasmOnly, withReader } = libredwgLocation();
  const { exitCode, output } = await conversions(() => runLockedProgram(written ? DWG_CONVERSION_SCRIPT : DWG_DATABASE_SCRIPT, JSON.stringify(told), bytes, {
    readable: written ? wasmOnly : withReader,
    timeoutMs: options.timeoutMs ?? DWG_CONVERSION_LIMITS.timeoutMs,
    maxOutputBytes: options.maxOutputBytes ?? DWG_CONVERSION_LIMITS.maxOutputBytes,
    signal: options.signal,
  }));
  if (exitCode !== CONVERTED || output.byteLength === 0) throw new DwgConversionError("failed");
  return output;
}
