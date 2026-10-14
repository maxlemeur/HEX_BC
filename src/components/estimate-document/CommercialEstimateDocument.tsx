import {
  Document, Image as PdfImage, Page, StyleSheet, Text, View,
} from "@react-pdf/renderer";

import { BusinessDocumentFrame } from "@/components/documents/BusinessDocumentPrimitives";
import { BUSINESS_DOCUMENT_THEME } from "@/lib/documents/document-theme";
import { ESTIMATE_SERVICE_LIMITS_TITLE, ESTIMATE_VAT_REVERSE_CHARGE_NOTICE } from "@/lib/estimates/document-copy";
import {
  parseOfferPresentation, type ClientContract1, type CommercialRow1,
  type OfferPresentation, type OfferTermsSnapshot,
} from "@/lib/estimates/offer-contract";
import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";
import { ESTIMATE_DRAFT_TERMS_NOTICE, parseEstimateTermsClauses } from "@/lib/estimates/pdf-terms";
import { PdfEstimateTotalsCard } from "@/lib/estimates/pdf-totals-card";
import { formatCurrency } from "@/lib/money";

export type CommercialEstimateDocumentProps = {
  contract: ClientContract1;
  layout: EstimatePdfLayoutOptions;
  terms: OfferTermsSnapshot | null;
  /** Only a trusted local DEVELOPMENT caller can enable draft terms. */
  allowDevelopmentTerms?: boolean;
};

const colors = BUSINESS_DOCUMENT_THEME.colors;
const quantityFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const dateFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function validate(input: CommercialEstimateDocumentProps): OfferPresentation {
  return parseOfferPresentation({ contract: input.contract, layout: input.layout, terms: input.terms }, {
    allowDevelopmentTerms: input.allowDevelopmentTerms === true,
  });
}

function address(value: ClientContract1["company"]["address"]): string {
  return `${value.street} ${value.postalCode} ${value.city}`;
}

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function visibleRows({ contract, layout }: OfferPresentation): CommercialRow1[] {
  const depth = layout.detailLevel;
  return contract.rows.filter((row) => depth === "lines" || (row.kind === "section" && row.depth + 1 <= depth));
}

function rowValues(row: CommercialRow1, model: OfferPresentation): string[] {
  const { layout, contract } = model;
  const amounts = row.kind === "line" || layout.showSectionSubtotals;
  const title = row.kind === "section" && layout.showNumbering ? `${row.number}  ${row.title}` : row.title;
  const values = [title, row.kind === "line" ? quantityFormatter.format(row.quantity) : "", row.kind === "line" ? row.unit : ""];
  if (layout.priceMode === "unit_and_total") values.push(row.kind === "line" ? formatCurrency(row.unitSaleHtCents, contract.version.currency) : "");
  if (layout.priceMode === "fo_mo_and_total") {
    // Presentation validation requires the pair on every row in this mode.
    const split = row as CommercialRow1 & { foSaleHtCents: number; moSaleHtCents: number };
    values.push(amounts ? formatCurrency(split.foSaleHtCents, contract.version.currency) : "",
      amounts ? formatCurrency(split.moSaleHtCents, contract.version.currency) : "");
  }
  values.push(amounts ? formatCurrency(row.saleHtCents, contract.version.currency) : "");
  return values;
}

function headings(layout: EstimatePdfLayoutOptions): string[] {
  return ["Désignation", "Qté", "Unité", ...(layout.priceMode === "unit_and_total" ? ["PU HT"] : []),
    ...(layout.priceMode === "fo_mo_and_total" ? ["FO HT", "MO HT"] : []), "Total HT"];
}

function totalRows(contract: ClientContract1): Array<{ label: string; cents: number }> {
  const amounts = contract.totals;
  const totals = [{ label: "Total HT", cents: amounts.saleHtCents }];
  if (contract.version.contractorRole === "subcontractor") return totals;
  if (contract.version.taxRateBp > 0) totals.push({ label: "TVA", cents: amounts.taxCents });
  if (amounts.roundingAdjustmentCents !== 0) {
    totals.push({ label: "TTC calculé", cents: amounts.calculatedTtcCents },
      { label: "Arrondi commercial", cents: amounts.roundingAdjustmentCents });
  }
  totals.push({ label: amounts.roundingAdjustmentCents !== 0 ? "Montant à payer" : "Total TTC", cents: amounts.payableTtcCents });
  return totals;
}

function termsReview(terms: OfferTermsSnapshot): string {
  return "isDraft" in terms ? `Maquette CGV - version ${terms.version} - à valider, non contractuelle.`
    : `Version des conditions : ${terms.version} - revue juridique du ${formatDate(terms.legalReviewedAt)}`;
}

/** Server-only presentation: no original items, pricing props or current identity. */
export function CommercialEstimateDocument(input: CommercialEstimateDocumentProps) {
  const model = validate(input);
  const { contract: c, layout, terms } = model;
  const padding = layout.density === "compact" ? "py-1.5" : layout.density === "comfortable" ? "py-3.5" : "py-2.5";
  const limits = c.exclusions?.trim() ?? null;
  return (
    <BusinessDocumentFrame>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-5">
        <div className="text-xl font-bold text-brand-blue">{c.company.name}</div>
        <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3 text-right text-sm">
          <p className="mb-1 text-xs font-semibold uppercase">Établissement principal :</p>
          <p>{c.company.address.street}</p><p>{c.company.address.postalCode} {c.company.address.city}</p>
          <p>{c.company.phone.landline}</p><p>{c.company.phone.mobile}</p>
        </div>
      </header>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <div className="text-sm"><p className="text-xs font-semibold uppercase">Émis par</p>
          <p className="text-lg font-bold text-brand-blue">{c.issuer.displayName}</p>
          {c.issuer.displayRole ? <p>{c.issuer.displayRole}</p> : null}
          {c.issuer.phone ? <p>{c.issuer.phone}</p> : null}{c.issuer.email ? <p>{c.issuer.email}</p> : null}
        </div>
        <div className="text-center"><h1 className="text-3xl font-bold text-brand-blue">Devis</h1>
          {c.project.estimateReference ? <p className="font-semibold">{c.project.estimateReference}</p> : null}
          <p>Le {formatDate(c.version.dateDevis)}</p><p>Version : V{c.version.number}</p>
        </div>
      </div>
      <p className="mb-4 text-center text-xs">Validité : {c.version.validiteJours} jours — {c.version.contractorRole === "subcontractor"
        ? "Autoliquidation" : `TVA : ${c.version.taxRateBp / 100} %`}</p>
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-border p-4"><h2 className="text-xs font-semibold uppercase">Client</h2>
          <p className="font-bold">{c.project.clientName ?? "Client à renseigner"}</p>
          {c.project.reference ? <p>Référence projet : {c.project.reference}</p> : null}
        </section>
        <section className="rounded-lg border border-border p-4"><h2 className="text-xs font-semibold uppercase">Chantier</h2>
          <p className="font-bold">{c.project.name}</p><p>{c.project.siteAddress ?? "Adresse du chantier non renseignée"}</p>
        </section>
      </div>
      <div className="overflow-x-auto"><table className="mb-5 w-full text-sm">
        <thead className="bg-brand-blue text-white"><tr>{headings(layout).map((label, index) =>
          <th key={label} className={`px-3 ${padding} ${index === 0 ? "text-left" : "text-right"}`}>{label}</th>)}</tr></thead>
        <tbody>{visibleRows(model).map((row) => <tr key={row.id} className={row.kind === "section" ? "bg-surface-subtle font-bold" : "border-b border-border"}>
          {rowValues(row, model).map((value, index) => <td key={index} className={`px-3 ${padding} ${index === 0 ? "text-left" : "text-right"}`}
            style={index === 0 ? { paddingLeft: 12 + row.depth * 14 } : undefined}>{value}</td>)}
        </tr>)}</tbody>
      </table></div>
      <dl className="mb-6 ml-auto w-full max-w-xs rounded-lg border border-border bg-surface-subtle">
        {totalRows(c).map((entry, index) => <div key={entry.label} className={`flex justify-between px-4 py-2 ${index === 0 ? "bg-brand-blue font-bold text-white" : "border-t border-border"}`}>
          <dt>{entry.label}</dt><dd>{formatCurrency(entry.cents, c.version.currency)}</dd>
        </div>)}
      </dl>
      {c.version.contractorRole === "subcontractor" ? <p className="mb-5 text-xs">{ESTIMATE_VAT_REVERSE_CHARGE_NOTICE}</p> : null}
      {limits ? <section className={`mb-5 ${layout.conditionsPlacement === "new_page" ? "print:break-before-page" : ""}`}>
        <h2 className="mb-2 font-bold">{ESTIMATE_SERVICE_LIMITS_TITLE}</h2><p className="whitespace-pre-wrap text-sm">{limits}</p>
      </section> : null}
      {layout.includeTerms && terms ? <section className="mb-5 print:break-before-page">
        <h2 className="font-bold">{terms.title}</h2><p className="mb-3 text-xs">{termsReview(terms)}</p>
        {"isDraft" in terms ? <p className="mb-3 text-xs">{ESTIMATE_DRAFT_TERMS_NOTICE}</p> : null}
        {parseEstimateTermsClauses(terms.body).map((clause, index) => <div key={index} className="mb-3 text-sm">
          {clause.heading ? <h3 className="font-bold">{clause.heading}</h3> : null}<p className="whitespace-pre-wrap">{clause.text}</p>
        </div>)}
      </section> : null}
      <footer className="mt-auto border-t border-border pt-5 text-center text-xs font-semibold uppercase">
        <p>Siège social : {address(c.company.registeredOffice)}</p><p>SIRET {c.company.legal.siret} — TVA {c.company.legal.vat}</p>
      </footer>
    </BusinessDocumentFrame>
  );
}

const pdfStyles = StyleSheet.create({
  page: { paddingTop: BUSINESS_DOCUMENT_THEME.page.topPaddingPt, paddingBottom: BUSINESS_DOCUMENT_THEME.page.bottomPaddingPt,
    paddingLeft: BUSINESS_DOCUMENT_THEME.page.sidePaddingPt + 8, paddingRight: BUSINESS_DOCUMENT_THEME.page.sidePaddingPt,
    fontSize: 9.5, lineHeight: 1.35, color: colors.ink, fontFamily: "Helvetica" },
  blue: { position: "absolute", left: 0, top: 0, bottom: 0, width: 9, backgroundColor: colors.brandBlue },
  orange: { position: "absolute", left: 0, bottom: 0, width: 9, height: 92, backgroundColor: colors.brandOrange },
  footer: { position: "absolute", bottom: 18, left: 44, right: 36, fontSize: 7, textAlign: "center", color: colors.muted },
  brand: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  logo: { width: 142, height: 58, objectFit: "contain" },
  company: { fontSize: 15, fontWeight: 700, color: colors.brandBlue },
  establishment: { width: 172, border: `1px solid ${colors.border}`, borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 10, backgroundColor: colors.surface, textAlign: "right", fontSize: 8.5 },
  identity: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  issuer: { width: "31%", fontSize: 8.5, color: colors.muted },
  name: { fontSize: 13, lineHeight: 1.3, fontWeight: 700, color: colors.brandBlue },
  titleBox: { width: "38%", textAlign: "center" },
  title: { fontSize: 26, lineHeight: 1.2, marginBottom: 4, fontWeight: 700, color: colors.brandBlue },
  validity: { fontSize: 8, textAlign: "center", marginBottom: 12 },
  cards: { flexDirection: "row", gap: 10, marginBottom: 16 },
  card: { width: "49%", border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10 },
  label: { fontSize: 7.5, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 },
  heading: { flexDirection: "row", backgroundColor: colors.brandBlue, color: colors.white, fontWeight: 700, paddingVertical: 6 },
  row: { flexDirection: "row", borderBottom: `1px solid ${colors.border}`, fontSize: 8.5 },
  section: { backgroundColor: colors.surfaceStrong, fontWeight: 700 },
  conditions: { marginTop: 16 },
  conditionsTitle: { fontSize: 11, fontWeight: 700, color: colors.brandBlue, marginBottom: 7 },
  clause: { marginBottom: 9, fontSize: 8.5 },
  clauseTitle: { fontWeight: 700, marginBottom: 3 },
  notice: { marginBottom: 8, fontSize: 8, color: colors.muted },
});

function PdfChrome({ contract: c }: { contract: ClientContract1 }) {
  return <>
    <View style={pdfStyles.blue} fixed /><View style={pdfStyles.orange} fixed />
    <View style={pdfStyles.footer} fixed>
      <Text>Siège social : {address(c.company.registeredOffice)}</Text>
      <Text>SIRET {c.company.legal.siret} — TVA {c.company.legal.vat}</Text>
    </View>
  </>;
}

function hyphenatePdfIdentity(word: string): string[] {
  return word.length > 24 ? (word.match(/[\s\S]{1,20}/gu) ?? [word]) : [word];
}

function PdfBrand({ contract: c, logoDataUri }: { contract: ClientContract1; logoDataUri: string | null }) {
  return <View style={pdfStyles.brand} wrap={false}>
    {logoDataUri ? <PdfImage src={logoDataUri} style={pdfStyles.logo} /> : <Text style={pdfStyles.company}>{c.company.name}</Text>}
    <View style={pdfStyles.establishment}>
      <Text style={pdfStyles.label}>Établissement principal</Text><Text>{c.company.address.street}</Text>
      <Text>{c.company.address.postalCode} {c.company.address.city}</Text>
      <Text>{c.company.phone.landline}</Text><Text>{c.company.phone.mobile}</Text>
    </View>
  </View>;
}

function PdfTable({ model }: { model: OfferPresentation }) {
  const { layout } = model;
  const widths = layout.priceMode === "fo_mo_and_total" ? [46, 8, 7, 13, 13, 13]
    : layout.priceMode === "unit_and_total" ? [51, 9, 8, 14, 18] : [64, 10, 8, 18];
  const rowPadding = layout.density === "compact" ? 4 : layout.density === "comfortable" ? 8 : 6;
  return <View>
    <View style={pdfStyles.heading} wrap={false}>{headings(layout).map((label, index) =>
      <Text key={label} style={{ width: `${widths[index]}%`, paddingHorizontal: 5, textAlign: index === 0 ? "left" : "right" }}>{label}</Text>)}</View>
    {visibleRows(model).map((row) => <View key={row.id} style={[pdfStyles.row, ...(row.kind === "section" ? [pdfStyles.section] : []), { paddingVertical: rowPadding }]} wrap={false}>
      {rowValues(row, model).map((value, index) => <Text key={index} style={{ width: `${widths[index]}%`, paddingHorizontal: 5,
        paddingLeft: index === 0 ? 5 + row.depth * 9 : 5, textAlign: index === 0 ? "left" : "right" }}>{value.replace(/[\u00a0\u202f]/g, " ")}</Text>)}
    </View>)}
  </View>;
}

function PdfLimits({ text }: { text: string }) {
  return <View style={pdfStyles.conditions}><Text style={pdfStyles.conditionsTitle}>{ESTIMATE_SERVICE_LIMITS_TITLE}</Text><Text>{text}</Text></View>;
}

/** Build actual PDF elements from the same validated commercial presentation. */
export function buildCommercialEstimatePdfDocument(input: CommercialEstimateDocumentProps & { logoDataUri: string | null }) {
  const model = validate(input);
  const { contract: c, layout, terms } = model;
  if (input.logoDataUri !== null && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.logoDataUri)) {
    throw new Error("The commercial PDF accepts only an inline image logo.");
  }
  const limits = c.exclusions?.trim() ?? null;
  const separateLimits = Boolean(limits && layout.conditionsPlacement === "new_page");
  const reversed = c.version.contractorRole === "subcontractor";
  return <Document>
    <Page size="A4" style={pdfStyles.page} wrap>
      <PdfChrome contract={c} /><PdfBrand contract={c} logoDataUri={input.logoDataUri} />
      <View style={pdfStyles.identity}>
        <View style={pdfStyles.issuer}><Text style={pdfStyles.label}>Émis par</Text><Text style={pdfStyles.name} hyphenationCallback={hyphenatePdfIdentity}>{c.issuer.displayName}</Text>
          {c.issuer.displayRole ? <Text>{c.issuer.displayRole}</Text> : null}{c.issuer.phone ? <Text>{c.issuer.phone}</Text> : null}
          {c.issuer.email ? <Text>{c.issuer.email}</Text> : null}</View>
        <View style={pdfStyles.titleBox}><Text style={pdfStyles.title}>Devis</Text>
          {c.project.estimateReference ? <Text>{c.project.estimateReference}</Text> : null}
          <Text>Le {formatDate(c.version.dateDevis)}</Text><Text>Version : V{c.version.number}</Text></View>
        <View style={{ width: "31%" }} />
      </View>
      <Text style={pdfStyles.validity}>Validité : {c.version.validiteJours} jours — {reversed ? "Autoliquidation" : `TVA : ${c.version.taxRateBp / 100} %`}</Text>
      <View style={pdfStyles.cards}>
        <View style={pdfStyles.card}><Text style={pdfStyles.label}>Client</Text><Text style={pdfStyles.name} hyphenationCallback={hyphenatePdfIdentity}>{c.project.clientName ?? "Client à renseigner"}</Text>
          {c.project.reference ? <Text>Référence projet : {c.project.reference}</Text> : null}</View>
        <View style={pdfStyles.card}><Text style={pdfStyles.label}>Chantier</Text><Text style={pdfStyles.name} hyphenationCallback={hyphenatePdfIdentity}>{c.project.name}</Text>
          <Text>{c.project.siteAddress ?? "Adresse du chantier non renseignée"}</Text></View>
      </View>
      <PdfTable model={model} />
      <PdfEstimateTotalsCard totalHtCents={c.totals.saleHtCents} totalTaxCents={c.totals.taxCents}
        amountDueCents={c.totals.payableTtcCents} roundingAdjustmentCents={c.totals.roundingAdjustmentCents}
        currency={c.version.currency} taxRateBp={c.version.taxRateBp} vatReverseCharge={reversed} />
      {reversed ? <Text style={pdfStyles.notice}>{ESTIMATE_VAT_REVERSE_CHARGE_NOTICE}</Text> : null}
      {limits && !separateLimits ? <PdfLimits text={limits} /> : null}
    </Page>
    {separateLimits && limits ? <Page size="A4" style={pdfStyles.page} wrap>
      <PdfChrome contract={c} /><PdfBrand contract={c} logoDataUri={input.logoDataUri} /><PdfLimits text={limits} />
    </Page> : null}
    {layout.includeTerms && terms ? <Page size="A4" style={pdfStyles.page} wrap>
      <PdfChrome contract={c} /><PdfBrand contract={c} logoDataUri={input.logoDataUri} />
      <Text style={pdfStyles.conditionsTitle}>{terms.title}</Text><Text style={pdfStyles.notice}>{termsReview(terms)}</Text>
      {"isDraft" in terms ? <Text style={pdfStyles.notice}>{ESTIMATE_DRAFT_TERMS_NOTICE}</Text> : null}
      {parseEstimateTermsClauses(terms.body).map((clause, index) => <View key={index} style={pdfStyles.clause}>
        {clause.heading ? <Text style={pdfStyles.clauseTitle}>{clause.heading}</Text> : null}<Text>{clause.text}</Text>
      </View>)}
    </Page> : null}
  </Document>;
}
