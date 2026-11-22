import { describe, expect, it } from "vitest";

import { buildConsultationMessage, type ConsultationLine } from "./consultation-message";
import { templateInForce } from "./consultation-template-contracts";
import {
  CONSULTATION_LINE_TEMPLATE_MAX,
  CONSULTATION_MESSAGE_TEMPLATE_MAX,
  DEFAULT_CONSULTATION_TEMPLATE,
  competitionReferenceLeaks,
  consultationMessage,
  consultationMessageProblem,
  consultationTemplateIssues,
  consultationTemplateRefusals,
  renderConsultationMessage,
  type ConsultationTemplate,
} from "./consultation-template";
import { MATERIAL_REQUEST_QUOTE_MESSAGE_MAX } from "./quote-contracts";

/**
 * Failure modes, written before the renderer (TI-691: « paramétrer le texte pour l’envoi fournisseur, changer la
 * mise en forme telle que l’on souhaite »; each member keeps a template of their own). Every example is invented:
 *  1. the default template does not give, byte for byte, today's message in both variants (with references and
 *     competition), with or without an affaire, a delivery place or a quantity;
 *  2. a member without a template gets anything else than today's message;
 *  3. an empty field leaves a dangling separator, a double space, a trailing space or a blank line; an optional
 *     part `[ … ]` stays when its field is empty, or loses its text when it is filled;
 *  4. a competition message carries a reference because the template asks for `{référence}`, or because the
 *     designation was computed for the usual supplier;
 *  5. a field typed without its accent (`{quantite}`) or in capitals is not recognised; an unknown field is
 *     dropped or altered instead of being left as typed; a field of the message used in a line is filled;
 *  6. a value that holds brackets or braces (« Té [DN 50] ») is read as template syntax;
 *  7. lines lose their number, their order, or the supplier's name;
 *  8. a template without the lines, or with a field written twice, is accepted (a message without its lines, or
 *     one that a request of 300 lines would push over the recorded message's bound);
 *  9. a template dropping `{référence}` gets the short designation the reference was meant to complete.
 * Amendments (design review of the templates, the owner's company template):
 * 10. the template in force is not the member's own, else the company's, else today's message;
 * 11. a competition text that names a reference known for its lines (typed in a template or in a retouch) goes
 *     unnoticed; or a reference is found inside another word, or the check blocks the text instead of warning;
 * 12. a final text that is empty, blank or over the recorded bound (counted as the API counts it) is offered to
 *     copy or record; or a text at the bound is refused;
 * 13. an emoji in a template or a value is cut or miscounted; a field written twice is not written twice.
 * Review of PR #463:
 * 14. the short designation (without size or material) is written on a line whose reference is not, because an
 *     optional part holding {référence} vanished there (no quantity);
 * 15. a known reference retyped with another separator, case or accent (« NA 4471 », « na4471 », « NA–4471 ») goes
 *     unnoticed; or a short code without a digit (« 50 » in « DN 50 ») raises a false warning;
 * 16. a field written twice is refused (only {lignes} stays once at most).
 */

function item(partial: Partial<ConsultationLine> = {}): ConsultationLine {
  return {
    position: 1,
    quantity: 10,
    unit: "u",
    designation: "Coude 90°",
    dimension: "DN 50",
    material: "Inox 316L",
    precision: null,
    originalText: "10 coudes inox 50",
    reference: null,
    supplierSku: null,
    ...partial,
  };
}

const LINES: ConsultationLine[] = [
  item({ supplierSku: "NA-4471", reference: "CD-I316-50" }),
  item({ position: 2, quantity: 4, designation: "Té égal", supplierSku: null, originalText: "4 tés inox 50" }),
  item({ position: 3, quantity: null, unit: null, designation: "Collier isophonique", dimension: null, material: null }),
  item({ position: 4, quantity: 2.5, unit: "ml", designation: "Tube cuivre", dimension: "Ø 22", material: null, supplierSku: "TU-22" }),
  item({ position: 5, quantity: 4, designation: null, dimension: null, material: null, originalText: "réf NA-4471 x4", reference: "NA-4471" }),
  item({ position: 6, quantity: 3, designation: null, dimension: null, material: null, originalText: null }),
];

function custom(message: string, line: string): ConsultationTemplate {
  return { message, line };
}

const base = { affaireName: "Résidence des Tilleuls", supplierName: "Négoce Alpha", lines: LINES } as const;

describe("consultation template", () => {
  it("gives today's message byte for byte with the default template, in every case (1)", () => {
    for (const withReferences of [true, false]) {
      for (const deliveryPlace of ["site", "office", "counter", null] as const) {
        for (const affaireName of ["Résidence des Tilleuls", "", "   "]) {
          for (const lines of [LINES, [], LINES.slice(0, 1), LINES.slice(2, 3)]) {
            const input = { affaireName, lines, withReferences, deliveryPlace };
            expect(
              renderConsultationMessage({ ...input, supplierName: "Négoce Alpha", template: DEFAULT_CONSULTATION_TEMPLATE }),
            ).toBe(buildConsultationMessage(input));
          }
        }
      }
    }
  });

  it("writes today's message when the member has no template (2)", () => {
    const input = { affaireName: "Atelier Nord", lines: LINES, withReferences: true, deliveryPlace: "site" as const };
    expect(consultationMessage({ ...input, supplierName: "Négoce Alpha", template: null })).toBe(buildConsultationMessage(input));
    expect(
      consultationMessage({ ...input, withReferences: false, supplierName: "Comptoir Bêta", template: null }),
    ).toBe(buildConsultationMessage({ ...input, withReferences: false }));
  });

  it("follows a template of the member's own: fields, supplier, numbers, order (7)", () => {
    const message = renderConsultationMessage({
      ...base,
      lines: LINES.slice(0, 2),
      withReferences: true,
      deliveryPlace: "site",
      template: custom(
        "Bonjour {fournisseur},\nChantier {affaire}, merci de chiffrer :\n\n{lignes}\n\n{livraison}\nCordialement,\nMax",
        "{ligne}. {désignation}[ (réf. {référence})] : {quantité}",
      ),
    });

    expect(message).toBe(
      [
        "Bonjour Négoce Alpha,",
        "Chantier Résidence des Tilleuls, merci de chiffrer :",
        "",
        "1. Coude 90° (réf. NA-4471) : 10 u",
        "2. Té égal, DN 50, Inox 316L : 4 u",
        "",
        "Livraison : chantier",
        "Cordialement,",
        "Max",
      ].join("\n"),
    );
  });

  it("drops an optional part whose field is empty and keeps its text when filled (3)", () => {
    const template = custom("{lignes}", "- [{quantité} x ]{désignation}[ — réf. {référence}]");
    const message = renderConsultationMessage({ ...base, withReferences: true, deliveryPlace: null, template });

    expect(message.split("\n").slice(0, 4)).toEqual([
      "- 10 u x Coude 90° — réf. NA-4471",
      "- 4 u x Té égal, DN 50, Inox 316L",
      "- Collier isophonique",
      "- 2,5 ml x Tube cuivre — réf. TU-22",
    ]);
  });

  it("leaves no double space, trailing space or blank line where a field is empty (3)", () => {
    const template = custom(
      "Bonjour,  voici pour {affaire} {fournisseur}\n{livraison}\n{lignes}\nRéf. chantier : {affaire}\nMerci",
      "-  {quantité}  {désignation} {référence}",
    );
    const message = renderConsultationMessage({
      ...base,
      affaireName: "",
      lines: LINES.slice(2, 3),
      withReferences: true,
      deliveryPlace: null,
      template,
    });

    expect(message).toBe(["Bonjour, voici pour Négoce Alpha", "- Collier isophonique", "Merci"].join("\n"));
    expect(message).not.toMatch(/ {2}| $|\n\n|^ /m);
  });

  it("keeps the blank lines and spaces the member typed where no field is (3)", () => {
    const message = renderConsultationMessage({
      ...base,
      lines: LINES.slice(1, 2),
      withReferences: true,
      deliveryPlace: null,
      template: custom("Bonjour,\n\n{lignes}\n\n  Merci  d’avance", "* {désignation}"),
    });

    expect(message).toBe("Bonjour,\n\n* Té égal, DN 50, Inox 316L\n\n  Merci  d’avance");
  });

  it("never writes a reference in a competition message, even when the template asks for one (4)", () => {
    const message = renderConsultationMessage({
      ...base,
      withReferences: false,
      deliveryPlace: "office",
      template: custom("{fournisseur} — {affaire}\n{lignes}", "{ligne} {quantité} {désignation} réf {référence}[ — réf. {référence}]"),
      supplierName: "Comptoir Bêta",
    });

    expect(message.split("\n")).toEqual([
      "Comptoir Bêta — Résidence des Tilleuls",
      "1 10 u Coude 90°, DN 50, Inox 316L réf",
      "2 4 u Té égal, DN 50, Inox 316L réf",
      "3 Collier isophonique réf",
      "4 2,5 ml Tube cuivre, Ø 22 réf",
      "5 4 u Article à préciser (ligne 5) réf",
      "6 3 u Article à préciser (ligne 6) réf",
    ]);
    expect(message).not.toMatch(/NA-4471|CD-I316|TU-22/);
  });

  it("recognises fields without accents or in capitals, and leaves unknown ones as typed (5)", () => {
    const message = renderConsultationMessage({
      ...base,
      lines: LINES.slice(0, 1),
      withReferences: true,
      deliveryPlace: "counter",
      template: custom("{AFFAIRE} {chantier} {ligne}\n{lignes}\n{Livraison}", "{quantite} {Designation} [{reference}] {prix} {lignes} {affaire}"),
    });

    expect(message.split("\n")).toEqual([
      "Résidence des Tilleuls {chantier} {ligne}",
      "10 u Coude 90° NA-4471 {prix} {lignes} {affaire}",
      "Retrait au comptoir",
    ]);
    expect(consultationTemplateIssues(custom("{AFFAIRE} {chantier} {ligne}\n{lignes}", "{quantite} {désignation} {prix} {lignes}"))).toEqual({
      message: { unknown: ["{chantier}", "{ligne}"], duplicated: [], missing: [] },
      line: { unknown: ["{prix}", "{lignes}"], duplicated: [], missing: [] },
    });
  });

  it("keeps an optional part without a known field as typed, brackets included (5)", () => {
    const message = renderConsultationMessage({
      ...base,
      lines: LINES.slice(0, 1),
      withReferences: true,
      deliveryPlace: null,
      template: custom("[Urgent] {lignes} [{chantier}]", "{désignation} [à voir"),
    });

    expect(message).toBe("[Urgent] Coude 90°, DN 50, Inox 316L [à voir [{chantier}]");
  });

  it("does not read brackets or braces of a value as template syntax (6)", () => {
    const message = renderConsultationMessage({
      ...base,
      affaireName: "Chantier {lignes} [B]",
      supplierName: "Dépôt [Gamma]",
      lines: [item({ designation: "Té [DN 50] {référence}", dimension: null, material: null, supplierSku: "A]{B" })],
      withReferences: true,
      deliveryPlace: null,
      template: custom("{fournisseur} {affaire}\n{lignes}", "{désignation}[ / {référence}]"),
    });

    expect(message).toBe("Dépôt [Gamma] Chantier {lignes} [B]\nTé [DN 50] {référence} / A]{B");
  });

  it("gives the full designation when the template does not write the reference beside it (9)", () => {
    const message = renderConsultationMessage({
      ...base,
      lines: LINES.slice(0, 1),
      withReferences: true,
      deliveryPlace: null,
      template: custom("{lignes}", "- {quantité} {désignation}"),
    });

    expect(message).toBe("- 10 u Coude 90°, DN 50, Inox 316L");
  });

  it("refuses a template without its lines or designation, or with its lines twice; other fields may repeat (8, 16)", () => {
    expect(consultationTemplateIssues(custom("Bonjour {affaire}", "{quantité} {quantite} {désignation}"))).toEqual({
      message: { unknown: [], duplicated: [], missing: ["{lignes}"] },
      line: { unknown: [], duplicated: [], missing: [] },
    });
    expect(consultationTemplateIssues(custom("{lignes}\n{lignes}", "{quantité}"))).toEqual({
      message: { unknown: [], duplicated: ["{lignes}"], missing: [] },
      line: { unknown: [], duplicated: [], missing: ["{désignation}"] },
    });
    const twice = custom("Bonjour {fournisseur},\n{lignes}\nMerci pour {fournisseur} !", "- {désignation}");
    expect(consultationTemplateRefusals(twice)).toEqual([]);
    expect(
      renderConsultationMessage({ ...base, lines: LINES.slice(1, 2), withReferences: false, deliveryPlace: null, template: twice }),
    ).toBe("Bonjour Négoce Alpha,\n- Té égal, DN 50, Inox 316L\nMerci pour Négoce Alpha !");
    expect(consultationTemplateIssues(DEFAULT_CONSULTATION_TEMPLATE)).toEqual({
      message: { unknown: [], duplicated: [], missing: [] },
      line: { unknown: [], duplicated: [], missing: [] },
    });
  });

  it("writes the short designation only on a line that writes its reference (14)", () => {
    const valve = item({ quantity: null, unit: null, designation: "Vanne", dimension: "DN50", material: null, supplierSku: "VA-50" });
    const counted = item({ quantity: 2, designation: "Vanne", dimension: "DN50", material: null, supplierSku: "VA-50" });
    const message = renderConsultationMessage({
      ...base,
      lines: [valve, counted],
      withReferences: true,
      deliveryPlace: null,
      template: custom("{lignes}", "[{quantité} réf {référence}] {désignation}"),
    });
    expect(message).toBe("Vanne, DN50\n2 u réf VA-50 Vanne");
  });

  it("keeps a 300-line request of ordinary lines under the recorded bound with the longest templates (8)", () => {
    const longest = custom(
      `{affaire} {fournisseur} {livraison}\n{lignes}\n${"x".repeat(CONSULTATION_MESSAGE_TEMPLATE_MAX - 50)}`.slice(0, CONSULTATION_MESSAGE_TEMPLATE_MAX),
      `${"y".repeat(CONSULTATION_LINE_TEMPLATE_MAX - 60)} {ligne} {quantité} {désignation}[ {référence}]`,
    );
    expect(longest.message.length).toBeLessThanOrEqual(CONSULTATION_MESSAGE_TEMPLATE_MAX);
    expect(longest.line.length).toBeLessThanOrEqual(CONSULTATION_LINE_TEMPLATE_MAX);
    const ordinary = Array.from({ length: 300 }, (_, index) =>
      item({ position: index + 1, quantity: 999999.999, unit: "u", designation: "Coude 90° égal à souder", dimension: "DN 150", material: "Inox 316L", precision: "PN16", supplierSku: "SKU-0000000000-AB" }),
    );
    const message = renderConsultationMessage({ ...base, lines: ordinary, withReferences: true, deliveryPlace: "site", template: longest });
    expect(message.length).toBeLessThan(MATERIAL_REQUEST_QUOTE_MESSAGE_MAX);
  });

  it("takes the member's template, else the company's, else today's message (10)", () => {
    const own = { message_template: "Perso {lignes}", line_template: "- {désignation}" };
    const company = { message_template: "Société {lignes}", line_template: "* {désignation}" };
    expect(templateInForce({ personal: own, company })).toEqual({ message: "Perso {lignes}", line: "- {désignation}" });
    expect(templateInForce({ personal: null, company })).toEqual({ message: "Société {lignes}", line: "* {désignation}" });
    expect(templateInForce({ personal: null, company: null })).toBeNull();
    const input = { affaireName: "Atelier Nord", supplierName: "Négoce Alpha", lines: LINES, withReferences: true, deliveryPlace: null };
    expect(consultationMessage({ ...input, template: templateInForce({ personal: null, company: null }) })).toBe(
      buildConsultationMessage(input),
    );
    expect(consultationMessage({ ...input, template: templateInForce({ personal: null, company }) }).split(" ")[0]).toBe("Société");
  });

  it("names the known references a competition text holds, whole words only, case aside (11)", () => {
    const references = ["NA-4471", "cd-i316-50", "TU-22", null, "  "];
    expect(competitionReferenceLeaks("Bonjour, réf na-4471 et TU-22 svp\n- Coude", references)).toEqual(["NA-4471", "TU-22"]);
    expect(competitionReferenceLeaks("Bonjour XNA-4471 et TU-225", references)).toEqual([]);
    expect(competitionReferenceLeaks(buildConsultationMessage({ affaireName: "A", lines: LINES, withReferences: false, deliveryPlace: null }), [
      ...LINES.map((line) => line.reference),
      ...LINES.map((line) => line.supplierSku),
    ])).toEqual([]);
  });

  it("finds a known reference retyped with other separators, case or accents, and ignores short codes (15)", () => {
    for (const typed of ["NA 4471", "na4471", "NA–4471", "NA—4471", "na.4471", "NA/4471", "NA_4471", "Na - 4471"]) {
      expect(competitionReferenceLeaks(`Comme le ${typed} svp`, ["NA-4471"])).toEqual(["NA-4471"]);
    }
    expect(competitionReferenceLeaks("Réf CD I316 50 svp", ["cd-i316-50"])).toEqual(["cd-i316-50"]);
    expect(competitionReferenceLeaks("Référence ÉCO-12 svp", ["eco12"])).toEqual(["eco12"]);
    // Too short once folded, or without a digit: « 50 » would match « DN 50 », « VANNE » a plain word.
    expect(competitionReferenceLeaks("- 4 u Té égal, DN 50, Vanne", ["50", "A-5", "VANNE"])).toEqual([]);
    expect(competitionReferenceLeaks("NA-44712", ["NA-4471"])).toEqual([]);
  });

  it("refuses an empty, blank or too long final text, and accepts one at the bound (12)", () => {
    expect(consultationMessageProblem("")).toMatch(/vide/);
    expect(consultationMessageProblem(" \n\t")).toMatch(/vide/);
    expect(consultationMessageProblem("x".repeat(MATERIAL_REQUEST_QUOTE_MESSAGE_MAX))).toBeNull();
    expect(consultationMessageProblem("x".repeat(MATERIAL_REQUEST_QUOTE_MESSAGE_MAX + 1))).toMatch(/262 144 caractères/);
    // Counted as the API counts it: an emoji is two units there.
    expect(consultationMessageProblem("👍".repeat(MATERIAL_REQUEST_QUOTE_MESSAGE_MAX / 2))).toBeNull();
    expect(consultationMessageProblem(`${"👍".repeat(MATERIAL_REQUEST_QUOTE_MESSAGE_MAX / 2)}x`)).toMatch(/caractères/);
  });

  it("writes emoji whole and a field written twice twice (13)", () => {
    const message = renderConsultationMessage({
      ...base,
      lines: [item({ designation: "Coude 🔧", dimension: null, material: null })],
      withReferences: false,
      deliveryPlace: null,
      template: custom("👋 {fournisseur} 👋\n{lignes}\n🙏 {affaire} / {affaire}", "✅ {désignation} ({désignation})"),
    });
    expect(message).toBe("👋 Négoce Alpha 👋\n✅ Coude 🔧 (Coude 🔧)\n🙏 Résidence des Tilleuls / Résidence des Tilleuls");
  });
});
