import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { unzipSync } from "fflate";

// Offline publication guard. This checks known private paths and high-confidence
// credential signatures, including Office ZIP members. It does not certify that
// arbitrary prose, images or compressed PDFs contain no personal/business data.
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_MEMBER_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_MEMBERS = 4_000;
const SIGNATURES = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
  /\b(?:sk_live_|sk-proj-|sb_secret_)[A-Za-z0-9_-]{24,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bAIza[A-Za-z0-9_-]{35}\b/,
];

function privatePath(name) {
  if (name === ".github/backup-recipient.pem") return false;
  const segments = name.split("/");
  const basename = segments.at(-1);
  return (
    segments.includes(".private") || segments.includes(".auth") || basename === ".auth.json" ||
    basename === "CLAUDE.local.md" || basename === "settings.local.json" ||
    (basename.startsWith(".env") && basename !== ".env.example") ||
    /\.(?:pem|key)$/i.test(basename) ||
    (name.startsWith("docs/prd_file/") && name !== "docs/prd_file/README.md") ||
    (name.startsWith("docs/handoff-prestataire-2026-10-14/") &&
      name !== "docs/handoff-prestataire-2026-10-14/LISEZ-MOI.md") ||
    /\.(?:zip|7z|rar|tgz|tar(?:\.gz)?|xlsm)$/i.test(basename)
  );
}

function hasCredential(bytes) {
  const text = Buffer.from(bytes).toString("utf8");
  if (SIGNATURES.some((signature) => signature.test(text))) return true;
  // A legacy Supabase service-role JWT is privileged; anon JWTs are public keys.
  for (const token of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g)) {
    try {
      if (JSON.parse(Buffer.from(token[1], "base64url").toString("utf8")).role === "service_role") return true;
    } catch { /* A non-JWT string does not establish a credential. */ }
  }
  return false;
}

function checkBytes(bytes, name, errors) {
  if (name === ".github/backup-recipient.pem") {
    const certificate = Buffer.from(bytes).toString("utf8");
    if (!/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/.test(certificate)) {
      errors.push(`${name}: expected one public X.509 certificate`);
    } else {
      try { new X509Certificate(certificate); }
      catch { errors.push(`${name}: invalid X.509 certificate`); }
    }
  }
  if (hasCredential(bytes)) errors.push(`${name}: credential signature (value withheld)`);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return;
  let total = 0;
  let members = 0;
  const names = new Set();
  try {
    const unpacked = unzipSync(bytes, { filter(member) {
      if (names.has(member.name)) {
        errors.push(`${name}: duplicate archive member (name withheld)`);
        throw new Error("duplicate archive member");
      }
      names.add(member.name);
      members += 1;
      total += member.originalSize;
      if (member.originalSize > MAX_MEMBER_BYTES || total > MAX_ARCHIVE_BYTES || members > MAX_ARCHIVE_MEMBERS) {
        throw new Error("archive limit");
      }
      return true;
    } });
    for (const [member, content] of Object.entries(unpacked)) {
      if (privatePath(member)) errors.push(`${name}!${member}: private archive member`);
      if (hasCredential(content)) errors.push(`${name}!${member}: credential signature (value withheld)`);
      if (content[0] === 0x50 && content[1] === 0x4b) {
        errors.push(`${name}!${member}: nested archive requires explicit review`);
      }
    }
  } catch {
    errors.push(`${name}: invalid archive or archive limit exceeded`);
  }
}

try {
  const root = process.cwd();
  const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).split("\0").filter(Boolean);
  const errors = [];
  let checked = 0;
  for (const name of [...new Set(names)].sort()) {
    const file = path.join(root, name);
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (error) {
      if (error.code === "ENOENT") continue; // A local removal awaiting staging.
      throw error;
    }
    if (privatePath(name)) { errors.push(`${name}: private path or unapproved archive`); continue; }
    if (stat.isSymbolicLink()) { errors.push(`${name}: symbolic link requires explicit review`); continue; }
    if (!stat.isFile()) { errors.push(`${name}: unsupported Git entry`); continue; }
    if (stat.size > MAX_FILE_BYTES) { errors.push(`${name}: file limit exceeded`); continue; }
    checkBytes(fs.readFileSync(file), name, errors);
    checked += 1;
  }
  if (errors.length) {
    console.error(`Repository hygiene failed (${errors.length} findings; no values printed):\n${errors.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`Repository hygiene passed (${checked} public files; ignored private originals excluded).`);
  }
} catch {
  console.error("Repository hygiene failed: unable to inspect the Git working tree (details withheld).");
  process.exitCode = 1;
}
