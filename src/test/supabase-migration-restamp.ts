// Signatures only: the tests in supabase-migration-restamp.test.ts pin the
// behaviour before it is written.
export interface MigrationRestampEntry {
  from: string;
  to: string;
}

export interface MigrationRestampDependencies {
  now?: Date;
  rootDirectory?: string;
}

export interface MigrationRestampResult {
  base: { ref: string; sha: string; newest: string | null };
  checks: { guard: string[]; manifest: string[] } | null;
  dryRun: boolean;
  ok: boolean;
  references: string[];
  rehashed: Array<{ name: string; previous: string; next: string }>;
  renames: MigrationRestampEntry[];
}

export function planMigrationRestampTimestamps(_input: {
  at?: string;
  baseNewest: string | null;
  named: string[];
  now: Date;
  otherBranchMigrations: string[];
}): MigrationRestampEntry[] {
  throw new Error("not implemented");
}

export function runSupabaseMigrationRestamp(
  _argv: string[],
  _dependencies: MigrationRestampDependencies = {}
): MigrationRestampResult {
  throw new Error("not implemented");
}

export function runSupabaseMigrationRestampCli(
  _argv: string[],
  _dependencies: MigrationRestampDependencies & {
    error?: (line: string) => void;
    log?: (line: string) => void;
  } = {}
): number {
  throw new Error("not implemented");
}
