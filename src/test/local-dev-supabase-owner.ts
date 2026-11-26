import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const registryIdPattern = /^[a-f0-9]{64}$/;
export const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");
export const entry = (file: string) => fs.lstatSync(file, { throwIfNoEntry: false });

export interface OwnerRecord {
  projectId: string;
  ports: Record<number, number>;
  configHash: string;
  registryId?: string;
  pendingRegistryId?: string;
  applied?: Record<string, string>;
}

export function privateDirectory(directory: string) {
  const stat = entry(directory);
  if (!stat?.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) {
    throw new Error(`Expected an owned directory with mode 0700 at ${directory}.`);
  }
}

export function readFile(file: string, privateFile = false) {
  const stat = entry(file);
  if (!stat?.isFile() || (privateFile && (stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600))) {
    throw new Error(`Expected a regular${privateFile ? ", owned, mode-0600" : ""} file at ${file}.`);
  }
  return fs.readFileSync(file, "utf8");
}

export function readPrivateJson<T>(file: string): T {
  try {
    return JSON.parse(readFile(file, true)) as T;
  } catch {
    throw new Error(`Expected valid JSON in an owned mode-0600 file at ${file}.`);
  }
}

export function readOwner(file: string): OwnerRecord {
  const owner = readPrivateJson<OwnerRecord>(file);
  if (!owner || !/^mergeone-dev-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner.projectId) ||
    !/^[a-f0-9]{64}$/.test(owner.configHash) ||
    !owner.ports || !Object.hasOwn(owner.ports, 54321) ||
    Object.values(owner.ports).some((port) => !Number.isInteger(port) || port < 1024 || port > 65535) ||
    [owner.registryId, owner.pendingRegistryId].some((id) => id !== undefined && !registryIdPattern.test(id))) {
    throw new Error("Cannot establish the persistent Supabase stack identity from its owner record.");
  }
  return owner;
}

export function localDevStackDirectory(home: string) {
  return path.join(home, ".supabase", "mergeone-dev");
}

/** The pinned CLI hashes the canonical root, branch context and stack name. */
export function localDevStackRegistryId(project: string) {
  const digest = createHash("sha256");
  for (const field of [project, "ordinary-workspace", "default"]) {
    const bytes = Buffer.from(field, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    digest.update(length).update(bytes);
  }
  return digest.digest("hex");
}

/** Only a verified native host of the one private development project is exempt. */
export function isLocalDevStackHost(project: string, registryId: string, home: string) {
  try {
    const base = localDevStackDirectory(fs.realpathSync(home));
    const active = path.join(base, "active");
    if (path.dirname(project) !== active || fs.realpathSync(base) !== base) return false;
    privateDirectory(base);
    privateDirectory(active);
    const owner = readOwner(path.join(active, "owner.json"));
    if (project !== path.join(active, owner.projectId) || registryId !== (owner.registryId ?? owner.pendingRegistryId)) return false;
    privateDirectory(project);
    const supabase = path.join(project, "supabase");
    privateDirectory(supabase);
    return sha256(readFile(path.join(supabase, "config.toml"), true)) === owner.configHash;
  } catch {
    // Missing or unreadable ownership evidence leaves the host counted.
    return false;
  }
}
