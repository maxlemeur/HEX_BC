import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

describe("import body admission at the HTTP entry point", () => {
  it.each(["/api/imports", "/api/imports/", "/api/imports?project_id=any",
    "/api/imports/tabular-pdf/review", "/api/imports/tabular-pdf/review-file"])(
    "leaves the original request stream to the handler at %s", (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    });

  it.each(["/api/imports-extra", "/api/imports/tabular-pdf/review-file-other", "/dashboard/affaires", "/login"])(
    "preserves session middleware at %s", (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    });
});
