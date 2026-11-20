import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";

// A fictional layered plan for the lab's vectors page (TI-662 L3c, VEC01),
// built with pdf-lib's low-level optional content so that its reading is known
// exactly: the catalog's OCProperties (OCGs, default configuration D), the
// page's Resources /Properties and each stroke inside « /OC /ocN BDC … EMC »
// (BMC alone names no layer). One A4 landscape page:
// - « ECHELLE 1/50 » in the cartouche;
// - layer FICTIF_COTE (keyword « COTE » → cotation, never asked to Decisions):
//   a 100 mm dimension line with its two end ticks, labelled « 5,00 » above
//   it, which verifies the 1/50 scale (5,00 m);
// - layer FICTIF_EF (keyword « EF »): one 100 mm stroke, 5,00 m at 1/50;
// - layer FICTIF_RESEAU_2 (no keyword: left to Decisions): one 60 mm stroke,
//   3,00 m at 1/50 once classified as a network.
// Nothing else is stroked (texts are filled). Layer names and values are
// fictional; nothing comes from a real plan.

const POINTS_PER_MM = 72 / 25.4;

export const LAB_VECTOR_PLAN = {
  pageSize: [841.89, 595.28] as [number, number],
  denominator: 50,
  cote: { layer: "FICTIF_COTE", sheet_mm: 100, label: "5,00", x: 100, y: 120 },
  keyword: { layer: "FICTIF_EF", network: "EF", sheet_mm: 100, length_m: 5, x: 100, y: 420 },
  decisions: { layer: "FICTIF_RESEAU_2", network: "EU", sheet_mm: 60, length_m: 3, x: 100, y: 280 },
} as const;

export async function buildLabVectorPlanPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle("ARMY fictional layered plan");
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const { cote, keyword, decisions } = LAB_VECTOR_PLAN;
  const layers = [cote.layer, keyword.layer, decisions.layer]
    .map((name) => doc.context.register(doc.context.obj({ Type: "OCG", Name: PDFString.of(name) })));
  doc.catalog.set(PDFName.of("OCProperties"), doc.context.obj({ OCGs: layers, D: { Order: layers, ON: layers } }));
  const text = (str: string, x: number, y: number, size: number) => `0 g BT /F1 ${size} Tf ${x.toFixed(3)} ${y.toFixed(3)} Td (${str}) Tj ET`;
  const end = (entry: { x: number; sheet_mm: number }) => (entry.x + entry.sheet_mm * POINTS_PER_MM).toFixed(3);
  const content = [
    // The dimension line, its two ticks across its ends, and its value centred 3 pt above it.
    "/OC /oc0 BDC", "0 G 0.5 w", `${cote.x} ${cote.y} m ${end(cote)} ${cote.y} l S`,
    `${cote.x} ${cote.y - 6} m ${cote.x} ${cote.y + 6} l S`, `${end(cote)} ${cote.y - 6} m ${end(cote)} ${cote.y + 6} l S`,
    text(cote.label, cote.x + (cote.sheet_mm * POINTS_PER_MM) / 2 - 10, cote.y + 3, 10), "EMC",
    "/OC /oc1 BDC", "0 0 1 RG 1 w", `${keyword.x} ${keyword.y} m ${end(keyword)} ${keyword.y} l S`, "EMC",
    "/OC /oc2 BDC", "0.8 0 0 RG 1 w", `${decisions.x} ${decisions.y} m ${end(decisions)} ${decisions.y} l S`, "EMC",
    text("ECHELLE 1/50", 640, 60, 10),
  ];
  const page = doc.addPage(LAB_VECTOR_PLAN.pageSize);
  page.node.set(PDFName.of("Resources"), doc.context.obj({
    Font: doc.context.obj({ F1: font.ref }),
    Properties: doc.context.obj(Object.fromEntries(layers.map((layer, index) => [`oc${index}`, layer]))),
  }));
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(content.join("\n"))));
  return doc.save({ useObjectStreams: false });
}
