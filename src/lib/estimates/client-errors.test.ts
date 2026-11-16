import { describe, expect, it } from "vitest";

import { resolveEnvelopeErrorMessage } from "@/lib/estimates/client-errors";

describe("resolveEnvelopeErrorMessage", () => {
  it("returns the envelope's error message", () => {
    expect(resolveEnvelopeErrorMessage({ ok: false, error: { code: "FORBIDDEN", message: "Accès refusé." } }, "Échec.")).toBe(
      "Accès refusé."
    );
  });

  it("keeps an empty error message rather than the fallback", () => {
    expect(resolveEnvelopeErrorMessage({ error: { message: "" } }, "Échec.")).toBe("");
  });

  it("falls back for non-object payloads, arrays and envelopes without error message", () => {
    for (const payload of [null, undefined, "Accès refusé.", 42, [], [{ error: { message: "x" } }], {}, { error: {} }, { error: null }]) {
      expect(resolveEnvelopeErrorMessage(payload, "Échec.")).toBe("Échec.");
    }
  });

  it("does not read a top-level message, an error code or a string error", () => {
    expect(resolveEnvelopeErrorMessage({ message: "top-level" }, "Échec.")).toBe("Échec.");
    expect(resolveEnvelopeErrorMessage({ error: { code: "CONFLICT" } }, "Échec.")).toBe("Échec.");
    expect(resolveEnvelopeErrorMessage({ error: "Accès refusé." }, "Échec.")).toBe("Échec.");
  });
});
