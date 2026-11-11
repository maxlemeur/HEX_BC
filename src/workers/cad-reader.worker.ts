// Reads a CAD original away from the page: a large DXF takes seconds to read
// and to plot, and so does an IFC model to mesh. The worker keeps the drawing it has read, so that a plot does
// not send it back; one worker serves one opened document.

import { CadReadError, type CadReadErrorReason } from "../lib/cad/dxf";
import type { CadDrawing } from "../lib/cad/model";
import { readCadOriginal, type CadOriginal } from "../lib/cad/original";
import { CadPlotError, plotCadDrawing, type CadPlot, type CadPlotErrorReason, type CadPlotOptions } from "../lib/cad/plot";

export type CadWorkerRequest =
  | { requestId: string; type: "read"; fileName: string; buffer: ArrayBuffer }
  | { requestId: string; type: "plot"; options: CadPlotOptions };

/** « no_drawing »: a plot asked before a drawing was read. « failed »: anything unforeseen, whose message stays in the worker. */
export type CadWorkerFailureReason = CadReadErrorReason | CadPlotErrorReason | "no_drawing" | "failed";

export type CadWorkerResponse =
  | { requestId: string; ok: true; type: "read"; original: CadOriginal }
  | { requestId: string; ok: true; type: "plot"; plot: CadPlot }
  | { requestId: string; ok: false; type: "read" | "plot"; reason: CadWorkerFailureReason };

export type CadWorkerReply = { response: CadWorkerResponse; transfer: Transferable[] };

/** The same bytes alone in their buffer, so that handing the buffer over hands nothing else. */
function alone(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

/** `ifcWasmUrl`: where the WebAssembly that reads an IFC model is fetched from; asked only when one is read. */
export function createCadReader(options: { ifcWasmUrl?(): string } = {}): (request: CadWorkerRequest) => Promise<CadWorkerReply> {
  let drawing: CadDrawing | null = null;

  return async (request) => {
    const { requestId, type } = request;
    try {
      if (request.type === "read") {
        drawing = null;
        const original = await readCadOriginal(request.fileName, new Uint8Array(request.buffer), { ifcWasmUrl: options.ifcWasmUrl?.() });
        if (original.kind === "ifc") {
          // The mesh is heavy and the worker has no more use for it: its buffers are handed over.
          const { mesh } = original.model;
          return { response: { requestId, ok: true, type: "read", original }, transfer: mesh ? [mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer, mesh.indices.buffer] : [] };
        }
        // What a file says of itself goes with its image alone; a drawing is posted as a copy, since the worker needs its own to plot.
        const said = original.kind === "drawing" ? original.source : original.summary;
        const thumbnail = said?.thumbnail && { ...said.thumbnail, bytes: alone(said.thumbnail.bytes) };
        const transfer = thumbnail ? [thumbnail.bytes.buffer] : [];
        if (original.kind === "summary") return { response: { requestId, ok: true, type: "read", original: { kind: "summary", summary: { ...original.summary, thumbnail: thumbnail ?? null } } }, transfer };
        drawing = original.drawing;
        const posted: CadOriginal = original.source ? { ...original, source: { ...original.source, thumbnail: thumbnail ?? null } } : original;
        return { response: { requestId, ok: true, type: "read", original: posted }, transfer };
      }
      if (!drawing) return { response: { requestId, ok: false, type, reason: "no_drawing" }, transfer: [] };
      const plotted = await plotCadDrawing(drawing, request.options), plot = { ...plotted, bytes: alone(plotted.bytes) };
      return { response: { requestId, ok: true, type: "plot", plot }, transfer: [plot.bytes.buffer] };
    } catch (error) {
      const reason = error instanceof CadReadError || error instanceof CadPlotError ? error.reason : "failed";
      return { response: { requestId, ok: false, type, reason }, transfer: [] };
    }
  };
}

if (typeof self !== "undefined") {
  // The bundler copies the file beside the worker and gives its address.
  const reader = createCadReader({ ifcWasmUrl: () => new URL("web-ifc/web-ifc.wasm", import.meta.url).href });
  self.onmessage = async (event: MessageEvent<CadWorkerRequest>) => {
    const request = event.data;
    if (!request || typeof request.requestId !== "string" || (request.type !== "read" && request.type !== "plot")) return;
    const reply = await reader(request);
    self.postMessage(reply.response, { transfer: reply.transfer });
  };
}
