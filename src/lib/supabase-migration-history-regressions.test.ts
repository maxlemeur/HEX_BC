import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Supabase migration history regressions", () => {
  const migrationsDirectory = path.resolve(
    process.cwd(),
    "supabase/migrations"
  );

  it("keeps every SQL migration version unique", () => {
    const versions = fs
      .readdirSync(migrationsDirectory)
      .filter((fileName) => fileName.endsWith(".sql"))
      .map((fileName) => fileName.split("_", 1)[0]);

    expect(new Set(versions).size).toBe(versions.length);
  });

  it("creates the historical base schema before the first profile alteration", () => {
    const firstMigration = fs.readFileSync(
      path.join(migrationsDirectory, "001_add_job_title_to_profiles.sql"),
      "utf8"
    );
    const createProfilesPosition = firstMigration.search(
      /create table public\.profiles/i
    );
    const alterProfilesPosition = firstMigration.search(
      /alter table public\.profiles/i
    );

    expect(createProfilesPosition).toBeGreaterThanOrEqual(0);
    expect(alterProfilesPosition).toBeGreaterThan(createProfilesPosition);
  });
});
