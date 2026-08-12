import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = path.join(process.cwd(), "supabase", "migrations");
const enumMigration = readFileSync(
  path.join(
    migrationsDirectory,
    "20260811231754_estimate_email_sending_status.sql"
  ),
  "utf8"
);
const outboxMigration = readFileSync(
  path.join(
    migrationsDirectory,
    "20260811231759_transactional_estimate_email_outbox.sql"
  ),
  "utf8"
);

describe("transactional estimate email migration contract", () => {
  it("commits the sending enum value in a standalone earlier migration", () => {
    expect(enumMigration).toMatch(
      /alter type public\.estimate_status\s+add value if not exists 'sending'/i
    );
    expect(enumMigration).not.toMatch(/create or replace function/i);
  });

  it("freezes a draft before the provider call and keeps delivery uncertainty explicit", () => {
    expect(outboxMigration).toMatch(/'draft' and new\.status in \('sending', 'sent'\)/i);
    expect(outboxMigration).toMatch(/interval '23 hours'/i);
    expect(outboxMigration).toMatch(/'unknown'/i);
    expect(outboxMigration).toMatch(/estimate_emails_one_active_initial_uidx/i);
  });

  it("keeps a separate append-only dispatch journal", () => {
    expect(outboxMigration).toMatch(/create table if not exists public\.estimate_email_dispatch_events/i);
    expect(outboxMigration).toMatch(/ESTIMATE_EMAIL_DISPATCH_EVENTS_APPEND_ONLY/i);
    expect(outboxMigration).toMatch(/revoke all on table public\.estimate_email_dispatch_events/i);
  });

  it("exposes dispatch mutations only to service_role", () => {
    for (const functionName of [
      "reserve_estimate_email_dispatch",
      "prepare_estimate_email_dispatch",
      "claim_estimate_email_dispatch",
      "complete_estimate_email_dispatch",
      "fail_estimate_email_dispatch",
      "defer_estimate_email_dispatch",
      "mark_estimate_email_dispatch_unknown",
      "reconcile_estimate_email_dispatch",
    ]) {
      expect(outboxMigration).toMatch(
        new RegExp(
          `revoke execute on function public\\.${functionName}[\\s\\S]*?from public, anon, authenticated`,
          "i"
        )
      );
      expect(outboxMigration).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}[\\s\\S]*?to service_role`,
          "i"
        )
      );
    }
  });

  it("requires provider proof for sent reconciliation and preserves legacy confirmation rows", () => {
    expect(outboxMigration).toMatch(/ESTIMATE_EMAIL_PROVIDER_ID_REQUIRED/i);
    expect(outboxMigration).toMatch(/normalized_resolution not in \('sent', 'failed'\)/i);
    expect(outboxMigration).toMatch(
      /old\.request_id is null and new\.request_id is null[\s\S]*?return new/i
    );
    expect(outboxMigration).toMatch(/acceptance_confirmation/i);
  });
});
