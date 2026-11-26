import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("commits the nullable transcription source before validating its named CHECK", () => {
  const install = readFileSync("supabase/migrations/20261126173222_intake_ai_request_settings.sql", "utf8");
  const validate = readFileSync("supabase/migrations/20261126173223_validate_intake_transcription_ai_source.sql", "utf8");
  expect(install).toMatch(/add column ai_source text,\s*add constraint (\w+)\s*check \(ai_source in \([^)]+\)\) not valid;/i);
  const name = /add constraint (\w+)\s*check \(ai_source in/i.exec(install)?.[1];
  expect(install).toMatch(/commit;\s*$/i);
  expect(install).not.toMatch(new RegExp(`validate constraint ${name};`, "i"));
  expect(validate).toMatch(new RegExp(`begin;[\\s\\S]*validate constraint ${name};[\\s\\S]*commit;`, "i"));
});
