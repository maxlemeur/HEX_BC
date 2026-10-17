// Resolve hooks of the document fingerprint worker, loaded with
// `node --import tsx --import <this file>`. They change module resolution only
// inside that child process, never the application build:
// - `server-only` resolves to its empty React Server entry, as under Next.js;
// - `next/headers` resolves to the synthesized request of the worker;
// - the document preparer resolves to its observation wrapper, which calls
//   the real function. Its own import of the real module is left untouched.
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..", "..");
const serverOnly = pathToFileURL(path.join(root, "node_modules", "server-only", "empty.js")).href;
const request = pathToFileURL(path.join(directory, "document-fingerprints-request.ts")).href;
const spy = pathToFileURL(path.join(directory, "document-fingerprints-spy.ts")).href;
const preparer = "@/components/estimate-document/prepare-estimate-document-data";
// Compare paths, not URL spellings: a loader may add a query or change case.
const spyPath = path.normalize(fileURLToPath(spy)).toLowerCase();
const isSpy = (url) => {
  try {
    return Boolean(url) && path.normalize(fileURLToPath(url.split("?")[0])).toLowerCase() === spyPath;
  } catch {
    return false;
  }
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: serverOnly, shortCircuit: true };
    if (specifier === "next/headers") return { url: request, shortCircuit: true };
    if (specifier === preparer && !isSpy(context.parentURL)) return { url: spy, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
