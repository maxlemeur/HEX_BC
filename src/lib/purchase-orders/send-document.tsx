import "server-only";

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { COMPANY_INFO } from "@/lib/company-info";
import { BUSINESS_DOCUMENT_THEME } from "@/lib/documents/document-theme";
import { formatEUR } from "@/lib/money";
import { PURCHASE_ORDER_DELIVERY_MODE_LABELS, type PurchaseOrderDeliveryMode, type PurchaseOrderLineKind } from "@/lib/purchase-orders/line-kinds";
import { formatOrderQuantity } from "@/lib/purchase-orders/quantities";

/**
 * The purchase order as the supplier receives it, attached to its e-mail: what the printed order says (issuer,
 * supplier, delivery, lines with the price for their lot, totals, instructions) and nothing of ours (no request
 * link, no imputation). The amounts are the stored ones: nothing is computed here.
 */
export type PurchaseOrderPdfData = {
  reference: string;
  /** AAAA-MM-JJ. */
  orderDate: string;
  /** AAAA-MM-JJ, « TBD » for a delivery still to be determined, or nothing. */
  expectedDeliveryDate: string | null;
  notes: string | null;
  issuer: { name: string; role: string | null; phone: string | null; email: string | null };
  supplier: {
    name: string; address: string | null; postalCode: string | null; city: string | null;
    contactName: string | null; phone: string | null; email: string | null;
  };
  /** Where it is delivered: a site, or the affaire of an order made from a material request. */
  deliverySite: {
    name: string; projectCode: string | null; address: string | null; postalCode: string | null; city: string | null;
    contactName: string | null; contactPhone: string | null;
  } | null;
  affaire: { name: string; address: string | null } | null;
  deliveryMode: PurchaseOrderDeliveryMode | null;
  lines: Array<{
    designation: string; reference: string | null; quantity: number; unit: string | null;
    unitPriceHtCents: number; pricePer: number; lineTotalHtCents: number; kind: PurchaseOrderLineKind;
  }>;
  totalHtCents: number;
  totalTaxCents: number;
  totalTtcCents: number;
};

const { colors, page } = BUSINESS_DOCUMENT_THEME;
const styles = StyleSheet.create({
  page: {
    paddingTop: page.topPaddingPt, paddingBottom: page.bottomPaddingPt, paddingHorizontal: page.sidePaddingPt,
    fontFamily: "Helvetica", fontSize: 9.5, lineHeight: 1.35, color: colors.ink,
  },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  company: { fontFamily: "Helvetica-Bold", fontSize: 13, lineHeight: 1.2, marginBottom: 2, color: colors.brandBlue },
  muted: { color: colors.muted },
  title: { fontFamily: "Helvetica-Bold", fontSize: 15, lineHeight: 1.2, marginBottom: 3, color: colors.brandBlue, textAlign: "right" },
  reference: { fontFamily: "Helvetica-Bold", fontSize: 11, lineHeight: 1.2, marginBottom: 3, textAlign: "right" },
  right: { textAlign: "right" },
  blocks: { flexDirection: "row", gap: 12, marginBottom: 8 },
  issuer: { marginBottom: 14, paddingHorizontal: 8 },
  block: { flex: 1, borderWidth: 0.75, borderColor: colors.border, borderRadius: 3, padding: 8 },
  blockTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, color: colors.muted, textTransform: "uppercase", marginBottom: 4 },
  strong: { fontFamily: "Helvetica-Bold" },
  tableHead: {
    flexDirection: "row", backgroundColor: colors.brandBlue, color: colors.white, fontFamily: "Helvetica-Bold", fontSize: 8.5,
    paddingVertical: 5, paddingHorizontal: 6,
  },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: colors.border, paddingVertical: 5, paddingHorizontal: 6 },
  designation: { flex: 1, paddingRight: 6 },
  quantity: { width: 52, textAlign: "right" },
  unit: { width: 46, textAlign: "center" },
  price: { width: 92, textAlign: "right", alignItems: "flex-end" },
  total: { width: 76, textAlign: "right" },
  totals: { marginTop: 10, marginLeft: "auto", width: 210 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, paddingHorizontal: 6 },
  grandTotal: {
    flexDirection: "row", justifyContent: "space-between", marginTop: 3, paddingVertical: 5, paddingHorizontal: 6,
    backgroundColor: colors.surfaceStrong, fontFamily: "Helvetica-Bold",
  },
  notes: { marginTop: 16, borderWidth: 0.75, borderColor: colors.border, borderRadius: 3, padding: 8 },
  footer: {
    position: "absolute", left: page.sidePaddingPt, right: page.sidePaddingPt, bottom: 20, fontSize: 7.5, color: colors.muted,
    flexDirection: "row", justifyContent: "space-between",
  },
});

/** The standard PDF fonts have no narrow or plain no-break space: an amount would show a missing glyph. */
function plain(value: string): string {
  return value.replace(/[  ]/g, " ");
}

function money(cents: number): string {
  return plain(formatEUR(cents));
}

function day(value: string | null): string {
  if (value === "TBD") return "À déterminer";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "Non définie";
}

/** Nothing is hyphenated: a name, an address or a reference must read exactly as it is written. */
const whole = (word: string) => [word];

/** A line too long for its block (an e-mail address) is set smaller instead of being cut. */
function fitted(text: string): { fontSize: number } | undefined {
  return text.length > 58 ? { fontSize: 6.5 } : text.length > 46 ? { fontSize: 7.5 } : undefined;
}

function lines(...values: Array<string | null | undefined | false>): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim() !== "");
}

export function PurchaseOrderPdf({ order }: Readonly<{ order: PurchaseOrderPdfData }>) {
  const supplier = order.supplier;
  const site = order.deliverySite;
  const delivery = site
    ? lines(site.name, site.projectCode && `Code chantier : ${site.projectCode}`, site.address,
      [site.postalCode, site.city].filter(Boolean).join(" "), site.contactName && `Contact : ${site.contactName}`, site.contactPhone)
    : lines(order.deliveryMode && PURCHASE_ORDER_DELIVERY_MODE_LABELS[order.deliveryMode], order.affaire && `Affaire : ${order.affaire.name}`,
      order.deliveryMode === "site" && order.affaire?.address);
  return (
    <Document title={`Bon de commande ${order.reference}`} author={COMPANY_INFO.name} creator={COMPANY_INFO.name} producer={COMPANY_INFO.name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>{COMPANY_INFO.name}</Text>
            <Text style={styles.muted}>{COMPANY_INFO.tagline}</Text>
            <Text>{COMPANY_INFO.address.street}</Text>
            <Text>{COMPANY_INFO.address.postalCode} {COMPANY_INFO.address.city}</Text>
            <Text>Tél. {COMPANY_INFO.phone.landline}</Text>
          </View>
          <View>
            <Text style={styles.title}>BON DE COMMANDE</Text>
            <Text style={styles.reference}>{order.reference}</Text>
            <Text style={styles.right}>Date : {day(order.orderDate)}</Text>
            <Text style={styles.right}>Livraison le : {day(order.expectedDeliveryDate)}</Text>
          </View>
        </View>

        <View style={styles.blocks}>
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Fournisseur</Text>
            <Text style={styles.strong} hyphenationCallback={whole}>{supplier.name}</Text>
            {lines(supplier.address, [supplier.postalCode, supplier.city].filter(Boolean).join(" "),
              supplier.contactName && `Contact : ${supplier.contactName}`, supplier.phone, supplier.email)
              .map((line) => <Text key={line} style={fitted(line)} hyphenationCallback={whole}>{line}</Text>)}
          </View>
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Livraison</Text>
            {delivery.length > 0
              ? delivery.map((line, index) => (
                <Text key={line} style={index === 0 ? styles.strong : fitted(line)} hyphenationCallback={whole}>{line}</Text>
              ))
              : <Text style={styles.muted}>À convenir</Text>}
          </View>
        </View>
        <View style={styles.issuer}>
          <Text style={styles.blockTitle}>Émis par</Text>
          <Text hyphenationCallback={whole}>
            <Text style={styles.strong}>{order.issuer.name}</Text>
            {lines(order.issuer.role, order.issuer.phone, order.issuer.email).map((line) => ` · ${line}`).join("")}
          </Text>
        </View>

        <View style={styles.tableHead} fixed>
          <Text style={styles.designation}>Désignation</Text>
          <Text style={styles.quantity}>Qté</Text>
          <Text style={styles.unit}>Unité</Text>
          <Text style={styles.price}>P.U. HT</Text>
          <Text style={styles.total}>Total HT</Text>
        </View>
        {order.lines.map((line, index) => (
          <View key={index} style={styles.row} wrap={false}>
            <View style={styles.designation}>
              <Text hyphenationCallback={whole}>{line.designation}</Text>
              {line.reference ? <Text style={styles.muted} hyphenationCallback={whole}>Réf. {line.reference}</Text> : null}
            </View>
            <Text style={styles.quantity}>{line.kind === "article" ? plain(formatOrderQuantity(line.quantity)) : ""}</Text>
            <Text style={styles.unit}>{line.kind === "article" ? line.unit ?? "" : ""}</Text>
            <View style={styles.price}>
              {line.kind === "article" ? <Text>{money(line.unitPriceHtCents)}</Text> : null}
              {/* The lot on its own line: after « € » the standard font swallows the space of « € les 100 ». */}
              {line.kind === "article" && line.pricePer > 1
                ? <Text style={styles.muted}>les {plain(formatOrderQuantity(line.pricePer))}</Text> : null}
            </View>
            <Text style={styles.total}>{money(line.kind === "discount" ? -Math.abs(line.lineTotalHtCents) : line.lineTotalHtCents)}</Text>
          </View>
        ))}

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}><Text>Total HT</Text><Text>{money(order.totalHtCents)}</Text></View>
          <View style={styles.totalRow}><Text>TVA</Text><Text>{money(order.totalTaxCents)}</Text></View>
          <View style={styles.grandTotal}><Text>Total TTC</Text><Text>{money(order.totalTtcCents)}</Text></View>
        </View>

        {order.notes?.trim() ? (
          <View style={styles.notes} wrap={false}>
            <Text style={styles.blockTitle}>Instructions complémentaires</Text>
            <Text hyphenationCallback={whole}>{order.notes.trim()}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>{COMPANY_INFO.name} · SIRET {COMPANY_INFO.legal.siret} · TVA {COMPANY_INFO.legal.vat}</Text>
          <Text render={({ pageNumber, totalPages }) => `${order.reference} · page ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPurchaseOrderPdf(order: PurchaseOrderPdfData): Promise<Buffer> {
  return renderToBuffer(<PurchaseOrderPdf order={order} />);
}
