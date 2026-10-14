// Audit 2026-10-14 : récupère les PDF de devis de la pile LOCALE et en extrait le texte.
// Usage : node pdf-text.mjs <dossier audit> <bucket> [préfixe]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const audit = path.resolve(process.argv[2]);
const bucket = process.argv[3] ?? "estimate-documents";
const prefix = process.argv[4] ?? "";
const repo = path.join(audit, "snapshot/handoff-audit-independant/annexes/repository");
const require = createRequire(path.join(repo, "package.json"));
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(
  fs.readFileSync(path.join(audit, "secrets/local-stack.env"), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(env.API_URL)) throw new Error("API_URL must be loopback");
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function walk(dir) {
  const { data, error } = await admin.storage.from(bucket).list(dir, { limit: 1000 });
  if (error) throw error;
  const files = [];
  for (const entry of data) {
    const full = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.id === null) files.push(...(await walk(full)));
    else files.push({ path: full, updated: entry.updated_at, size: entry.metadata?.size });
  }
  return files;
}

const pdfjs = await import(
  "file:///" + path.join(repo, "node_modules/pdfjs-dist/legacy/build/pdf.mjs").split(path.sep).join("/")
);
const files = (await walk(prefix)).filter((f) => f.path.endsWith(".pdf"));
const outDir = path.join(audit, "out/pdf");
fs.mkdirSync(outDir, { recursive: true });
for (const f of files) {
  const { data, error } = await admin.storage.from(bucket).download(f.path);
  if (error) throw error;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    text += `\n--- page ${p} ---\n` + content.items.map((i) => i.str).join(" ");
  }
  const name = f.path.replace(/[\\/]/g, "_");
  fs.writeFileSync(path.join(outDir, name + ".txt"), text);
  console.log(`${f.path} (${f.size} o, ${doc.numPages} p) -> out/pdf/${name}.txt`);
}
