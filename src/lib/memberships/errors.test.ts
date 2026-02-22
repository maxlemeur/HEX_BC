import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  MembershipsApiError,
  badRequest,
  conflict,
  forbidden,
  internalError,
  mapSupabaseError,
  notFound,
  ok,
  toErrorResponse,
  unauthorized,
} from "@/lib/memberships/errors";

type PostgrestErrorLike = {
  code: string;
  details: string | null;
  hint: string | null;
  message: string;
};

function createPostgrestError(input: Partial<PostgrestErrorLike>): PostgrestErrorLike {
  return {
    code: input.code ?? "XX000",
    details: input.details ?? null,
    hint: input.hint ?? null,
    message: input.message ?? "generic error",
  };
}

describe("memberships error helpers", () => {
  it("returns an ok response with default status", async () => {
    const response = ok({ member: true });
    const body = (await response.json()) as {
      ok: boolean;
      data: { member: boolean };
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: { member: true },
    });
  });

  it("creates typed API errors with status/code/details", () => {
    expect(badRequest("bad payload", { field: "role" }, "BAD_PAYLOAD")).toMatchObject({
      status: 400,
      code: "BAD_PAYLOAD",
      message: "bad payload",
      details: { field: "role" },
    });
    expect(unauthorized()).toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
    expect(forbidden("blocked")).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "blocked",
    });
    expect(notFound("missing")).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      message: "missing",
    });
    expect(conflict("duplicate")).toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "duplicate",
    });
    expect(internalError()).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Une erreur interne est survenue.",
    });
  });
});

describe("mapSupabaseError", () => {
  it("maps RLS errors to FORBIDDEN", () => {
    expect(
      mapSupabaseError(
        createPostgrestError({
          code: "42501",
          message: "permission denied",
        }) as never,
        "fallback"
      )
    ).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Acces refuse.",
    });

    expect(
      mapSupabaseError(
        createPostgrestError({
          code: "XX000",
          message: "Row-Level Security policy violation",
        }) as never,
        "fallback"
      )
    ).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("maps known postgres errors to expected API statuses", () => {
    expect(
      mapSupabaseError(
        createPostgrestError({
          code: "PGRST116",
          message: "not found",
        }) as never,
        "fallback"
      )
    ).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });

    expect(
      mapSupabaseError(
        createPostgrestError({
          code: "23505",
          message: "unique violation",
        }) as never,
        "fallback"
      )
    ).toMatchObject({
      status: 409,
      code: "CONFLICT",
    });

    for (const code of ["23503", "23514", "22P02"] as const) {
      expect(
        mapSupabaseError(
          createPostgrestError({
            code,
            message: "bad constraint",
          }) as never,
          "invalid payload"
        )
      ).toMatchObject({
        status: 400,
        code: "BAD_REQUEST",
        message: "invalid payload",
      });
    }

    expect(
      mapSupabaseError(
        createPostgrestError({
          code: "99999",
          message: "unknown",
        }) as never,
        "fallback message"
      )
    ).toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "fallback message",
    });
  });
});

describe("toErrorResponse", () => {
  it("serializes MembershipsApiError as-is", async () => {
    const response = toErrorResponse(
      new MembershipsApiError({
        status: 409,
        code: "CONFLICT",
        message: "already exists",
        details: { id: "m-1" },
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
        details: unknown;
      };
    };

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "already exists",
        details: { id: "m-1" },
      },
    });
  });

  it("maps ZodError to VALIDATION_ERROR", async () => {
    const schema = z.object({
      tenant_id: z.string().uuid(),
    });

    let parsingError: unknown;
    try {
      schema.parse({ tenant_id: "invalid-uuid" });
    } catch (error) {
      parsingError = error;
    }

    const response = toErrorResponse(parsingError);
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
        details: { issues: Array<{ path: string; message: string; code: string }> };
      };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Payload invalide.");
    expect(body.error.details.issues).toHaveLength(1);
    expect(body.error.details.issues[0]).toMatchObject({
      path: "tenant_id",
    });
  });

  it("maps unknown errors to INTERNAL_ERROR and logs the failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = toErrorResponse(new Error("unexpected"));
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Une erreur interne est survenue.");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
