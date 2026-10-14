// Exact current function contracts folded by signature and migration order.
// Pure parser: importing this module performs no filesystem or database IO.
import { requireValue } from "./local-recipe-common.mjs";

export function parseFunctionDeclarations(source, { select = () => true } = {}) {
  requireValue(typeof source?.name === "string" && typeof source.sql === "string", "SQL declaration source is invalid.");
  const sql = source.sql.replaceAll("\r\n", "\n"), definitions = [];
  const declarations = [...sql.matchAll(/create (or replace )?function (public|private)\.([a-z_]+)\(([\s\S]*?)\)\s*returns\b([\s\S]*?)as \$\$([\s\S]*?)\$\$;/gi)];
  for (const match of declarations) {
    const [, replace, schema, name, args, header, body] = match;
    if (!select({ schema, name })) continue;
    const types = args.trim() ? args.split(",").map((arg) => {
      const value = arg.trim().match(/^[a-z_][a-z0-9_]*\s+([a-z_.]+(?:\[\])?)(?:\s+default\b[\s\S]*)?$/i)?.[1];
      requireValue(value, "SQL argument declaration cannot be qualified."); return value;
    }) : [];
    const signature = `${schema}.${name}(${types.join(",")})`;
    const grants = [...sql.matchAll(/grant execute on function ([\s\S]*?) to (authenticated|service_role);/gi)]
      .filter((entry) => entry[1].replaceAll(/\s/g, "").split(/,(?=(?:public|private)\.)/).includes(signature)).map((entry) => entry[2]);
    const config = [...header.matchAll(/set\s+([a-z_]+)\s*=\s*'([^']*)'/gi)].map((entry) => `${entry[1]}=${entry[2] || '""'}`);
    requireValue(config.includes('search_path=""'), "SQL declaration search_path is not explicit.");
    const language = header.match(/language\s+([a-z]+)/i)?.[1];
    requireValue(language, "SQL declaration language is missing.");
    definitions.push({ schema, name, signature, body: body.trim(), replace: Boolean(replace), source: source.name,
      definer: /security definer/i.test(header), config, language,
      volatility: /\bimmutable\b/i.test(header) ? "i" : /\bstable\b/i.test(header) ? "s" : "v",
      authenticated: grants.includes("authenticated"), service: grants.includes("service_role") });
  }
  requireValue(new Set(definitions.map((entry) => entry.signature)).size === definitions.length, "SQL source repeats a function signature.");
  return definitions;
}

export function foldFunctionDeclarations(sources, { select = () => true } = {}) {
  requireValue(Array.isArray(sources) && sources.length > 0 && new Set(sources.map((row) => row.name)).size === sources.length, "SQL declaration sources are empty or duplicated.");
  const ordered = [...sources].sort((left, right) => left.name.localeCompare(right.name)), current = new Map();
  for (const source of ordered) {
    for (const row of parseFunctionDeclarations(source, { select })) {
      requireValue(!current.has(row.signature) || row.replace, "A bare CREATE collides with an existing function signature.");
      current.set(row.signature, row);
    }
  }
  const functions = [...current.values()].sort((left, right) => left.signature.localeCompare(right.signature));
  requireValue(functions.length > 0, "SQL declaration inventory is empty.");
  const used = new Set(functions.map((row) => row.source));
  return { functions, sources: ordered.filter((row) => used.has(row.name)).map(({ name }) => name) };
}
