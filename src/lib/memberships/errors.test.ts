import { describe, expect, it, vi } from "vitest";

import { mapSupabaseError, toErrorResponse } from "@/lib/memberships/errors";

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
