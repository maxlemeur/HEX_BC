import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SealIntegrityBadge } from "@/components/estimates/SealIntegrityBadge";

describe("SealIntegrityBadge", () => {
  it("explique qu'une version non scellée reste modifiable", () => {
    const markup = renderToStaticMarkup(
      createElement(SealIntegrityBadge, { state: "unsealed" })
    );

    expect(markup).toContain("Non scellé");
    expect(markup).toContain("Version modifiable");
    expect(markup).toContain("empreinte d’intégrité");
  });
});
