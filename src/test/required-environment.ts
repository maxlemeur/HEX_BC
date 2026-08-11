type Environment = Readonly<Record<string, string | undefined>>;

export const CRITICAL_E2E_ENVIRONMENT_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "E2E_LOGIN_EMAIL",
  "E2E_LOGIN_PASSWORD",
  "E2E_ALLOWED_SUPABASE_HOST",
] as const;

function parseRequiredUrl(name: string, value: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Invalid URL in required environment variable: ${name}`);
  }
}

export function requireEnvironmentValue(
  name: string,
  environment: Environment = process.env
) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function requireE2ELoginCredentials(
  environment: Environment = process.env
) {
  return {
    email: requireEnvironmentValue("E2E_LOGIN_EMAIL", environment),
    password: requireEnvironmentValue("E2E_LOGIN_PASSWORD", environment),
  };
}

export function requireCriticalE2EEnvironment(
  environment: Environment = process.env
) {
  const missing = CRITICAL_E2E_ENVIRONMENT_NAMES.filter(
    (name) => !environment[name]?.trim()
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  const supabaseUrl = parseRequiredUrl(
    "NEXT_PUBLIC_SUPABASE_URL",
    environment.NEXT_PUBLIC_SUPABASE_URL!.trim()
  );
  const allowedHost = environment.E2E_ALLOWED_SUPABASE_HOST!.trim().toLowerCase();

  if (supabaseUrl.hostname.toLowerCase() !== allowedHost) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL does not target the allowlisted critical E2E host"
    );
  }

  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(
    supabaseUrl.hostname.toLowerCase()
  );
  if (!isLoopback && supabaseUrl.protocol !== "https:") {
    throw new Error("Remote critical E2E Supabase URLs must use HTTPS");
  }
  if (
    supabaseUrl.username ||
    supabaseUrl.password ||
    supabaseUrl.search ||
    supabaseUrl.hash ||
    supabaseUrl.pathname !== "/" ||
    (!isLoopback && supabaseUrl.port)
  ) {
    throw new Error(
      "Critical E2E Supabase URLs must be a bare allowlisted origin"
    );
  }
}
