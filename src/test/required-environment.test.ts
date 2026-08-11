import { describe, expect, it } from "vitest";

import {
  requireCriticalE2EEnvironment,
  requireE2ELoginCredentials,
  requireEnvironmentValue,
} from "@/test/required-environment";

describe("required environment values", () => {
  it("returns a trimmed value supplied by the environment", () => {
    expect(requireEnvironmentValue("TOKEN", { TOKEN: "  configured  " })).toBe(
      "configured"
    );
  });

  it("fails closed when a required value is absent or blank", () => {
    expect(() => requireEnvironmentValue("TOKEN", {})).toThrow(
      "Missing required environment variable: TOKEN"
    );
    expect(() => requireEnvironmentValue("TOKEN", { TOKEN: "   " })).toThrow(
      "Missing required environment variable: TOKEN"
    );
  });

  it("requires both E2E login values without a fallback", () => {
    expect(() =>
      requireE2ELoginCredentials({ E2E_LOGIN_PASSWORD: "configured" })
    ).toThrow("Missing required environment variable: E2E_LOGIN_EMAIL");
    expect(() =>
      requireE2ELoginCredentials({ E2E_LOGIN_EMAIL: "tester@example.test" })
    ).toThrow("Missing required environment variable: E2E_LOGIN_PASSWORD");
    expect(() =>
      requireE2ELoginCredentials({
        E2E_LOGIN_EMAIL: "tester@example.test",
        E2E_LOGIN_PASSWORD: "   ",
      })
    ).toThrow("Missing required environment variable: E2E_LOGIN_PASSWORD");

    expect(
      requireE2ELoginCredentials({
        E2E_LOGIN_EMAIL: " tester@example.test ",
        E2E_LOGIN_PASSWORD: " local-secret ",
      })
    ).toEqual({
      email: "tester@example.test",
      password: "local-secret",
    });
  });

  it("validates the complete critical Playwright environment without exposing values", () => {
    const configuredEnvironment = {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-value",
      E2E_LOGIN_EMAIL: "tester@example.test",
      E2E_LOGIN_PASSWORD: "sensitive-test-value",
      E2E_ALLOWED_SUPABASE_HOST: "example.test",
    };

    expect(() =>
      requireCriticalE2EEnvironment(configuredEnvironment)
    ).not.toThrow();

    let errorMessage = "";
    try {
      requireCriticalE2EEnvironment({
        ...configuredEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: " ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
        E2E_LOGIN_EMAIL: " ",
        E2E_LOGIN_PASSWORD: "",
        E2E_ALLOWED_SUPABASE_HOST: "",
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(errorMessage).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(errorMessage).toContain("E2E_LOGIN_EMAIL");
    expect(errorMessage).toContain("E2E_LOGIN_PASSWORD");
    expect(errorMessage).toContain("E2E_ALLOWED_SUPABASE_HOST");
    expect(errorMessage).not.toContain("public-test-value");
    expect(errorMessage).not.toContain("sensitive-test-value");
  });

  it("rejects malformed, non-HTTPS, and non-allowlisted remote Supabase URLs", () => {
    const configuredEnvironment = {
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-value",
      E2E_LOGIN_EMAIL: "tester@example.test",
      E2E_LOGIN_PASSWORD: "sensitive-test-value",
      E2E_ALLOWED_SUPABASE_HOST: "staging-project.supabase.co",
    };

    expect(() =>
      requireCriticalE2EEnvironment({
        ...configuredEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      })
    ).toThrow("Invalid URL in required environment variable");

    expect(() =>
      requireCriticalE2EEnvironment({
        ...configuredEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: "https://production-project.supabase.co",
      })
    ).toThrow("does not target the allowlisted critical E2E host");

    expect(() =>
      requireCriticalE2EEnvironment({
        ...configuredEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: "http://staging-project.supabase.co",
      })
    ).toThrow("must use HTTPS");

    for (const url of [
      "https://user@staging-project.supabase.co",
      "https://staging-project.supabase.co/auth/v1",
      "https://staging-project.supabase.co?redirect=remote",
      "https://staging-project.supabase.co:8443",
    ]) {
      expect(() =>
        requireCriticalE2EEnvironment({
          ...configuredEnvironment,
          NEXT_PUBLIC_SUPABASE_URL: url,
        })
      ).toThrow("must be a bare allowlisted origin");
    }

    expect(() =>
      requireCriticalE2EEnvironment({
        ...configuredEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        E2E_ALLOWED_SUPABASE_HOST: "127.0.0.1",
      })
    ).not.toThrow();
  });
});
