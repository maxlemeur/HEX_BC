import fs from "node:fs";
import path from "node:path";

import type { FullConfig } from "@playwright/test";

import {
  POLISH_ASSERT,
  POLISH_OUTPUT_DIR,
  POLISH_PHASE,
  gitRevision,
  maskHost,
  resolveSupabaseHost,
  writeJson,
} from "./support";

export default async function globalSetup(config: FullConfig) {
  const only = process.env.POLISH_ONLY?.trim() || null;
  // A full run replaces the previous one; a scoped run (POLISH_ONLY) updates its routes only.
  if (!only) {
    for (const dir of ["results", "shots"]) {
      fs.rmSync(path.join(POLISH_OUTPUT_DIR, dir), { recursive: true, force: true });
    }
  }

  writeJson(path.join(POLISH_OUTPUT_DIR, "manifest.json"), {
    phase: POLISH_PHASE,
    assert: POLISH_ASSERT,
    scope: only ?? "all",
    startedAt: new Date().toISOString(),
    command: `POLISH_PHASE=${POLISH_PHASE}${only ? ` POLISH_ONLY=${only}` : ""}${POLISH_ASSERT ? " POLISH_ASSERT=1" : ""} npx playwright test -c e2e/polish.config.ts`,
    revision: gitRevision(),
    baseURL: config.projects[0]?.use.baseURL ?? null,
    supabaseHost: maskHost(resolveSupabaseHost()),
    takeoffModuleDefault: process.env.TAKEOFF_MODULE_ENABLED_BY_DEFAULT ?? null,
    fixtures: "fixtures.json",
    results: "results/<route>.json",
    screenshots: "shots/<route>/<viewport>.png",
    report: "report.md",
    credentials: "none recorded (session from e2e/.auth, not copied)",
  });
}
