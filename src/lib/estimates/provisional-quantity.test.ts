import { describe, expect, it } from "vitest";

import {
  appendProvisionalQuantityMentions,
  composeProvisionalQuantityMention,
  countStaleProvisionalQuantityMentions,
  OFFER_LIMITS_MAX_LENGTH,
  planProvisionalQuantityMentions,
  provisionalMentionsOverflowMessage,
  formatProvisionalQuantity,
  hasProvisionalQuantityMention,
  normalizeProvisionalText,
  PROVISIONAL_QUANTITY_TEXT,
  provisionalTextError,
} from "@/lib/estimates/provisional-quantity";

// TI-682, lot C, PR 5: the « quantité provisionnelle » sentence. The tool writes it from the line as it is now, the
// administrator inserts it in the limits text, and the send gate looks for it there.

const choice = { established_on: "le plan CVC indice B", to_confirm_by: "le relevé contradictoire sur site" };
const line = (extra: Record<string, unknown> = {}) => ({ title: "Calorifuge des réseaux EC", quantity: 12, unit_code: "ml", ...extra });

describe("provisional quantity sentence", () => {
  it("writes the quantity as the offer's PDF does: fr-FR, three decimals at most, plain spaces", () => {
    expect([1.5, 12, 0.125, 1234.5, -3, "4.250", 0].map(formatProvisionalQuantity))
      .toEqual(["1,5", "12", "0,125", "1 234,5", "-3", "4,25", "0"]);
    expect([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "", "abc"].map(formatProvisionalQuantity))
      .toEqual([null, null, null, null, null, null]);
  });

  it("composes « {Titre} : quantité provisionnelle de {Q} {unité}, établie sur …, à confirmer selon …. »", () => {
    expect(composeProvisionalQuantityMention(line(), choice)).toBe(
      "Calorifuge des réseaux EC : quantité provisionnelle de 12 ml, établie sur le plan CVC indice B, à confirmer selon "
        + "le relevé contradictoire sur site.");
    expect(composeProvisionalQuantityMention(line({ quantity: 0.125, unit_code: "m2" }), choice))
      .toContain("quantité provisionnelle de 0,125 m², établie");
    expect(composeProvisionalQuantityMention(line({ quantity: "1.5", unit_code: "u" }), choice))
      .toContain("quantité provisionnelle de 1,5 u, établie");
  });

  it("leaves the unit out when the line has none, and writes no sentence without a quantity", () => {
    expect(composeProvisionalQuantityMention(line({ unit_code: null }), choice))
      .toBe("Calorifuge des réseaux EC : quantité provisionnelle de 12, établie sur le plan CVC indice B, à confirmer selon "
        + "le relevé contradictoire sur site.");
    expect(composeProvisionalQuantityMention(line({ quantity: null }), choice)).toBeNull();
  });

  it("names a line without a title, and reads its title on one line", () => {
    expect(composeProvisionalQuantityMention(line({ title: "  " }), choice)).toMatch(/^Sans titre : quantité/);
    expect(composeProvisionalQuantityMention(line({ title: " Réseau\n  EF\t" }), choice)).toMatch(/^Réseau EF : quantité/);
  });

  it("finds the sentence in the limits text whatever its blanks and line breaks", () => {
    const mention = composeProvisionalQuantityMention(line(), choice)!;
    const wrapped = mention.replace(/ /g, (space, offset: number) => (offset % 3 === 0 ? "\n" : offset % 2 ? "  " : "\u00a0"));
    for (const exclusions of [mention, `Limites.\n\n${mention}\nAutre point.`, wrapped, `  ${mention.replace(", établie", ",\r\n\tétablie")}  `]) {
      expect(hasProvisionalQuantityMention(exclusions, mention), JSON.stringify(exclusions)).toBe(true);
    }
  });

  it("no longer finds the sentence once the quantity, the title or the unit changed, nor in empty limits", () => {
    const written = composeProvisionalQuantityMention(line(), choice)!;
    for (const changed of [line({ quantity: 12.5 }), line({ title: "Calorifuge des réseaux EF" }), line({ unit_code: "u" })]) {
      expect(hasProvisionalQuantityMention(written, composeProvisionalQuantityMention(changed, choice)!)).toBe(false);
    }
    expect(hasProvisionalQuantityMention(written.slice(0, -1), written)).toBe(false);
    expect(hasProvisionalQuantityMention(written.toUpperCase(), written)).toBe(false);
    for (const empty of [null, undefined, "", "  \n "]) expect(hasProvisionalQuantityMention(empty, written)).toBe(false);
  });

  it("appends the missing sentences after the text already written, once each", () => {
    const first = composeProvisionalQuantityMention(line(), choice)!;
    const second = composeProvisionalQuantityMention(line({ title: "Soudures", quantity: 40, unit_code: "u" }), choice)!;
    expect(appendProvisionalQuantityMentions(null, [first])).toBe(first);
    expect(appendProvisionalQuantityMentions("Néant.  \n", [first, second])).toBe(`Néant.\n\n${first}\n${second}`);
    const already = `Néant.\n${first.replace(/ /g, "  ")}`;
    expect(appendProvisionalQuantityMentions(already, [first, second])).toBe(`${already}\n\n${second}`);
    expect(appendProvisionalQuantityMentions(already, [first])).toBe(already);
  });

  it("keeps what the quantity rests on, and what confirms it, on one bounded line", () => {
    expect(normalizeProvisionalText("  le plan\n\tCVC \u00a0 indice B ")).toBe("le plan CVC indice B");
    expect(provisionalTextError("le plan CVC")).toBeNull();
    expect(provisionalTextError("é".repeat(PROVISIONAL_QUANTITY_TEXT.max))).toBeNull();
    for (const refused of ["", "  ", "ab", "é".repeat(PROVISIONAL_QUANTITY_TEXT.max + 1), "plan\u200b CVC", "plan\u202e CVC",
      "plan\u0007 CVC", "plan  CVC", " plan CVC", "plan\nCVC", "plan\u00a0CVC"]) {
      expect(provisionalTextError(refused), JSON.stringify(refused)).not.toBeNull();
    }
  });

  it("finds a sentence only where it begins: a title ending another title is not its sentence", () => {
    const tube = composeProvisionalQuantityMention(line({ title: "Tube" }), choice)!;
    const bigTube = composeProvisionalQuantityMention(line({ title: "Gros Tube" }), choice)!;
    expect(hasProvisionalQuantityMention(bigTube, tube)).toBe(false);
    expect(hasProvisionalQuantityMention(`Limites : ${bigTube}`, tube)).toBe(false);
    for (const written of [`${bigTube}\n${tube}`, `- ${tube}`, `Néant. ${tube}`, `Limites : ${tube}`, `• ${tube}`]) {
      expect(hasProvisionalQuantityMention(written, tube), written).toBe(true);
    }
  });

  it("counts the provisional sentences of the limits that match no current mention", () => {
    const now = composeProvisionalQuantityMention(line({ quantity: 14 }), choice)!;
    const before = composeProvisionalQuantityMention(line({ quantity: 12 }), choice)!;
    expect(countStaleProvisionalQuantityMentions(`Néant.\n${now}`, [now])).toBe(0);
    expect(countStaleProvisionalQuantityMentions(`${before}\n\n${now}`, [now])).toBe(1);
    expect(countStaleProvisionalQuantityMentions(`${before}\n${now}`, [])).toBe(2);
    expect(countStaleProvisionalQuantityMentions("Calorifuge non compris.", [now])).toBe(0);
    expect(countStaleProvisionalQuantityMentions(null, [now])).toBe(0);
  });

  it("plans the insertion within the limits text bound, and says how many characters are missing when it does not fit", () => {
    const long = { established_on: "é".repeat(160), to_confirm_by: "è".repeat(160) };
    const mentions = Array.from({ length: 14 }, (_, index) =>
      composeProvisionalQuantityMention(line({ title: `Ligne ${index + 1}` }), long)!);
    const fitting = planProvisionalQuantityMentions("Néant.", mentions.slice(0, 2));
    expect(fitting).toEqual({ text: `Néant.\n\n${mentions[0]}\n${mentions[1]}`, missing: mentions.slice(0, 2), overflow: 0 });
    const over = planProvisionalQuantityMentions("Néant.", mentions);
    const full = `Néant.\n\n${mentions.join("\n")}`;
    expect(over).toEqual({ text: full, missing: mentions, overflow: full.length - OFFER_LIMITS_MAX_LENGTH });
    expect(over.overflow).toBeGreaterThan(0);
    // Sentences already written take no new room.
    expect(planProvisionalQuantityMentions(`${mentions[0]}`, mentions.slice(0, 1))).toEqual({ text: mentions[0], missing: [], overflow: 0 });
    expect(provisionalMentionsOverflowMessage(1234, "insert")).toMatch(/^Les mentions à écrire ne tiennent pas .* il manque 1234 caractères\. Rien n'est inséré\./);
    expect(provisionalMentionsOverflowMessage(1, "send")).toMatch(/il manque 1 caractère sur 5000\./);
    for (const context of ["insert", "send"] as const) {
      const message = provisionalMentionsOverflowMessage(10, context);
      for (const issue of ["raccourcissez « Établie sur » et « À confirmer selon »", "allégez le reste des précisions",
        "retirez la déclaration des lignes dont la phrase manque"]) expect(message, context).toContain(issue);
    }
  });
});
