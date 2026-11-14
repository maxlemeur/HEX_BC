import { describe, expect, it } from "vitest";

import { readOutgoingEmailRouting, routeOutgoingEmail } from "./outgoing-routing";

const message = { to: "client@exemple.invalid", cc: ["associe@exemple.invalid"], subject: "Devis - Affaire" };

describe("outgoing email routing", () => {
  it("redirects by default: without a mode, nothing reaches the written recipient", () => {
    const routing = readOutgoingEmailRouting({ EMAIL_REDIRECT_TO: " recette@test.invalid " });
    expect(routing).toEqual({ mode: "redirect", address: "recette@test.invalid" });
    expect(routeOutgoingEmail(routing, message)).toEqual({
      to: "recette@test.invalid",
      cc: undefined,
      subject: "[TEST → client@exemple.invalid, cc associe@exemple.invalid] Devis - Affaire",
    });
  });

  it("names the written recipient alone when there is no copy", () => {
    const routing = readOutgoingEmailRouting({ EMAIL_DELIVERY_MODE: "redirect", EMAIL_REDIRECT_TO: "recette@test.invalid" });
    expect(routeOutgoingEmail(routing, { to: "client@exemple.invalid", cc: null, subject: "Devis" })).toEqual({
      to: "recette@test.invalid",
      cc: undefined,
      subject: "[TEST → client@exemple.invalid] Devis",
    });
  });

  it("refuses to route when redirecting has no address: no mail leaves rather than a real one", () => {
    for (const env of [{}, { EMAIL_REDIRECT_TO: "  " }, { EMAIL_DELIVERY_MODE: "redirect" }]) {
      expect(() => readOutgoingEmailRouting(env)).toThrowError(
        expect.objectContaining({ code: "EMAIL_REDIRECT_NOT_CONFIGURED", message: "Configuration email manquante: EMAIL_REDIRECT_TO." }),
      );
    }
  });

  it("refuses a redirect address that is not one mailbox", () => {
    for (const address of [
      "pas-une-adresse", "a@b.invalid, c@d.invalid", "a@b.invalid\nBcc: c@d.invalid", "a@..invalid", "a@b.invalid.",
      "a@-b.invalid", "<a@b.invalid>", "a\u0007@b.invalid",
    ]) {
      expect(() => readOutgoingEmailRouting({ EMAIL_REDIRECT_TO: address })).toThrowError(
        expect.objectContaining({ code: "EMAIL_REDIRECT_NOT_CONFIGURED" }),
      );
    }
  });

  it("refuses an unknown mode instead of guessing: a typo of « live » must not send, nor silently redirect", () => {
    for (const mode of ["Live", "prod", "on", "true"]) {
      expect(() => readOutgoingEmailRouting({ EMAIL_DELIVERY_MODE: mode, EMAIL_REDIRECT_TO: "recette@test.invalid" })).toThrowError(
        expect.objectContaining({ code: "EMAIL_DELIVERY_MODE_INVALID" }),
      );
    }
  });

  it("delivers as written only when the mode says live, redirect address or not", () => {
    const routing = readOutgoingEmailRouting({ EMAIL_DELIVERY_MODE: " live ", EMAIL_REDIRECT_TO: "recette@test.invalid" });
    expect(routing).toEqual({ mode: "live" });
    expect(routeOutgoingEmail(routing, message)).toEqual({ to: message.to, cc: message.cc, subject: message.subject });
    expect(routeOutgoingEmail(readOutgoingEmailRouting({ EMAIL_DELIVERY_MODE: "live" }), { ...message, cc: null }))
      .toEqual({ to: message.to, cc: undefined, subject: message.subject });
  });

  it("keeps a long list of copies from flooding the subject", () => {
    const routing = readOutgoingEmailRouting({ EMAIL_REDIRECT_TO: "recette@test.invalid" });
    const cc = Array.from({ length: 30 }, (_, index) => `copie-${index}@exemple.invalid`);
    const routed = routeOutgoingEmail(routing, { to: "client@exemple.invalid", cc, subject: "Devis" });
    expect(routed.subject.endsWith("] Devis")).toBe(true);
    expect(routed.subject.length).toBeLessThanOrEqual(200);
    expect(routed.subject).toContain("client@exemple.invalid");
    const named = routed.subject.match(/copie-\d+@exemple\.invalid/g)?.length ?? 0;
    expect(named).toBeGreaterThan(0);
    expect(routed.subject).toContain(` +${30 - named}] Devis`);
  });

  it("still names the first recipient and counts the copies when the subject is already long", () => {
    const routing = readOutgoingEmailRouting({ EMAIL_REDIRECT_TO: "recette@test.invalid" });
    const subject = "D".repeat(240);
    expect(routeOutgoingEmail(routing, { to: "client@exemple.invalid", cc: ["a@exemple.invalid", "b@exemple.invalid"], subject }).subject)
      .toBe(`[TEST → client@exemple.invalid +2] ${subject}`);
    expect(routeOutgoingEmail(routing, { to: "client@exemple.invalid", cc: null, subject }).subject)
      .toBe(`[TEST → client@exemple.invalid] ${subject}`);
  });
});
