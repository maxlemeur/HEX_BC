import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const defaultSettingsFile = {
  local: ".env.supabase.local",
  production: ".env.local",
  "production-full": ".env.supabase.production.local",
};
const developmentFiles = [".env.development.local", ".env.local", ".env.development", ".env"];
const productionFiles = [defaultSettingsFile.production, ".env"];
const modes = Object.keys(defaultSettingsFile);

function readConfig(file) {
  try {
    return parseEnv(readFileSync(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error(`Could not read Supabase settings from ${file}.`, { cause: error });
  }
}

function hasPublicSettings(config) {
  return config?.NEXT_PUBLIC_SUPABASE_URL !== undefined || config?.NEXT_PUBLIC_SUPABASE_ANON_KEY !== undefined;
}

export function isLoopback(host) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host?.toLowerCase());
}

export function parseDevArguments(args) {
  const modeArgs = args.filter((arg) => arg === "--supabase" || arg.startsWith("--supabase="));
  const mode = modeArgs[0]?.slice("--supabase=".length) ?? "local";
  if (modeArgs.length > 1 || !modes.includes(mode)) {
    throw new Error("Select one Supabase target with --supabase=local, --supabase=production or --supabase=production-full.");
  }
  const forwarded = args.filter((arg) => !modeArgs.includes(arg));
  const hostnames = forwarded.flatMap((arg, index) => {
    if (arg === "--hostname" || arg === "-H") return [forwarded[index + 1]];
    if (arg.startsWith("--hostname=")) return [arg.slice("--hostname=".length)];
    if (arg.startsWith("-H") && arg.length > 2) return [arg.slice(2).replace(/^=/, "")];
    return [];
  });
  return { mode, forwarded, hostnames };
}

function readSupabaseSettings(mode, environment) {
  if (mode === "production-full") {
    return readConfig(defaultSettingsFile[mode]) ?? {};
  }
  if (mode === "local") {
    if (environment.E2E_ARMY === "1") return environment;
    const dedicated = readConfig(defaultSettingsFile[mode]);
    if (dedicated) return dedicated;
    if (hasPublicSettings(environment)) return environment;
  }
  // Keep the project URL and key from the same source. Production uses the
  // existing shared .env.local independently of a .env.development.local override.
  const files = mode === "local" ? developmentFiles : productionFiles;
  for (const file of files) {
    const config = readConfig(file);
    if (hasPublicSettings(config)) return config;
  }
  return environment;
}

export function warnIfDirectNextLoadsServiceKey() {
  for (const file of productionFiles) {
    let config;
    try {
      config = readConfig(file);
    } catch {
      // This advisory check must not block a launch using another file.
      continue;
    }
    if (!config?.SUPABASE_SERVICE_ROLE_KEY?.trim()) continue;
    const url = URL.parse(config.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "");
    if (url && ["http:", "https:"].includes(url.protocol) && !isLoopback(url.hostname)) {
      console.warn(`Direct next dev would hold production's service rights from ${file}. Move the full configuration to ${defaultSettingsFile["production-full"]}.`);
      return;
    }
  }
}

function isPrivilegedKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  const [, payload, signature] = key.split(".");
  if (!payload || !signature) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role === "service_role";
  } catch {
    return false;
  }
}

export function supabaseDevEnvironment(mode, hostnames, environment) {
  const hosted = mode !== "local";
  if (hosted && (environment.E2E_ARMY === "1" || hostnames.some((host) => !isLoopback(host)))) {
    throw new Error("Production Supabase is available only in a loopback development server outside TesterArmy.");
  }
  const config = readSupabaseSettings(mode, environment);
  const url = config.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = config.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const service = config.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !key) {
    throw new Error(`Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY together in ${defaultSettingsFile[mode]}.`);
  }
  let backend;
  try {
    backend = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid Supabase origin.");
  }
  if (backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash ||
    (backend.protocol !== "http:" && backend.protocol !== "https:")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid Supabase origin.");
  }
  if (mode === "local" && !isLoopback(backend.hostname)) {
    throw new Error(`Local Supabase requires a loopback URL. Set ${defaultSettingsFile.local} or explicitly select --supabase=production.`);
  }
  if (hosted && (isLoopback(backend.hostname) || backend.protocol !== "https:")) {
    throw new Error("Production Supabase requires a hosted HTTPS URL.");
  }
  if (isPrivilegedKey(key) || key === service) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY must be a public Supabase key.");
  }
  if (mode === "production-full" && !service) {
    throw new Error(`Set SUPABASE_SERVICE_ROLE_KEY in ${defaultSettingsFile[mode]}.`);
  }
  return {
    MERGEONE_DEV_SUPABASE_TARGET: mode,
    NEXT_PUBLIC_SUPABASE_URL: backend.origin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
    // An empty value prevents Next from filling in a service key from the other target.
    SUPABASE_SERVICE_ROLE_KEY: mode === "production" ? "" : service,
    ...(mode === "production" ? { MERGEONE_CHATGPT_LOCAL: "0" } : {}),
    ...(mode === "production-full" ? { MERGEONE_CHATGPT_LOCAL: "1" } : {}),
  };
}
