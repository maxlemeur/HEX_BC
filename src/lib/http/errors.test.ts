import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ApiError,
  badRequest,
  mapSupabaseError as mapEstimatesSupabaseError,
  toErrorResponse as toEstimatesErrorResponse,
} from "@/lib/estimates/errors";
import {
  buildErrorResponseBody,
  isPostgrestErrorLike,
  shouldExposeErrorDetails,
  toErrorResponse,
} from "@/lib/http/errors";
import {
  MembershipsApiError,
  mapSupabaseError as mapMembershipsSupabaseError,
  toErrorResponse as toMembershipsErrorResponse,
} from "@/lib/memberships/errors";

const POSTGREST_LEAK = {
  code: "42501",
  message: "permission denied for table tenant_memberships",
  details: "Key (tenant_id)=(secret-tenant-id) is still referenced",
  hint: "Check RLS policy on public.tenant_memberships",
};

function parseZodError(schema: z.ZodType, value: unknown) {
  try {
    schema.parse(value);
  } catch (error) {
    return error;
  }

  throw new Error("expected ZodError");
}

describe("shouldExposeErrorDetails", () => {
  it("allows structured Zod issues", () => {
    expect(
      shouldExposeErrorDetails({
        issues: [{ path: "tenant_id", message: "Invalid uuid", code: "invalid_string" }],
      })
    ).toBe(true);
  });

  it("redacts Postgrest/Supabase payloads and internal errors", () => {
    expect(isPostgrestErrorLike(POSTGREST_LEAK)).toBe(true);
    expect(shouldExposeErrorDetails(POSTGREST_LEAK)).toBe(false);
    expect(
      shouldExposeErrorDetails(
        { reason: "safe" },
        { code: "INTERNAL_ERROR", status: 500 }
      )
    ).toBe(false);
  });

  it("allows a safe public object intended for the client", () => {
    expect(shouldExposeErrorDetails({ expected_count: 2, updated_count: 1 })).toBe(
      true
    );
    expect(shouldExposeErrorDetails({ code: "42501" })).toBe(true);
  });

  it("keeps public objects whose fields are null (lock holder, PDF status)", () => {
    expect(shouldExposeErrorDetails({ lock: null })).toBe(true);
    expect(
      shouldExposeErrorDetails({
        status: "processing",
        download_url: null,
        last_error: null,
      })
    ).toBe(true);
  });

  it("does not mistake a lowercase business code for a SQLSTATE", () => {
    expect(isPostgrestErrorLike({ code: "draft", message: "Version en brouillon" })).toBe(
      false
    );
    expect(isPostgrestErrorLike({ code: "23505", message: "duplicate key" })).toBe(true);
    expect(isPostgrestErrorLike({ code: "PGRST301", message: "jwt" })).toBe(true);
  });
});

describe("buildErrorResponseBody", () => {
  it("omits details in never mode and logs them", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      buildErrorResponseBody(
        {
          status: 400,
          code: "BAD_REQUEST",
          message: "Payload invalide",
          details: { table: "dpgf_imports", column: "user_id" },
        },
        { detailsMode: "never", detailsLogScope: "imports" }
      )
    ).toEqual({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: "Payload invalide",
      },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[imports] API error details"),
      expect.objectContaining({ table: "dpgf_imports" })
    );

    errorSpy.mockRestore();
  });
});

describe("shared toErrorResponse", () => {
  it("does not put unexpected Error text in the JSON body", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = toErrorResponse(new Error("secret-internal-token"), {
      isApiError: (value): value is ApiError => value instanceof ApiError,
      createInternalError: () =>
        new ApiError({
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Une erreur interne est survenue.",
        }),
      unexpectedLogMessage: "Unexpected estimate API error",
    });
    const body = (await response.json()) as {
      ok: false;
      error: { code: string; message: string; details?: unknown };
    };

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret-internal-token");
    expect(body.error).not.toHaveProperty("details");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

describe("estimates toErrorResponse", () => {
  it("does not expose unexpected Error or Supabase-like details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const unexpected = await toEstimatesErrorResponse(
      new Error("secret-internal-token")
    ).json();
    expect(JSON.stringify(unexpected)).not.toContain("secret-internal-token");
    expect(
      (unexpected as { error: Record<string, unknown> }).error
    ).not.toHaveProperty("details");

    const supabaseResponse = toEstimatesErrorResponse(
      badRequest("Payload invalide.", POSTGREST_LEAK)
    );
    const supabaseBody = (await supabaseResponse.json()) as {
      error: Record<string, unknown>;
    };
    const serialized = JSON.stringify(supabaseBody);

    expect(supabaseResponse.status).toBe(400);
    expect(supabaseBody.error).not.toHaveProperty("details");
    expect(serialized).not.toContain("secret-tenant-id");
    expect(serialized).not.toContain("tenant_memberships");
    expect(serialized).not.toContain("permission denied");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("keeps SQLSTATE-only mapSupabaseError details and Zod issues", async () => {
    const mapped = mapEstimatesSupabaseError(
      {
        code: "23505",
        message: "duplicate key value violates unique constraint",
        details: "Key (tenant_id)=(secret-tenant-id) already exists",
        hint: "unique constraint estimates_pkey",
      },
      "fallback"
    );
    const mappedBody = (await toEstimatesErrorResponse(mapped).json()) as {
      error: { details?: unknown };
    };
    expect(mappedBody.error.details).toEqual({ code: "23505" });

    const zodError = parseZodError(
      z.object({ tenant_id: z.string().uuid() }),
      { tenant_id: "not-a-uuid" }
    );
    const zodBody = (await toEstimatesErrorResponse(zodError).json()) as {
      error: {
        code: string;
        message: string;
        details?: { issues?: Array<{ path: string }> };
      };
    };

    expect(zodBody.error.code).toBe("VALIDATION_ERROR");
    expect(zodBody.error.message).toBe("Payload invalide.");
    expect(zodBody.error.details?.issues?.[0]).toMatchObject({ path: "tenant_id" });
  });
});

describe("memberships toErrorResponse", () => {
  it("does not expose unexpected Error or Supabase-like details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const unexpected = await toMembershipsErrorResponse(
      new Error("secret-internal-token")
    ).json();
    expect(JSON.stringify(unexpected)).not.toContain("secret-internal-token");
    expect(
      (unexpected as { error: Record<string, unknown> }).error
    ).not.toHaveProperty("details");

    const mapped = mapMembershipsSupabaseError(POSTGREST_LEAK as never, "fallback");
    const supabaseBody = (await toMembershipsErrorResponse(mapped).json()) as {
      error: Record<string, unknown>;
    };
    const serialized = JSON.stringify(supabaseBody);

    expect(mapped.details).toEqual(POSTGREST_LEAK);
    expect(supabaseBody.error).not.toHaveProperty("details");
    expect(serialized).not.toContain("secret-tenant-id");
    expect(serialized).not.toContain("tenant_memberships");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("allows Zod issues and safe public objects", async () => {
    const publicBody = (await toMembershipsErrorResponse(
      new MembershipsApiError({
        status: 409,
        code: "CONFLICT",
        message: "already exists",
        details: { id: "m-1" },
      })
    ).json()) as { error: { details?: unknown } };
    expect(publicBody.error.details).toEqual({ id: "m-1" });

    const zodError = parseZodError(
      z.object({ tenant_id: z.string().uuid() }),
      { tenant_id: "invalid-uuid" }
    );
    const zodBody = (await toMembershipsErrorResponse(zodError).json()) as {
      error: {
        code: string;
        details?: { issues?: Array<{ path: string }> };
      };
    };

    expect(zodBody.error.code).toBe("VALIDATION_ERROR");
    expect(zodBody.error.details?.issues?.[0]).toMatchObject({ path: "tenant_id" });
  });
});
