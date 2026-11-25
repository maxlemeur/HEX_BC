// Compile waves of the ChatGPT local development servers (e2e/army/local/chatgpt-server-support.ts).
//
// INTRETRY01 failed on both attempts in runs 45079686226, 45440210924, 45477586566 and 45480694457, and once in
// 45449886012: its first reclassification had not reached the database after 15 s. It is the first test of
// the former combined ChatGPT file to use the affaire's intake desk, and the desk's API routes compiled in its body,
// one after the other (upload, dossier read, plan reconciliation, then the preview and the transcription of the
// opened document). While Next compiles, every request waits for it, the reclassification's server action too.
// The "intake" wave compiles these routes before the tests, in a hook of its own.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { chatGptCompileRequests } from "../../e2e/army/local/chatgpt-server-support";

const root = process.cwd();
const absent = "00000000-0000-4000-8000-000000000001";

describe("ChatGPT local compile waves", () => {
  it("compiles every intake route a cold affaire intake desk asks for, without running a handler", () => {
    const routes = ["", "/files", "/reconcile-plans", "/files/[documentId]/preview", "/files/[documentId]/transcription"];
    expect(chatGptCompileRequests("intake")).toEqual(routes.map((route) => ({
      path: `/api/affaires/${absent}/intake${route.replace("[documentId]", absent)}`, method: "OPTIONS", expected: [204],
    })));
    for (const route of routes) {
      expect(fs.existsSync(path.join(root, "src/app/api/affaires/[projectId]/intake", route, "route.ts")), route).toBe(true);
    }
  });

  it.each(["confirmation", "documents", "recovery"])("warms the %s server before its first intake test", (family) => {
    const source = fs.readFileSync(path.join(root, `e2e/army/local/chatgpt-local-intake-${family}.e2e.ts`), "utf8");
    const start = source.indexOf("await server.start()");
    const hook = source.indexOf("beforeAll(() => server.compileIntakeRoutes());");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(hook).toBeGreaterThan(start);
    expect(hook).toBeLessThan(source.search(/^(?:if \([^\n]*\) )?test\(/m));
  });
});
