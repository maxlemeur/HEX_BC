import path from "node:path";
import { selectBusinessCorpus } from "../../../scripts/tester-army/business-corpus-selection";

type Lot = {
  file: string;
  path: string;
  priced: number;
  sumAtWorkbookCoefficientsCents: number;
  sumAtOfferCoefficientsCents: number;
  costCents: number;
  realizedSaleCoefficient: string;
  statuses: Record<string, number>;
};

/**
 * Public inputs always exist in a fresh clone. Private replay is an explicit separate campaign.
 * The sums are those of the imported v3 (IO01, IO03): TI-534 gives every imported line the FO provision 1,01 (no
 * supply type), so the public ones are the README's integer oracle with PR FO × 101/100. The private ones predate
 * TI-534 and must be replayed with the originals before a private campaign.
 */
export function businessCorpus() {
  const { mode, identity, root } = selectBusinessCorpus();
  const lot = (key: "HYDRAULIQUE" | "PLOMBERIE", expected: Omit<Lot, "file" | "path">): Lot => {
    const file = mode === "public" ? `optima-${key.toLowerCase()}-fictif.xlsx` : `BEING - DPGF ${key}.xlsx`;
    return { ...expected, file, path: mode === "public" ? path.join(root, file) : path.join(root, "docs/prd_file/exemple chiffrage OPTIMA", file) };
  };
  return {
    mode,
    identity,
    lots: {
      HYDRAULIQUE: lot("HYDRAULIQUE", {
        priced: 785,
        sumAtWorkbookCoefficientsCents: mode === "public" ? 7_176_891 : 164_420_761,
        sumAtOfferCoefficientsCents: mode === "public" ? 6_745_141 : 157_232_099,
        costCents: mode === "public" ? 5_520_631 : 126_474_907,
        realizedSaleCoefficient: mode === "public" ? "1.221806" : "1.243188",
        statuses: { out_of_scope: 61, included: 10, not_priced: 7, for_memory: 1 },
      }),
      PLOMBERIE: lot("PLOMBERIE", {
        priced: 656,
        sumAtWorkbookCoefficientsCents: mode === "public" ? 5_987_528 : 102_765_561,
        sumAtOfferCoefficientsCents: mode === "public" ? 5_627_228 : 98_188_792,
        costCents: mode === "public" ? 4_605_747 : 79_049_005,
        realizedSaleCoefficient: mode === "public" ? "1.221784" : "1.242126",
        statuses: { out_of_scope: 74, not_priced: 4, not_applicable: 3, for_memory: 1 },
      }),
    },
    bdc: {
      path: mode === "public" ? path.join(root, "bdc-fictif.csv") : path.join(root, "docs/prd_file/MM_BDC_V1.2.csv"),
      sha256: mode === "public" ? "6f606a63a1d782c13258e49277929c42fc3541019131c46cfca51fe116b82484" : "b15f6b58a7597de2894810647531a1f0cc4937d99df773d14a3833575fb6f89e",
    },
  };
}
