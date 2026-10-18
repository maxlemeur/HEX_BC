import { StyleSheet, Text, View } from "@react-pdf/renderer";

import { BUSINESS_DOCUMENT_THEME } from "@/lib/documents/document-theme";
import type { SupportedEstimateCurrency } from "@/lib/money";
import {
  buildEstimateV3FooterRows,
  formatEstimateV3FooterAmount,
  type EstimateV3DocumentFooter,
} from "@/lib/estimates/v3-document-presentation";

/**
 * Lot 2, sous-lot 2.7 - pied du PDF d'une v3 (conception D7, D8 ; §14 « 2.7 ») : brut, ligne
 * « Remise commerciale », arrondi commercial, « Total HT net », TVA de chaque taux sur sa base
 * nette et TTC, lus sur le contrat client 2 (jamais recalculés). Même présentation que le pied
 * v1/v2 (`pdf-totals-card.tsx`, inchangé).
 */

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    marginLeft: "auto",
    width: 262,
    border: `1px solid ${BUSINESS_DOCUMENT_THEME.colors.border}`,
    borderRadius: 8,
    overflow: "hidden",
  },
  row: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderTop: `1px solid ${BUSINESS_DOCUMENT_THEME.colors.border}`,
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.surface,
    color: BUSINESS_DOCUMENT_THEME.colors.muted,
  },
  net: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 11,
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.brandBlue,
    color: BUSINESS_DOCUMENT_THEME.colors.white,
    fontWeight: 700,
  },
  payable: { fontWeight: 700, color: BUSINESS_DOCUMENT_THEME.colors.ink },
});

// Helvetica (WinAnsi) n'encode ni l'espace fine insécable de Intl ni le signe moins U+2212.
function pdfText(value: string): string {
  return value.replace(/[  ]/g, " ").replace(/−/g, "-");
}

export function PdfEstimateTotalsV3({
  footer,
  currency,
}: {
  footer: EstimateV3DocumentFooter;
  currency: SupportedEstimateCurrency;
}) {
  return (
    <View style={styles.card} wrap={false}>
      {buildEstimateV3FooterRows(footer, currency).map((row) => (
        <View key={row.key} style={row.emphasis === "net" ? styles.net : [styles.row, ...(row.emphasis === "payable" ? [styles.payable] : [])]}>
          <Text>{pdfText(row.label)}</Text>
          <Text>{pdfText(formatEstimateV3FooterAmount(row, currency, "-"))}</Text>
        </View>
      ))}
    </View>
  );
}
