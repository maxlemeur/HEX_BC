import { StyleSheet, Text, View } from "@react-pdf/renderer";

import { BUSINESS_DOCUMENT_THEME } from "@/lib/documents/document-theme";
import {
  formatCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    marginLeft: "auto",
    width: 222,
    border: `1px solid ${BUSINESS_DOCUMENT_THEME.colors.border}`,
    borderRadius: 8,
    overflow: "hidden",
  },
  main: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 11,
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.brandBlue,
    color: BUSINESS_DOCUMENT_THEME.colors.white,
    fontWeight: 700,
  },
  secondary: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderTop: `1px solid ${BUSINESS_DOCUMENT_THEME.colors.border}`,
    backgroundColor: BUSINESS_DOCUMENT_THEME.colors.surface,
    color: BUSINESS_DOCUMENT_THEME.colors.muted,
  },
});

export function PdfEstimateTotalsCard({
  totalHtCents,
  totalTaxCents,
  amountDueCents,
  roundingAdjustmentCents,
  currency,
  taxRateBp,
  vatReverseCharge,
}: {
  totalHtCents: number;
  totalTaxCents: number;
  amountDueCents: number;
  roundingAdjustmentCents: number;
  currency: SupportedEstimateCurrency;
  taxRateBp: number;
  vatReverseCharge: boolean;
}) {
  const hasCommercialRounding = roundingAdjustmentCents !== 0;

  return (
    <View style={styles.card} wrap={false}>
      <View style={styles.main}>
        <Text>Total HT</Text>
        <Text>{formatCurrency(totalHtCents, currency)}</Text>
      </View>
      {!vatReverseCharge && taxRateBp > 0 ? (
        <View style={styles.secondary}>
          <Text>TVA</Text>
          <Text>{formatCurrency(totalTaxCents, currency)}</Text>
        </View>
      ) : null}
      {!vatReverseCharge && hasCommercialRounding ? (
        <>
          <View style={styles.secondary}>
            <Text>TTC calculé</Text>
            <Text>
              {formatCurrency(
                amountDueCents - roundingAdjustmentCents,
                currency,
              )}
            </Text>
          </View>
          <View style={styles.secondary}>
            <Text>Arrondi commercial</Text>
            <Text>{formatCurrency(roundingAdjustmentCents, currency)}</Text>
          </View>
        </>
      ) : null}
      {!vatReverseCharge ? (
        <View style={styles.secondary}>
          <Text>{hasCommercialRounding ? "Montant à payer" : "Total TTC"}</Text>
          <Text>{formatCurrency(amountDueCents, currency)}</Text>
        </View>
      ) : null}
    </View>
  );
}
