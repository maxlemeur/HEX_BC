import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantContext = vi.hoisted(() => ({
  readAuthenticatedUser: vi.fn(),
  readActiveTenantMembership: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => tenantContext);

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/imports/tabular-pdf-extraction", () => ({
  extractTabularPdfTablesFromFile: vi.fn(),
}));

import {
  ImportsApiError,
  badRequest as importsBadRequest,
  listUserImports,
  toErrorResponse as importsToErrorResponse,
} from "@/lib/imports/server";
import {
  MappingsApiError,
  badRequest as mappingsBadRequest,
  listMappings,
  toErrorResponse as mappingsToErrorResponse,
} from "@/lib/mappings/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const domains = [
  {
    name: "imports",
    ErrorClass: ImportsApiError,
    errorName: "ImportsApiError",
    badRequest: importsBadRequest,
    toErrorResponse: importsToErrorResponse,
    trigger: () => listUserImports(),
  },
  {
    name: "mappings",
    ErrorClass: MappingsApiError,
    errorName: "MappingsApiError",
    badRequest: mappingsBadRequest,
    toErrorResponse: mappingsToErrorResponse,
    trigger: () => listMappings({ limit: 10 }),
  },
] as const;

function errorShape(error: unknown) {
  const value = error as { name: string; status: number; code: string; message: string; details?: unknown };
  return {
    name: value.name,
    status: value.status,
    code: value.code,
    message: value.message,
    details: value.details,
  };
}

function signedIn() {
  tenantContext.readAuthenticatedUser.mockResolvedValue({
    supabase: {},
    user: { id: USER_ID },
    error: null,
  });
}

describe.each(domains)("the $name error kit", (domain) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("builds a bad request with its defaults and with an explicit code", () => {
    const plain = domain.badRequest("Champ invalide.");
    expect(plain).toBeInstanceOf(domain.ErrorClass);
    expect(errorShape(plain)).toEqual({
      name: domain.errorName,
      status: 400,
      code: "BAD_REQUEST",
      message: "Champ invalide.",
      details: undefined,
    });

    const detailed = domain.badRequest("Champ invalide.", { field: "rows" }, "CUSTOM_CODE");
    expect(errorShape(detailed)).toEqual({
      name: domain.errorName,
      status: 400,
      code: "CUSTOM_CODE",
      message: "Champ invalide.",
      details: { field: "rows" },
    });
  });

  it("refuses a missing user with the default unauthorized error", async () => {
    tenantContext.readAuthenticatedUser.mockResolvedValue({ supabase: {}, user: null, error: null });

    const error = await domain.trigger().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(domain.ErrorClass);
    expect(errorShape(error)).toEqual({
      name: domain.errorName,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
      details: undefined,
    });
    expect(Object.keys(error as object)).toContain("details");

    const response = domain.toErrorResponse(error);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Unauthorized" },
    });
  });

  it("refuses a user without an active tenant with a forbidden error", async () => {
    signedIn();
    tenantContext.readActiveTenantMembership.mockResolvedValue({ membership: null, error: null });

    const error = await domain.trigger().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(domain.ErrorClass);
    expect(errorShape(error)).toEqual({
      name: domain.errorName,
      status: 403,
      code: "FORBIDDEN",
      message: "Aucun tenant actif pour cet utilisateur.",
      details: undefined,
    });

    const response = domain.toErrorResponse(error);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Aucun tenant actif pour cet utilisateur." },
    });
  });

  it.each([
    { pgCode: "42501", status: 403, code: "FORBIDDEN", message: "Accès refusé." },
    { pgCode: "PGRST116", status: 404, code: "NOT_FOUND", message: "Ressource introuvable." },
    { pgCode: "23505", status: 409, code: "CONFLICT", message: "Conflit de données." },
    { pgCode: "XX000", status: 400, code: "BAD_REQUEST", message: "Impossible de charger le tenant courant." },
  ])("maps a PostgREST $pgCode error to $status $code", async ({ pgCode, status, code, message }) => {
    signedIn();
    const postgrestError = { code: pgCode, message: "database said no", details: "raw", hint: null };
    tenantContext.readActiveTenantMembership.mockResolvedValue({ membership: null, error: postgrestError });

    const error = await domain.trigger().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(domain.ErrorClass);
    expect(errorShape(error)).toEqual({
      name: domain.errorName,
      status,
      code,
      message,
      details: postgrestError,
    });

    const response = domain.toErrorResponse(error);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error: { code, message } });
  });

  it("answers an unexpected error with the default internal error", async () => {
    const response = domain.toErrorResponse(new Error("boom"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Une erreur interne est survenue." },
    });
  });
});

describe("the imports error responses", () => {
  it("carry the no-store headers on errors", () => {
    const response = importsToErrorResponse(importsBadRequest("Champ invalide."));

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache, no-store, must-revalidate, max-age=0");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Expires")).toBe("0");
  });
});
