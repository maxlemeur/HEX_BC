import { describe, expect, it } from "vitest";

import { readItemKey, scoredUnit, type ItemKeyReading } from "@/lib/takeoff/bench/item-keys";

// Ways the deterministic reader of an extracted item's key (TI-660) could
// attach an item to the wrong key or lose it, written before the code. Every
// designation below is fictional:
// - a synonym is missed (« eau froide » for EF, « EU-EV » for the combined EUV),
//   or a combined code is split into two networks (EU/EV read as EU and EV);
// - a code is read inside a longer one (EC in ECS, EU in EUG, EV in « EVIER »);
// - a lowercase word is read as a short code: « ep » (épaisseur) as EP, « pe » as PEHD;
// - DN, Ø, outer x wall and an ID/OD pair of one tube resolve to different keys,
//   or a nominal DN of a copper tube is not its outer-diameter key;
// - an insulation thickness (« ép. 32 mm ») is read as a diameter;
// - two diameters on one item (a reducer) are read as one key;
// - an unknown DN is dropped and the item matches a key without DN;
// - a missing network or organ still yields a key; a missing material is guessed;
// - the fields are read out of order (category or evidence before designation),
//   or a scale « 1/50 » in the evidence becomes a diameter;
// - a generic « inox » wins over the grade printed next to it, or a material named
//   after the head noun (« calorifuge sur tube cuivre ») is read as the pipe;
// - « m² » is read as metres (normalizeUnit turns it into « m »), a piece count
//   is not read as u, or an unscored unit (« ens ») enters the score;
// - an insulation surface in m² is read as a room, a room under the 0.8
//   similarity is attached anyway, or a tie between two rooms picks one;
// - two networks on one item (« EF/ECS ») pick one, or make unreadable a count,
//   which is scored without its network.
// Found in review, written before its fix:
// - an inch size (« 3/4" », « 1"1/4 », « 2" ») loses its mark, matches no entry
//   and is dropped, so the item gets a key without DN; an inch size the table
//   does not have is dropped too instead of unreadable; a fraction without inch
//   mark (« 1/4 de tour ») is read as a size.
// Found by the first real run, written before its fix:
// - a room designation with the qualifier the level C answer adds (« Sellerie —
//   aire relevée », « Sellerie, aile nord — … ») is compared whole with the
//   room labels and read as no room;
// - the label the evidence quotes from the plan (« Local vélos 14.30 m² »)
//   is compared with its printed area and the placement words around the quote,
//   so it matches nothing, or the neighbouring room the placement names;
// - a qualifier after the head of the designation (« Remise, serre tropicale »)
//   attaches the item to the room the qualifier names;
// - a quote that holds only an area (« 5.80m² ») is read as a room, or hides
//   the label quoted next to it.
// Found in the third review, written before their fix:
// - the quote that closes a quoted designation or evidence right after its DN
//   (« "EF cuivre DN 22" », « “EF cuivre DN 22” », « Vanne "DN 20" ») is read
//   as an inch size no series has, so a right reading is unreadable;
// - an insulation surface in m² without network (« Calorifuge sur tube cuivre
//   DN 22 ») is read as a room, even in a scope without room, so it can never
//   be the insulation key it may be, as the same item in ml is;
// - a room surface whose category or evidence names a network (« voisin de la
//   gaine EP », « près du poste incendie »), or whose label holds a network
//   word (« Local sprinkler »), is read as an insulation of that network;
// - a qualifier after a spaced hyphen (« Sellerie - aire relevée ») is compared
//   with the room labels, so the room is not read, or the head is cut inside a
//   hyphenated label (« Sellerie-forge »).
// Found in the fourth review, written before their fix:
// - an inch mark inside a straight-quoted text (« "Vanne 3/4" EF" »,
//   « "Vanne 1"1/4 EF" », « "Vanne 3/4"" »), or written ” inside a curly one
//   (« “Vanne 3/4” EF” »), is taken for the closing quote and dropped, so the
//   size is lost and the item gets a key without DN;
// - a room label that holds a spaced hyphen (« Atelier - reliure ») loses its
//   head at the hyphen: with a comma qualifier the room is not read, and when
//   another label is the part before the hyphen (« Atelier »), the item goes to
//   that room;
// - an m2 item whose room is not read, in a scope with rooms, is read as an
//   insulation because only its category or evidence names the calorifuge
//   material or a network nearby (« près de la gaine calo », « près du poste
//   incendie »), so its missed room cannot be the key it may be.
// Found in the fifth review, written before its fix:
// - the quote closing a label that ends in a whole inch size (« "Box 2" »,
//   « “Box 2” ») is read as an inch mark whenever another quoted text follows
//   in the field, so the item gets a 2-inch DN that was never printed.

function read(designation: string, unit = "ml", extra: { category?: string; evidence?: string; rooms?: string[] } = {}) {
  return readItemKey({ designation, unit, category: extra.category, evidence: extra.evidence }, { rooms: extra.rooms ?? [] });
}

function key(reading: ItemKeyReading) {
  if (reading.status !== "read") throw new Error(`expected a key, got ${JSON.stringify(reading)}`);
  const { dn, ...rest } = reading.key;
  return { ...rest, dn: dn === null ? null : dn.entries.map((entry) => `${entry.family}:${entry.od_mm}`).sort() };
}

describe("takeoff bench item key reader", () => {
  it("reads network synonyms and combined codes as one network", () => {
    expect(key(read("Tube eau froide cuivre DN 22")).network).toBe("EF");
    expect(key(read("EF - Cuivre DN 22")).network).toBe("EF");
    for (const printed of ["EU/EV PVC DN 100", "EU-EV PVC DN 100", "EU / EV PVC DN 100"]) {
      expect(key(read(printed)).network).toBe("EUV");
    }
    expect(key(read("Bouclage ECS cuivre DN 18")).network).toBe("RECS");
    expect(key(read("ECS cuivre DN 18")).network).toBe("ECS");
    expect(key(read("EUG fonte DN 100")).network).toBe("EUG");
  });

  it("never reads a code inside a longer word or a lowercase abbreviation", () => {
    expect(read("Calorifuge ep 19 mm, cuivre DN 22")).toMatchObject({ status: "unreadable", reason: "network_missing" });
    expect(key(read("EV tube pe DN 110"))).toMatchObject({ network: "EV", material: null });
    expect(read("Évacuation EVIER PVC DN 40")).toMatchObject({ status: "unreadable", reason: "network_missing" });
    expect(key(read("EVIER inox", "u"))).toMatchObject({ kind: "count", organ: "evier", material: "inox" });
  });

  it("resolves DN, Ø, outer x wall and an ID/OD pair of one tube to one diameter", () => {
    const printed = ["EF cuivre DN 22", "EF cuivre Ø22", "EF cuivre 22x1,0", "EF cuivre 20/22", "EF cuivre DN 20"];
    const keys = printed.map((designation) => key(read(designation)).dn);
    for (const dn of keys) expect(dn).toEqual(["cuivre:22"]);
    expect(key(read("ECS inox 316L 22x1,2")).dn).toEqual(["inox-sertir:22"]);
  });

  it("does not read an insulation thickness as a diameter", () => {
    // An insulation follows the pipe it wraps (any series), so the 22 is read on every series; a 32 would make it two DN.
    expect(key(read("Calorifuge ép. 32 mm EF cuivre DN 22")).dn).toContain("cuivre:22");
    expect(key(read("Calorifuge ép. 32 mm EF")).dn).toBeNull();
  });

  it("refuses two diameters on one item and an unknown DN", () => {
    expect(read("Réduction EF cuivre DN 22 / DN 28", "u")).toMatchObject({ status: "unreadable" });
    expect(read("EF cuivre DN 22 et DN 28")).toMatchObject({ status: "unreadable", reason: "dn_ambiguous" });
    expect(read("EF cuivre DN 23")).toMatchObject({ status: "unreadable", reason: "dn_unknown" });
  });

  it("reads an inch size with its mark, refuses an unknown one, and never reads a plain fraction as a size", () => {
    for (const printed of ["Vanne 3/4\"", "Vanne 3/4''", "Vanne 3/4 pouce", "Vanne 3/4”"]) {
      expect(key(read(printed, "u"))).toMatchObject({ kind: "count", organ: "vanne", dn: ["acier:26.9"] });
    }
    expect(key(read("Robinet de puisage 1/2\"", "u"))).toMatchObject({ organ: "robinet-puisage", dn: ["acier:21.3"] });
    for (const printed of ["Vanne 1\"1/4", "Vanne 1\" 1/4", "Vanne 1 1/4\""]) expect(key(read(printed, "u")).dn).toEqual(["acier:42.4"]);
    expect(key(read("Vanne 2\"", "u")).dn).toEqual(["acier:60.3"]);
    expect(read("Vanne 7/8\"", "u")).toMatchObject({ status: "unreadable", reason: "dn_unknown" });
    expect(key(read("Vanne 1/4 de tour EF DN 15", "u")).dn).toEqual(key(read("Vanne EF DN 15", "u")).dn);
    expect(key(read("Vanne DN 20 \"EF\"", "u")).dn).toEqual(key(read("Vanne DN 20", "u")).dn);
  });

  it("refuses a pipe without network or a count without organ, and keeps a missing material null", () => {
    expect(read("Tube cuivre DN 22")).toMatchObject({ status: "unreadable", reason: "network_missing" });
    expect(read("Accessoire EF DN 20", "u")).toMatchObject({ status: "unreadable", reason: "organ_missing" });
    expect(key(read("EF DN 22"))).toMatchObject({ kind: "network", network: "EF", material: null, dn: expect.any(Array) });
    expect(key(read("Vanne d'arrêt EF DN 20", "u"))).toMatchObject({ kind: "count", organ: "vanne" });
  });

  it("reads designation, then category, then evidence, attribute by attribute", () => {
    expect(key(read("ECS cuivre DN 22", "ml", { category: "EF" })).network).toBe("ECS");
    expect(key(read("Tube cuivre", "ml", { category: "Réseau EF", evidence: "Libellé ECS DN 28 page 2" })))
      .toMatchObject({ network: "EF", dn: ["cuivre:28"] });
    expect(key(read("EF cuivre", "ml", { evidence: "Plan 1/50, libellé cuivre" })).dn).toBeNull();
  });

  it("keeps the printed grade of a stainless tube and the head noun of the designation", () => {
    expect(key(read("EF inox DN 22 (316L)")).material).toBe("inox-316l");
    expect(key(read("Calorifuge sur tube cuivre EF DN 22")).material).toBe("calorifuge");
    expect(key(read("Tube cuivre calorifugé EF DN 22")).material).toBe("cuivre");
  });

  it("maps units to ml, m2 and u only", () => {
    expect(scoredUnit("m²")).toBe("m2");
    expect(scoredUnit("M2")).toBe("m2");
    expect(scoredUnit("m")).toBe("ml");
    expect(scoredUnit("ml")).toBe("ml");
    for (const unit of ["u", "U", "pce", "pièce", "pcs"]) expect(scoredUnit(unit)).toBe("u");
    for (const unit of ["ens", "forfait", "kg", "unité"]) expect(scoredUnit(unit)).toBeNull();
    expect(read("EF cuivre DN 22", "ens")).toEqual({ status: "out_of_score", unit: "ens" });
  });

  it("reads a surface in m² as an insulation surface with a network, as a room otherwise", () => {
    const rooms = ["Sellerie", "Salle des cartes", "Labo photo"];
    expect(key(read("Calorifuge EF cuivre DN 22", "m²", { rooms }))).toMatchObject({ kind: "network", unit: "m2", material: "calorifuge" });
    expect(key(read("Salle des cartes", "m²", { rooms }))).toMatchObject({ kind: "surface", room: "Salle des cartes" });
    expect(read("Aire sellerie côté cour", "m²", { rooms })).toMatchObject({ status: "unreadable", reason: "room_missing" });
    expect(read("Sellerie", "m2", { rooms: ["Sellerie", "SELLERIE"] })).toMatchObject({ status: "unreadable", reason: "room_ambiguous" });
  });

  const labels = ["Sellerie", "Sellerie annexe", "Sellerie-forge", "Salle des cartes", "Local vélos", "Serre tropicale", "dgt. 4", "Volière"];
  const surface = (designation: string, evidence?: string) => read(designation, "m²", { rooms: labels, category: "Aire de pièce", evidence });

  it("reads a room in the head of the designation, then in the labels the evidence quotes, without their printed area", () => {
    expect(key(surface("Sellerie — aire relevée")).room).toBe("Sellerie");
    expect(key(surface("Sellerie, aile nord — aire relevée")).room).toBe("Sellerie");
    expect(key(surface("Sellerie annexe — aire relevée")).room).toBe("Sellerie annexe");
    expect(key(surface("Salle des cartes 27.60 m² — aire relevée")).room).toBe("Salle des cartes");
    // The plan prints another spelling than the designation: the quoted label decides, never the placement words.
    expect(key(surface("Vélos — aire relevée", "À gauche de la salle des cartes : « Local vélos 14.30 m² ».")).room).toBe("Local vélos");
    expect(key(surface("Dégagement 4 — aire reportée", "Mention « 5.80m² » au-dessus de « dgt. 4 ».")).room).toBe("dgt. 4");
    expect(surface("Pièce — aire relevée", "À droite de la volière : « 7.70m² ».")).toMatchObject({ status: "unreadable", reason: "room_missing" });
    // A qualifier names where the room is, not which room it is.
    expect(surface("Remise, serre tropicale — aire relevée", "Sous la volière : « RMS 9.40m² ».")).toMatchObject({ status: "unreadable", reason: "room_missing" });
  });

  it("cuts the head of a room designation at a spaced hyphen, never inside a hyphenated label", () => {
    expect(key(surface("Sellerie - aire relevée")).room).toBe("Sellerie");
    expect(key(surface("Salle des cartes - aile nord, rez-de-chaussée")).room).toBe("Salle des cartes");
    expect(key(surface("Sellerie-forge - aire relevée")).room).toBe("Sellerie-forge");
    expect(key(surface("Sellerie-forge — aire relevée")).room).toBe("Sellerie-forge");
  });

  it("keeps the head of a room label that holds a spaced hyphen, cutting at the hyphen only when nothing else matches", () => {
    const hyphenated = (designation: string) => read(designation, "m²", { rooms: ["Atelier - reliure", "Atelier", "Verrière - vitraux"] });
    expect(key(hyphenated("Atelier - reliure — aire relevée")).room).toBe("Atelier - reliure");
    expect(key(hyphenated("Atelier — aire relevée")).room).toBe("Atelier");
    expect(key(hyphenated("Atelier - reliure, aile nord — aire relevée")).room).toBe("Atelier - reliure");
    expect(key(hyphenated("Verrière - vitraux, aile est — aire relevée")).room).toBe("Verrière - vitraux");
    // A qualifier after a spaced hyphen: the longest text before a hyphen that matches a label decides.
    expect(key(hyphenated("Verrière - vitraux - aile est")).room).toBe("Verrière - vitraux");
    expect(key(hyphenated("Atelier - reliure - aile est")).room).toBe("Atelier - reliure");
    expect(key(hyphenated("Atelier - aile est - côté cour")).room).toBe("Atelier");
  });

  it("never reads the quote that closes a quoted designation or evidence as an inch mark", () => {
    for (const evidence of ["Texte \"EF cuivre DN 22\"", "Texte “EF cuivre DN 22”", "Texte « EF cuivre DN 22 »"]) {
      expect(key(read("Tube EF cuivre", "ml", { evidence })).dn).toEqual(["cuivre:22"]);
    }
    expect(key(read("Tube \"EF cuivre DN 22\", repère 4")).dn).toEqual(["cuivre:22"]);
    expect(key(read("EF \"cuivre Ø22\"")).dn).toEqual(["cuivre:22"]);
    expect(key(read("Vanne \"DN 20\"", "u")).dn).toEqual(key(read("Vanne DN 20", "u")).dn);
    // A real inch mark still reads, next to a quoted label or inside a curly quote.
    expect(key(read("Vanne 1/2\" \"EF\"", "u")).dn).toEqual(["acier:21.3"]);
    expect(key(read("Repère “Vanne 3/4\"”", "u")).dn).toEqual(["acier:26.9"]);
    expect(key(read("Vanne \"EF\" 1\"1/4", "u")).dn).toEqual(["acier:42.4"]);
  });

  it("keeps an inch mark inside a quoted text an inch mark, the text closing at the next quote", () => {
    for (const evidence of ["Texte \"Vanne 3/4\" EF\" sur le plan", "Texte \"Vanne 3/4\"\" sur le plan", "Texte “Vanne 3/4” EF” sur le plan", "Texte “Vanne 3/4”” sur le plan"]) {
      expect(key(read("Vanne", "u", { evidence })).dn).toEqual(["acier:26.9"]);
    }
    expect(key(read("Vanne", "u", { evidence: "Texte \"Vanne 1\"1/4 EF\" sur le plan" })).dn).toEqual(["acier:42.4"]);
    expect(key(read("Vanne", "u", { evidence: "Texte \"Vanne 2\" EF\" sur le plan" })).dn).toEqual(["acier:60.3"]);
    // After a DN, a Ø, a scale or a whole number the text does not close after, the quote closes the text.
    expect(key(read("Tube EF", "ml", { evidence: "Texte \"EF cuivre DN 22\" puis \"repère 4\"" })).dn).toEqual(["cuivre:22"]);
    expect(key(read("Tube EF", "ml", { evidence: "Texte “EF cuivre Ø22” puis “repère 4”" })).dn).toEqual(["cuivre:22"]);
    expect(key(read("Tube EF", "ml", { evidence: "Texte \"EF cuivre DN 22\", cartouche \"échelle 1/50\"" })).dn).toEqual(["cuivre:22"]);
  });

  it("closes a quoted label ending in a whole number before the next quoted text, never reading it as an inch size", () => {
    // The quote after « 2 » closes the label: the later quotes open and close another text.
    for (const evidence of ["Symbole \"Box 2\", près de la \"gaine\"", "Symbole “Box 2” près de “Box 3”", "Symbole \"Box 2\" et \"Box 3\""]) {
      expect(key(read("Lavabo", "u", { evidence })).dn).toBeNull();
    }
    // A text that still closes after the mark keeps it an inch mark, even with another quoted text after it.
    expect(key(read("Vanne", "u", { evidence: "Texte \"Vanne 2\" EF\" près de la \"gaine\"" })).dn).toEqual(["acier:60.3"]);
    expect(key(read("Vanne", "u", { evidence: "Texte “Vanne 2” EF” près de “Box 3”" })).dn).toEqual(["acier:60.3"]);
  });

  it("reads an insulation surface in m² without network as an insulation whose network is missing, rooms or not", () => {
    for (const scopeRooms of [[], ["Sellerie"]]) {
      expect(read("Calorifuge sur tube cuivre DN 22", "m²", { rooms: scopeRooms })).toMatchObject({
        status: "unreadable", reason: "network_missing", key: { kind: "network", unit: "m2", material: "calorifuge", network: null },
      });
    }
  });

  it("keeps a room it reads a surface when another field names a network, unless an insulation names its network first", () => {
    for (const evidence of ["Texte « Labo photo 14.30 m² », voisin de la gaine EP", "Texte « Labo photo 14.30 m² » près du poste incendie"]) {
      expect(key(read("Labo photo — aire relevée", "m²", { rooms: ["Labo photo"], evidence }))).toMatchObject({ kind: "surface", room: "Labo photo", network: null });
    }
    expect(key(read("Labo photo — aire relevée", "m²", { rooms: ["Labo photo"], category: "Réseau incendie" }))).toMatchObject({ kind: "surface", room: "Labo photo" });
    expect(key(read("Local sprinkler", "m²", { rooms: ["Local sprinkler"] }))).toMatchObject({ kind: "surface", room: "Local sprinkler" });
    expect(key(read("Gaine EP", "m²", { rooms: ["Labo photo"], evidence: "« Labo photo 14.30 m² »" }))).toMatchObject({ kind: "surface", room: "Labo photo" });
    // An insulation that names its network before the room it runs through is the insulation of that network.
    expect(key(read("Calorifuge EF cuivre DN 22", "m²", { rooms: ["Labo photo"], evidence: "Texte « Labo photo »" })))
      .toMatchObject({ kind: "network", network: "EF", material: "calorifuge", room: null });
  });

  it("leaves an m2 item whose room is not read a room surface when only its category or evidence names an insulation or a network", () => {
    const scopeRooms = ["Volière", "Préau"];
    const unreadRoom = { status: "unreadable", reason: "room_missing", key: { kind: "surface", network: null } };
    for (const evidence of ["Texte « 7.70m² » près de la gaine calo", "Texte « 7.70m² » sous la trappe isolation", "Texte « 7.70m² » près du poste incendie"]) {
      expect(read("Pièce — aire relevée", "m²", { rooms: scopeRooms, evidence })).toMatchObject(unreadRoom);
    }
    expect(read("Pièce — aire relevée", "m²", { rooms: scopeRooms, category: "Réseau EF", evidence: "Texte « 7.70m² »" })).toMatchObject(unreadRoom);
    // In the designation, or in a scope without room, they make it an insulation.
    expect(read("Calorifuge — aire relevée", "m²", { rooms: scopeRooms, evidence: "Texte « 7.70m² »" }))
      .toMatchObject({ status: "unreadable", reason: "network_missing", key: { kind: "network", material: "calorifuge" } });
    expect(key(read("Calorifuge EF", "m²", { rooms: scopeRooms }))).toMatchObject({ kind: "network", network: "EF", material: "calorifuge" });
    expect(key(read("Pièce — aire relevée", "m²", { evidence: "Texte « 7.70m² » près du poste incendie" }))).toMatchObject({ kind: "network", network: "RIA" });
  });

  it("refuses two networks on a length, not on a count", () => {
    expect(read("EF/ECS cuivre DN 22")).toMatchObject({ status: "unreadable", reason: "network_ambiguous" });
    expect(key(read("Vanne EF/ECS DN 20", "u"))).toMatchObject({ kind: "count", organ: "vanne", network: null });
  });
});
