import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function sanitizeCoverageEvidence(directory) {
  const walk = async (folder) => {
    const entries = await readdir(folder, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error("Coverage artifacts must not contain symlinks.");
      const file = path.join(folder, entry.name);
      if (entry.isDirectory() && entry.name !== "runs") files.push(...await walk(file));
      else if (entry.isFile() && /\.(json|jsonl|log|txt|md|xml|ts|tsx|js|cjs|mjs|sql|diff)$/.test(entry.name)) files.push(file);
    }
    return files;
  };
  const files = await walk(directory);
  const secrets = Object.entries(process.env)
    .filter(([key, value]) => value && (/^(SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY)$/.test(key) || /^E2E_.*(PASSWORD|EMAIL)$/.test(key)))
    .flatMap(([, value]) => [value, encodeURIComponent(value)]);
  const sessions = new Set();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/(?:draftLockSessionId|session_id|sessionId)(?:\\*["'])?\s*:\s*(?:\\*["'])?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi)) sessions.add(match[1]);
  }
  for (const file of files) {
    let text = await readFile(file, "utf8");
    for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
    for (const session of sessions) text = text.replaceAll(session, "[REDACTED-LOCK-SESSION]");
    text = text
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED-JWT]")
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/([?&](?:password|access_token|refresh_token|token|code|apikey|api_key)=)[^&\s"']*/gi, "$1[REDACTED]");
    if (file.endsWith(".json")) JSON.parse(text);
    await writeFile(file, text);
  }
  return { textFiles: files.length, sessionValuesRemoved: sessions.size, valuesRetained: false, appliedBeforeArtifactHashes: true };
}
