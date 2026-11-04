import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";

// A fictional vector plan for the TI-662 journeys (TKW08, TKW09), built here so
// that its expected reading is known exactly: one A3 landscape page labelled
// « Echelle 1/50 » and « Format A3 » (no cote: the scale is « format »), an EF
// layer with a 100 mm pipe (5.00 m at 1/50) labelled « EF - PER DN 16 », an
// EU/EV layer with a 60 mm pipe (3.00 m) labelled « EU/EV - PVC DN 40 », and a
// MURS layer with a closed 80 × 70 mm room (4.00 × 3.50 m = 14.00 m²) printed
// « Local fictif 13.80 m2 »: its measure is the polygon's area, the printed
// surface its control. No frame encloses the pipes (a dark rectangle around
// networks alone is a detail frame and is not measured), and the room holds
// none. Without its printed scale (TKW09), only a confirmed calibration gives
// the page a scale. With `decisionsLayer` (TKW10), a fourth layer FICTIF_RESEAU_2
// holds a red 80 mm pipe (4.00 m) that no keyword, legend nor label names: the
// only group Decisions is asked about. Codes are generic; nothing comes from a
// real plan.

export const VECTOR_PLAN = {
  pageSize: [1190.55, 841.89] as [number, number],
  denominator: 50,
  networks: [
    { layer: "RES_EF", network: "EF", designation: "EF PER DN 16", length_m: 5, sheet_mm: 100, y: 500, label: "EF - PER DN 16" },
    { layer: "RES_EU-EV", network: "EUV", designation: "EU/EV PVC DN 40", length_m: 3, sheet_mm: 60, y: 300, label: "EU/EV - PVC DN 40" },
  ],
  /** Only with `decisionsLayer`: no keyword, colour of its own, no label within reach; Decisions names it. */
  decisions: { layer: "FICTIF_RESEAU_2", length_m: 4, sheet_mm: 80, y: 150 },
  /** Lower-left corner (x, y) in PDF points, y up; the label inside, away from the walls. */
  room: { layer: "MURS", room: "Local fictif", designation: "Surface « Local fictif »", area_m2: 14, printed_m2: 13.8, x: 650, y: 400,
    width_mm: 80, height_mm: 70, label: "Local fictif 13.80 m2" },
} as const;

const POINTS_PER_MM = 72 / 25.4;

export async function buildVectorPlanPdf({ printedScale = true, decisionsLayer = false }: { printedScale?: boolean; decisionsLayer?: boolean } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle("ARMY fictional vector plan");
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const layers = [...VECTOR_PLAN.networks.map((entry) => entry.layer), VECTOR_PLAN.room.layer, ...(decisionsLayer ? [VECTOR_PLAN.decisions.layer] : [])]
    .map((name) => doc.context.register(doc.context.obj({ Type: "OCG", Name: PDFString.of(name) })));
  doc.catalog.set(PDFName.of("OCProperties"), doc.context.obj({ OCGs: layers, D: { Order: layers, ON: layers } }));
  const text = (str: string, x: number, y: number, size: number) => `BT /F1 ${size} Tf ${x} ${y} Td (${str}) Tj ET`;
  const content = ["0 g"];
  VECTOR_PLAN.networks.forEach((entry, index) => {
    const x0 = 200;
    const x1 = x0 + entry.sheet_mm * POINTS_PER_MM;
    content.push(`/OC /oc${index} BDC`, "0 0 1 RG 1 w", `${x0} ${entry.y} m ${x1.toFixed(3)} ${entry.y} l S`, text(entry.label, x0 + 30, entry.y + 3, 6), "EMC");
  });
  const { room } = VECTOR_PLAN;
  content.push(`/OC /oc${VECTOR_PLAN.networks.length} BDC`, "0 G 0.5 w",
    `${room.x} ${room.y} ${(room.width_mm * POINTS_PER_MM).toFixed(3)} ${(room.height_mm * POINTS_PER_MM).toFixed(3)} re S`,
    text(room.label, room.x + 40, room.y + 100, 8), "EMC");
  if (decisionsLayer) {
    const { decisions } = VECTOR_PLAN;
    content.push(`/OC /oc${VECTOR_PLAN.networks.length + 1} BDC`, "0.8 0 0 RG 1 w",
      `200 ${decisions.y} m ${(200 + decisions.sheet_mm * POINTS_PER_MM).toFixed(3)} ${decisions.y} l S`, "EMC");
  }
  if (printedScale) content.push(text("Echelle 1/50", 950, 80, 10));
  content.push(text("Format A3", 950, 62, 10));
  const page = doc.addPage(VECTOR_PLAN.pageSize);
  page.node.set(PDFName.of("Resources"), doc.context.obj({
    Font: doc.context.obj({ F1: font.ref }),
    Properties: doc.context.obj(Object.fromEntries(layers.map((layer, index) => [`oc${index}`, layer]))),
  }));
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(content.join("\n"))));
  return doc.save({ useObjectStreams: false });
}
