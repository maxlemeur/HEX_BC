import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Only the owned native campaign imports this Node module. Bundle its existing
// pure persistence boundary, with the same server-only sentinel alias as Vitest.
// That boundary must stay free of Next: plain Node cannot load its route modules.
// No product test endpoint, feature flag, token or alternate Google host is added.
export async function localDriveStore(runPrefix: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(runPrefix)) throw new Error("Invalid owned run identity.");
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (origin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
    origin.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) throw new Error("Drive store test requires the owned loopback backend.");
  const directory = path.resolve(".e2e/army/critical/artifacts/drive-store", runPrefix);
  await mkdir(directory, { recursive: true });
  const outfile = path.join(directory, "store.mjs");
  const bundle = await build({ entryPoints: [path.resolve("src/lib/affaires/google-drive/store.ts")], outfile,
    bundle: true, platform: "node", format: "esm", packages: "external", metafile: true,
    alias: { "server-only": path.resolve("node_modules/server-only/empty.js"), "@": path.resolve("src") } });
  const next = Object.entries(bundle.metafile.inputs).flatMap(([input, { imports }]) => imports
    .filter((entry) => entry.external && /^next(\/|$)/.test(entry.path)).map((entry) => `${input} -> ${entry.path}`));
  if (next.length) throw new Error(`Drive persistence boundary imports Next: ${next.join(", ")}`);
  return await import(pathToFileURL(outfile).href) as typeof import("../../../src/lib/affaires/google-drive/store");
}
