// Lecture service-role sur la pile LOCALE : node sql-read.mjs <audit> <table> [colonnes] [filtre col=val]
import { createRequire } from "node:module"; import fs from "node:fs"; import path from "node:path";
const audit = path.resolve(process.argv[2]); const repo = path.join(audit, "snapshot/handoff-audit-independant/annexes/repository");
const require = createRequire(path.join(repo, "package.json")); const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(audit, "secrets/local-stack.env"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(env.API_URL)) throw new Error("loopback only");
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let q = admin.from(process.argv[3]).select(process.argv[4] ?? "*").limit(20);
if (process.argv[5]) { const [c, v] = process.argv[5].split("="); q = q.eq(c, v); }
const { data, error } = await q; console.log(JSON.stringify(error ?? data, null, 1).slice(0, 4000));
