import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";

// Two fictional zone plans of one level for the TI-664 journeys, built here so
// that their reading is known exactly. Both are A3 landscape sheets at 1/50
// (« Echelle 1/50 », « Format A3 »: the scale is « format ») showing one
// building: a MURS layer of 24 walls and four rooms printed once, the Z2 sheet
// framing the building 4 m further right than the Z1 sheet (the title block
// stays at its sheet place on both). An EF layer draws, on Z1, a run from 6 m to
// 11 m of the building (5.00 m) and, on Z2, a run from 10 m to 13 m (3.00 m),
// both labelled « EF - Inox 316L DN 22 » at 9 m height: the stretch from 10 m
// to 11 m (1.00 m) is drawn on both sheets. Codes and names are generic;
// nothing comes from a real plan.

export const ZONE_PLANS = {
  pageSize: [1190.55, 841.89] as [number, number],
  denominator: 50,
  /** The Z2 sheet starts this far right along the building (metres). */
  shift_m: 4,
  zones: {
    Z1: { fileName: "plan-zones-R+1-Z1.pdf", run: [6, 11] as const, length_m: 5 },
    Z2: { fileName: "plan-zones-R+1-Z2.pdf", run: [10, 13] as const, length_m: 3 },
  },
  designation: "EF Inox 316L DN 22",
  label: "EF - Inox 316L DN 22",
  overlap_m: 1,
  rooms: ["Bureau 101", "Salle de reunion", "Local technique", "Archives"],
} as const;

const POINTS_PER_MM = 72 / 25.4;
/** Sheet points per building metre at 1/50 (20 mm). */
const POINTS_PER_M = (1000 / ZONE_PLANS.denominator) * POINTS_PER_MM;
const MARGIN_PT = 60;

export async function buildZonePlanPdf(zone: keyof typeof ZONE_PLANS.zones, revision?: "A" | "B") {
  const doc = await PDFDocument.create();
  doc.setTitle(`ARMY fictional zone plan ${zone}`);
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const layers = ["RES_EF", "MURS"].map((name) => doc.context.register(doc.context.obj({ Type: "OCG", Name: PDFString.of(name) })));
  doc.catalog.set(PDFName.of("OCProperties"), doc.context.obj({ OCGs: layers, D: { Order: layers, ON: layers } }));
  const origin = zone === "Z1" ? 0 : ZONE_PLANS.shift_m;
  const x = (metres: number) => (MARGIN_PT + (metres - origin) * POINTS_PER_M).toFixed(3);
  const y = (metres: number) => (MARGIN_PT + metres * POINTS_PER_M).toFixed(3);
  const text = (str: string, px: string | number, py: string | number, size: number) => `BT /F1 ${size} Tf ${px} ${py} Td (${str}) Tj ET`;
  const content = ["0 g"];
  const run = zone === "Z2" && revision === "A" ? [11, 13] : ZONE_PLANS.zones[zone].run;
  content.push("/OC /oc0 BDC", "0 0 1 RG 1 w", `${x(run[0])} ${y(9)} m ${x(run[1])} ${y(9)} l S`,
    text(ZONE_PLANS.label, (Number(x(run[0])) + 20).toFixed(3), (Number(y(9)) + 3).toFixed(3), 6), "EMC");
  // The building, inside what both sheets show (4 m to 12 m): walls of 1 to 6 m, every 25 cm from 1 m to 6.75 m high.
  const walls: string[] = [];
  for (let index = 0; index < 24; index += 1) {
    const start = 4.5 + (index % 3) * 0.5;
    walls.push(`${x(start)} ${y(1 + index * 0.25)} m ${x(start + 1 + (index % 6))} ${y(1 + index * 0.25)} l S`);
  }
  content.push("/OC /oc1 BDC", "0.5 G 0.5 w", ...walls,
    ...ZONE_PLANS.rooms.map((room, index) => text(room, x(5 + index * 1.5), y(2 + index * 1.2), 6)), "EMC");
  content.push(text("Echelle 1/50", 950, 80, 10), text("Format A3", 950, 62, 10), text(`Plan R+1 ${zone}`, 950, 44, 10));
  if (revision) content.push(text(`Indice ${revision}`, 950, 26, 10));
  if (zone === "Z1" && revision) content.push(text("Fiche atelier A-07 : 2 soudures (u)", 700, 26, 8));
  const page = doc.addPage(ZONE_PLANS.pageSize);
  page.node.set(PDFName.of("Resources"), doc.context.obj({
    Font: doc.context.obj({ F1: font.ref }),
    Properties: doc.context.obj(Object.fromEntries(layers.map((layer, index) => [`oc${index}`, layer]))),
  }));
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(content.join("\n"))));
  return doc.save({ useObjectStreams: false });
}
