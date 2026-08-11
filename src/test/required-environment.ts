type Environment = Readonly<Record<string, string | undefined>>;

export const CRITICAL_E2E_ENVIRONMENT_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "E2E_LOGIN_EMAIL",
  "E2E_LOGIN_PASSWORD",
] as const;

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
}
