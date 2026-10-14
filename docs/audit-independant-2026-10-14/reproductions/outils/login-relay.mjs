// Relais de connexion local (audit 2026-10-14) : ouvre une session Supabase LOCALE pour un compte
// de test et pose le cookie de session sur 127.0.0.1, sans exposer le mot de passe.
// Usage : node login-relay.mjs <dossier audit>  →  http://127.0.0.1:3299/login/<clé>?next=/dashboard
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const audit = path.resolve(process.argv[2]);
const repo = path.join(audit, "snapshot/handoff-audit-independant/annexes/repository");
const require = createRequire(path.join(repo, "package.json"));
const { createServerClient } = require("@supabase/ssr");

const env = Object.fromEntries(
  fs.readFileSync(path.join(audit, "secrets/local-stack.env"), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(env.API_URL)) throw new Error("API_URL must be loopback");
const { accounts } = JSON.parse(fs.readFileSync(path.join(audit, "secrets/accounts.json"), "utf8"));

function serialize(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:3299");
  const next = url.searchParams.get("next") || "/dashboard";
  const target = `http://127.0.0.1:3210${next.startsWith("/") ? next : "/dashboard"}`;
  const incoming = Object.fromEntries(
    (req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf("=")), decodeURIComponent(c.slice(c.indexOf("=") + 1))])
  );
  const outgoing = [];
  const client = createServerClient(env.API_URL, env.ANON_KEY, {
    cookies: {
      getAll: () => Object.entries(incoming).map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value, options }) => outgoing.push(serialize(name, value, options))),
    },
  });
  try {
    if (url.pathname.startsWith("/login/")) {
      const account = accounts[url.pathname.slice("/login/".length)];
      if (!account) throw new Error("unknown account key");
      await client.auth.signOut().catch(() => {});
      const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
      if (error) throw new Error(error.message);
    } else if (url.pathname === "/logout") {
      await client.auth.signOut();
      for (const name of Object.keys(incoming)) if (name.startsWith("sb-")) outgoing.push(`${name}=; Path=/; Max-Age=0`);
    } else {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(302, { Location: target, "Set-Cookie": outgoing }).end();
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(`relay error: ${e.message}`);
  }
}).listen(3299, "127.0.0.1", () => console.log("login relay on http://127.0.0.1:3299"));
