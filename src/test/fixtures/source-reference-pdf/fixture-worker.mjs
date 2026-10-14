// Fault-only worker fixture. Never used by a product route or selected from input.
import { parentPort, workerData } from "node:worker_threads";
const bytes = workerData.bytes;
const byteSize = bytes.byteLength;
const started = new Int32Array(workerData.started);
Atomics.store(started, 0, 1);

if (workerData.mode === "cpu-loop") {
  while (true) {} // Intentionally non-cooperative; real terminate() is required.
}
if (workerData.mode === "crash") {
  throw new Error("PRIVATE_PARSER_PATH=C:\\private\\source.pdf");
}
if (workerData.mode === "empty-exit") process.exit(0);

let message = { ok: true, bytes, byteSize, pageCount: 1 };
switch (workerData.mode) {
  case "wrong-ok": message.ok = "true"; break;
  case "zero-pages": message.pageCount = 0; break;
  case "too-many-pages": message.pageCount = 201; break;
  case "fractional-pages": message.pageCount = 1.5; break;
  case "nonfinite-pages": message.pageCount = Number.NaN; break;
  case "wrong-length": message.byteSize = byteSize - 1; break;
  case "wrong-buffer": message.bytes = new Uint8Array(bytes); break;
  case "extra-field": message.providerMessage = "PRIVATE_PARSER_PATH"; break;
  case "unknown-error": message = { ok: false, code: "PRIVATE_PARSER_PATH" }; break;
  case "tampered-bytes": new Uint8Array(bytes)[0] ^= 0xff; break;
  case "known-parser-error": message = { ok: false, code: "PDF_INVALID" }; break;
  case "success-loop": break;
  default: throw new Error("Unknown fixture mode");
}
parentPort.postMessage(message, message.bytes ? [bytes] : []);
while (true) {} // Even a successful reply must not keep the worker alive.
