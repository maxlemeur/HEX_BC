import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";

// A fictional vector plan for the TI-662 journey (TKW08), built here so that its
// expected reading is known exactly: one A3 landscape page labelled « Echelle
// 1/50 » and « Format A3 » (no cote: the scale is « format »), an EF layer with
// a 100 mm pipe (5.00 m at 1/50) labelled « EF - PER DN 16 », and an EU/EV layer
// with a 60 mm pipe (3.00 m) labelled « EU/EV - PVC DN 40 ». No frame encloses
// the pipes (a dark rectangle around networks alone is a detail frame and is
// not measured). Codes are generic; nothing comes from a real plan.

export const VECTOR_PLAN = {
  pageSize: [1190.55, 841.89] as [number, number],
  denominator: 50,
  networks: [
    { layer: "RES_EF", network: "EF", designation: "EF PER DN 16", length_m: 5, sheet_mm: 100, y: 500, label: "EF - PER DN 16" },
    { layer: "RES_EU-EV", network: "EUV", designation: "EU/EV PVC DN 40", length_m: 3, sheet_mm: 60, y: 300, label: "EU/EV - PVC DN 40" },
  ],
} as const;

const POINTS_PER_MM = 72 / 25.4;

export async function buildVectorPlanPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle("ARMY fictional vector plan");
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const layers = VECTOR_PLAN.networks.map((entry) => doc.context.register(doc.context.obj({ Type: "OCG", Name: PDFString.of(entry.layer) })));
  doc.catalog.set(PDFName.of("OCProperties"), doc.context.obj({ OCGs: layers, D: { Order: layers, ON: layers } }));
  const text = (str: string, x: number, y: number, size: number) => `BT /F1 ${size} Tf ${x} ${y} Td (${str}) Tj ET`;
  const content = ["0 g"];
  VECTOR_PLAN.networks.forEach((entry, index) => {
    const x0 = 200;
    const x1 = x0 + entry.sheet_mm * POINTS_PER_MM;
    content.push(`/OC /oc${index} BDC`, "0 0 1 RG 1 w", `${x0} ${entry.y} m ${x1.toFixed(3)} ${entry.y} l S`, text(entry.label, x0 + 30, entry.y + 3, 6), "EMC");
  });
  content.push(text("Echelle 1/50", 950, 80, 10), text("Format A3", 950, 62, 10));
  const page = doc.addPage(VECTOR_PLAN.pageSize);
  page.node.set(PDFName.of("Resources"), doc.context.obj({
    Font: doc.context.obj({ F1: font.ref }),
    Properties: doc.context.obj(Object.fromEntries(layers.map((layer, index) => [`oc${index}`, layer]))),
  }));
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(content.join("\n"))));
  return doc.save({ useObjectStreams: false });
}
