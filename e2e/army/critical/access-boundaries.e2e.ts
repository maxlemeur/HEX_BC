import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

type AccessCase = {
  id: string;
  route: string;
  method: "GET" | "POST";
  payloadKind: "none" | "json" | "csv-import" | "csv-takeoff";
  jsonBody: string | null;
};

test(
  "anonymous requests cannot read or create estimates, imports or takeoff jobs",
  { tags: ["critical", "anonymous", "access-boundary"], requires: ["browser"], trace: "on" },
  async ({ app, browser, screen }) => {
    const runId = randomUUID();
    const runPrefix = `ARMY access ${runId}`;
    const origin = new URL(app.baseUrl!).origin;
    const csv = "Designation;Unite;Quantite;Prix unitaire\nARMY access line;m2;2;12.50\n";
    const cases: AccessCase[] = [
      { id: "estimate-list", route: "/api/estimates", method: "GET", payloadKind: "none", jsonBody: null },
      {
        id: "estimate-create",
        route: "/api/estimates",
        method: "POST",
        payloadKind: "json",
        jsonBody: JSON.stringify({
          project: { name: runPrefix, reference: runPrefix, client_name: "ARMY fixture" },
          version: { title: "ARMY access draft", date_devis: "2026-10-02", validite_jours: 30 },
          creation_mode: "blank",
        }),
      },
      { id: "import-list", route: "/api/imports", method: "GET", payloadKind: "none", jsonBody: null },
      {
        id: "import-json-create",
        route: "/api/imports",
        method: "POST",
        payloadKind: "json",
        jsonBody: JSON.stringify({
          filename: `ARMY-access-${runId}.json`,
          sourceFormat: "json",
          sourceKind: "tabular",
          rows: [{ Designation: "ARMY access line", Unite: "m2", Quantite: "2", "Prix unitaire": "12.50" }],
        }),
      },
      { id: "import-csv-upload", route: "/api/imports", method: "POST", payloadKind: "csv-import", jsonBody: null },
      { id: "takeoff-list", route: "/api/takeoff/jobs?limit=1&offset=0", method: "GET", payloadKind: "none", jsonBody: null },
      { id: "takeoff-csv-upload", route: "/api/takeoff/jobs", method: "POST", payloadKind: "csv-takeoff", jsonBody: null },
    ];
    const evidence = {
      schemaVersion: 1,
      runId,
      runPrefix,
      appOrigin: origin,
      startedAt: new Date().toISOString(),
      finishedAt: null as string | null,
      status: "running" as "running" | "passed" | "failed",
      viewport: null as { width: number; height: number } | null,
      authentication: "none; fetch credentials omitted",
      fixture: {
        projectName: runPrefix,
        syntheticEstimateVersionId: runId,
        fileName: `ARMY-access-${runId}.csv`,
        csvSha256: createHash("sha256").update(csv).digest("hex"),
      },
      persistence: { verified: false, reason: "No database observer; HTTP refusal is not a row-count assertion." },
      cases: cases.map((entry) => ({
        ...entry,
        requestSha256: entry.jsonBody
          ? createHash("sha256").update(entry.jsonBody).digest("hex")
          : null,
        expected: { status: 401, ok: false, code: "UNAUTHORIZED", businessData: false },
        result: "not-executed" as "not-executed" | "passed" | "failed",
        actual: null as null | {
          status: number;
          redirected: boolean;
          responsePath: string;
          jsonResponse: boolean;
          bodyKeys: string[];
          errorKeys: string[];
          detailKeys: string[];
          publicMetadataMatches: boolean;
          ok: boolean | null;
          code: string | null;
          hasPublicMessage: boolean;
        },
      })),
    };

    try {
      await browser.route("**/*", async (route) => {
        const url = new URL(route.request.url);
        if (url.hostname === "api.fontshare.com" && url.pathname === "/v2/css" && route.request.method === "GET") {
          await route.fulfill({ headers: { "content-type": "text/css" }, body: "" });
          return;
        }
        const allowedProductPost = route.request.method === "POST" &&
          ["/api/estimates", "/api/imports", "/api/takeoff/jobs"].includes(url.pathname);
        if (url.origin !== origin || (!allowedProductPost && !["GET", "HEAD", "OPTIONS"].includes(route.request.method))) {
          await route.abort();
          throw new Error("Access-boundary scenario blocked traffic outside its local API scope.");
        }
        await route.continue();
      });

      await app.open("/login");
      await expect(screen.getByRole("heading", "Connexion", { exact: true })).toBeVisible();
      evidence.viewport = await browser.evaluate(() => ({ width: innerWidth, height: innerHeight }));

      for (const entry of evidence.cases) {
        entry.result = "failed";
        const actual = await browser.evaluate(async (input) => {
          let body: string | FormData | undefined;
          const headers: Record<string, string> = {};
          if (input.payloadKind === "json") {
            headers["content-type"] = "application/json";
            body = input.jsonBody!;
          } else if (input.payloadKind === "csv-import" || input.payloadKind === "csv-takeoff") {
            const formData = new FormData();
            formData.set("file", new File([input.csv], `ARMY-access-${input.runId}.csv`, { type: "text/csv" }));
            if (input.payloadKind === "csv-import") {
              formData.set("headerRowNumber", "1");
            } else {
              formData.set("estimate_version_id", input.runId);
              formData.set("level", "A");
              headers["idempotency-key"] = `ARMY-access-${input.runId}`;
            }
            body = formData;
          }
          const response = await fetch(input.route, { method: input.method, credentials: "omit", headers, body });
          const jsonResponse = (response.headers.get("content-type") ?? "").includes("application/json");
          const parsed: unknown = jsonResponse ? await response.json() : null;
          const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
          const rawError = record.error;
          const error = rawError && typeof rawError === "object" && !Array.isArray(rawError)
            ? rawError as Record<string, unknown>
            : {};
          const rawDetails = error.details;
          const details = rawDetails && typeof rawDetails === "object" && !Array.isArray(rawDetails)
            ? rawDetails as Record<string, unknown>
            : {};
          // Never persist response data or error details if an access regression leaks them.
          return {
            status: response.status,
            redirected: response.redirected,
            responsePath: new URL(response.url).pathname,
            jsonResponse,
            bodyKeys: Object.keys(record).sort(),
            errorKeys: Object.keys(error).sort(),
            detailKeys: Object.keys(details).sort(),
            publicMetadataMatches: input.payloadKind === "csv-takeoff"
              ? error.retryable === false && error.level === "A" && details.retryable === false && details.level === "A"
              : rawDetails === undefined,
            ok: typeof record.ok === "boolean" ? record.ok : null,
            code: typeof error.code === "string" ? error.code : null,
            hasPublicMessage: typeof error.message === "string" && error.message.length > 0,
          };
        }, {
          route: entry.route,
          method: entry.method,
          payloadKind: entry.payloadKind,
          jsonBody: entry.jsonBody,
          csv,
          runId,
        });
        entry.actual = actual;
        expect(actual.status, entry.id).toBe(401);
        expect(actual.redirected, entry.id).toBe(false);
        expect(actual.responsePath, entry.id).toBe(new URL(entry.route, origin).pathname);
        expect(actual.jsonResponse, entry.id).toBe(true);
        expect(actual.ok, entry.id).toBe(false);
        expect(actual.code, entry.id).toBe("UNAUTHORIZED");
        expect(actual.hasPublicMessage, entry.id).toBe(true);
        expect(actual.bodyKeys, entry.id).toEqual(["error", "ok"]);
        expect(actual.errorKeys, entry.id).toEqual(entry.payloadKind === "csv-takeoff"
          ? ["code", "details", "level", "message", "retryable"]
          : ["code", "message"]);
        expect(actual.detailKeys, entry.id).toEqual(entry.payloadKind === "csv-takeoff"
          ? ["level", "retryable"]
          : []);
        expect(actual.publicMetadataMatches, entry.id).toBe(true);
        entry.result = "passed";
      }
      evidence.status = "passed";
    } finally {
      if (evidence.status !== "passed") evidence.status = "failed";
      evidence.finishedAt = new Date().toISOString();
      const evidenceDir = path.resolve(".e2e/army/critical/artifacts/business");
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(path.join(evidenceDir, `access-boundaries-${runId}.json`), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    }
  }
);
