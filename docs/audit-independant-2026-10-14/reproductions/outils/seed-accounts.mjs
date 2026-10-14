// Audit 2026-10-14 : comptes de test sur la pile Supabase LOCALE (loopback) uniquement.
// Les mots de passe sont générés ici et écrits dans secrets/accounts.json ; rien n'est affiché.
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const audit = path.resolve(process.argv[2]);
const repo = path.join(audit, "snapshot/handoff-audit-independant/annexes/repository");
const require = createRequire(path.join(repo, "package.json"));
const { createClient } = require("@supabase/supabase-js");

const env = Object.fromEntries(
  fs.readFileSync(path.join(audit, "secrets/local-stack.env"), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(env.API_URL)) throw new Error("API_URL must be loopback");

const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const people = [
  { key: "adminA", email: "admin.a@audit.test", name: "Audit Admin A", tenant: "A", role: "admin" },
  { key: "engA", email: "chiffreur.a@audit.test", name: "Audit Chiffreur A", tenant: "A", role: "engineer" },
  { key: "viewerA", email: "lecteur.a@audit.test", name: "Audit Lecteur A", tenant: "A", role: "viewer" },
  { key: "dirA", email: "direction.a@audit.test", name: "Audit Direction A", tenant: "A", role: "director" },
  { key: "adminB", email: "admin.b@audit.test", name: "Audit Admin B", tenant: "B", role: "admin" },
];
const accounts = {};
for (const p of people) {
  const password = crypto.randomBytes(18).toString("base64url");
  const anon = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signUp({ email: p.email, password, options: { data: { full_name: p.name } } });
  if (error) throw new Error(`signup ${p.key}: ${error.message}`);
  const { data: m, error: me } = await admin.from("tenant_memberships").select("tenant_id").eq("user_id", data.user.id).single();
  if (me) throw new Error(`membership ${p.key}: ${me.message}`);
  accounts[p.key] = { ...p, password, userId: data.user.id, personalTenantId: m.tenant_id };
}
const tenantA = accounts.adminA.personalTenantId;
const tenantB = accounts.adminB.personalTenantId;
await admin.from("tenants").update({ name: "Audit Entreprise A" }).eq("id", tenantA);
await admin.from("tenants").update({ name: "Audit Entreprise B" }).eq("id", tenantB);
for (const key of ["engA", "viewerA", "dirA"]) {
  const a = accounts[key];
  let r = await admin.from("tenant_memberships").update({ is_default: false }).eq("user_id", a.userId);
  if (r.error) throw new Error(`undefault ${key}: ${r.error.message}`);
  r = await admin.from("tenant_memberships").insert({ tenant_id: tenantA, user_id: a.userId, role: a.role, is_default: true });
  if (r.error) throw new Error(`insert ${key}: ${r.error.message}`);
}
fs.writeFileSync(path.join(audit, "secrets/accounts.json"), JSON.stringify({ tenantA, tenantB, accounts }, null, 2));
const { data: check } = await admin.from("tenant_memberships").select("tenant_id, role, is_default, user_id");
console.log(
  check.map((c) => {
    const who = Object.values(accounts).find((a) => a.userId === c.user_id)?.key;
    return `${who} ${c.tenant_id === tenantA ? "A" : c.tenant_id === tenantB ? "B" : "perso"} ${c.role}${c.is_default ? " (défaut)" : ""}`;
  }).join("\n")
);
