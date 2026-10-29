import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

// Only public renderer resources from the installed PDF.js package are served.
const resourceTypes: Record<string, Record<string, string>> = {
  cmaps: { bcmap: "application/octet-stream" },
  standard_fonts: { pfb: "application/octet-stream", ttf: "font/ttf" },
  wasm: { wasm: "application/wasm", js: "text/javascript; charset=utf-8" },
  iccs: { icc: "application/octet-stream" },
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; file: string }> },
) {
  const { kind, file } = await params;
  const extension = file.split(".").at(-1) ?? "";
  const contentType =
    Object.hasOwn(resourceTypes, kind) &&
    Object.hasOwn(resourceTypes[kind], extension)
      ? resourceTypes[kind][extension]
      : undefined;
  if (!contentType || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(file))
    return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(
      path.join(process.cwd(), "node_modules/pdfjs-dist", kind, file),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
