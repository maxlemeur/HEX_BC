"use client";

import type { ComponentProps } from "react";
import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";
import { parseCoefficientDraft, parseKfoDraft } from "@/lib/estimates/editor-values";
import { decimalFromLiteral, formatScaled, multiply, roundHalfUpToScale } from "@/lib/estimates/engine-v3/decimal";
import { KFO_HELP } from "@/lib/estimates/unified-kfo";

type Props = Omit<ComponentProps<typeof DecimalDraftInput>, "parseValue" | "emptyValue" | "commitOnUnchangedBlur" | "title"> & {
  isV3: boolean;
  foProvision: number | null | undefined;
};

/** K FO owns its six-decimal grammar and the display of historical effective factors. */
export function KfoDraftInput({ isV3, foProvision, value, ...props }: Props) {
  // Display an effective historical factor without applying the bound of a single writable column.
  const effective = isV3 ? multiply(decimalFromLiteral(String(value ?? 1), "K FO", 6),
    decimalFromLiteral(String(foProvision ?? 1), "provision FO", 3)) : null;
  const displayed = effective ? Number(formatScaled(roundHalfUpToScale(effective, 6), 6)) : value;
  return <DecimalDraftInput {...props}
    value={displayed}
    emptyValue={1} commitOnUnchangedBlur={!isV3}
    parseValue={isV3 ? parseKfoDraft : parseCoefficientDraft} title={KFO_HELP} />;
}
