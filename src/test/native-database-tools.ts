import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PINNED_SUPABASE_POSTGRES_BUNDLE } from "@/test/supabase-cli";

/** The PostgreSQL client binaries of the native Supabase runtime the pinned CLI installed. */
export interface NativePostgresTools {
  bundle: string;
  pgDump: string;
  pgRestore: string;
  psql: string;
}

const DIGEST = /^[0-9a-f]{64}$/;

/** Select the pinned CLI's bundle and prefer its checksum-addressed extraction. */
export function resolveNativePostgresTools(homeDirectory = os.homedir()): NativePostgresTools {
  const cache = path.join(homeDirectory, ".supabase", "cache", "stack", "slim-services", "postgres");
  const platform = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "x64" ? "amd64" : "arm64"}`;
  const archives = fs.readdirSync(cache, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.name !== PINNED_SUPABASE_POSTGRES_BUNDLE) return [];
    const directory = path.join(cache, entry.name, platform);
    if (!fs.existsSync(directory)) return [];
    const addressed = fs.readdirSync(directory, { withFileTypes: true })
      .filter((child) => child.isDirectory() && DIGEST.test(child.name));
    if (addressed.length) return addressed.map((child) => ({
      bundle: `${entry.name}+${child.name}`, directory: path.join(directory, child.name),
    }));
    return fs.existsSync(path.join(directory, "bin", "psql")) ? [{ bundle: entry.name, directory }] : [];
  });
  if (archives.length !== 1) throw new Error(`The native runtime must provide exactly one PostgreSQL client (found ${archives.length} archives)`);
  const archive = archives[0];
  const binary = (name: string) => {
    const file = path.join(archive.directory, "bin", name);
    fs.accessSync(file, fs.constants.X_OK);
    return file;
  };
  return { bundle: archive.bundle, pgDump: binary("pg_dump"), pgRestore: binary("pg_restore"), psql: binary("psql") };
}
