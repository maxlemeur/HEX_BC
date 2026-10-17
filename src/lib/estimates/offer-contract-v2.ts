import { createHash } from "node:crypto";

import type {
  EstimateDocumentV3PreparedData,
  EstimateItem,
} from "@/components/estimate-document/prepare-estimate-document-data";
import { OfferCaptureError } from "@/lib/estimates/offer-contract-capture";
import {
  parseOfferDocumentProof,
  type OfferProofParseOptions,
  type OfferTermsSnapshot,
} from "@/lib/estimates/offer-contract";
import { canonicalJson, hash, invalid, object, run } from "@/lib/estimates/offer-contract-core";
import {
  parseClientContract2Snapshot,
  parseContract2,
  type ClientContract2,
  type CommercialRow2,
} from "@/lib/estimates/offer-contract-v2-parser";
import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";

/**
 * Lot 2, sous-lot 2.7 - contrat client 2 (conception D14, F1 à F3 ;
 * docs/testing/estimate-engine-v3-2.7-vitest.md) : construction de la copie commerciale d'une v3
 * figée, analyse stricte (`offer-contract-v2-parser.ts`) et sceau d'offre au marqueur 5, dont le
 * calcul est la charge 6. Le contrat 1 (`offer-contract.ts`), ses validateurs et son enveloppe
 * (charge 4) ne changent pas. Règle d'appariement : v3 ⇔ contrat 2, v1/v2 ⇔ contrat 1.
 */

export {
  parseClientContract2Snapshot,
  type ClientContract2,
  type ClientContract2DiscountIntent,
  type ClientContract2TaxRate,
  type CommercialRow2,
} from "@/lib/estimates/offer-contract-v2-parser";

/** Enveloppe du marqueur 5 d'une v3 : contrat 2 lié à la charge de calcul 6. */
export type Seal5V3 = {
  meta: {
    payloadVersion: 5;
    versionId: string;
    tenantId: string;
    projectId: string;
    contentRevision: number;
    calcEngineVersion: 3;
  };
  calculation: { payloadVersion: 6; sha256: string };
  clientContract: ClientContract2;
  document: {
    sha256Hash: string;
    layoutOptions: EstimatePdfLayoutOptions;
    termsSnapshot: OfferTermsSnapshot | null;
  };
};

export type ClientContract2BuildInput = {
  version: ClientContract2["version"];
  project: ClientContract2["project"];
  issuer: ClientContract2["issuer"];
  company: ClientContract2["company"];
  sourceRows: readonly Pick<EstimateItem, "id" | "parent_id" | "position" | "item_type" | "title" | "quantity">[];
  prepared: Pick<EstimateDocumentV3PreparedData, "layout" | "numberingById" | "sectionTotalsById" | "v3">;
  exclusions: string | null;
};

function incomplete(): never {
  throw new OfferCaptureError();
}

/**
 * Copie commerciale d'une v3 figée, à partir des valeurs déjà relues par le préparateur du
 * document (lignes brutes, pied du contexte figé) : aucun moteur n'est rejoué ici. La copie est
 * rendue par l'analyseur strict, qui refuse toute incohérence au lieu de la réparer.
 */
export function buildClientContract2(input: ClientContract2BuildInput): ClientContract2 {
  const byId = new Map(input.sourceRows.map((entry) => [entry.id, entry]));
  if (byId.size !== input.sourceRows.length) incomplete();
  const children = new Map<string | null, ClientContract2BuildInput["sourceRows"][number][]>();
  for (const entry of input.sourceRows) {
    if (entry.parent_id !== null && byId.get(entry.parent_id)?.item_type !== "section") incomplete();
    if (entry.item_type === "line" && !Object.hasOwn(input.prepared.v3.linesById, entry.id)) incomplete();
    const siblings = children.get(entry.parent_id) ?? [];
    siblings.push(entry);
    children.set(entry.parent_id, siblings);
  }
  // Même ordre stable que le préparateur du document (position), jamais un ordre par identifiant.
  for (const siblings of children.values()) siblings.sort((left, right) => left.position - right.position);
  const rows: CommercialRow2[] = [];
  const visited = new Set<string>();
  const showPortions = input.prepared.layout.priceMode === "fo_mo_and_total";
  const walk = (parentId: string | null, depth: number): void => {
    for (const entry of children.get(parentId) ?? []) {
      if (visited.has(entry.id) || depth > 4 || (entry.item_type === "section" && depth > 3)) incomplete();
      visited.add(entry.id);
      const common = { id: entry.id, parentId: entry.parent_id, position: entry.position, depth,
        title: entry.title?.trim() || "Sans titre" };
      if (entry.item_type === "section") {
        if (!Object.hasOwn(input.prepared.sectionTotalsById, entry.id) || !Object.hasOwn(input.prepared.numberingById, entry.id)) incomplete();
        const sale = input.prepared.sectionTotalsById[entry.id];
        rows.push({ kind: "section", ...common, number: input.prepared.numberingById[entry.id], saleHtCents: sale.totalHtCents,
          ...(showPortions ? { foSaleHtCents: sale.foTotalCents, moSaleHtCents: sale.moTotalCents } : {}) });
        walk(entry.id, depth + 1);
      } else {
        const line = input.prepared.v3.linesById[entry.id];
        if (entry.quantity === null) incomplete();
        rows.push({ kind: "line", ...common, quantity: entry.quantity, unitCode: line.unitCode, unitLabel: line.unitLabel,
          pricingStatus: line.pricingStatus, taxRateBp: line.taxRateBp, unitSaleHtCents: line.unitSaleHtCents,
          saleHtCents: line.saleHtCents,
          ...(showPortions ? { foSaleHtCents: line.foSaleHtCents, moSaleHtCents: line.moSaleHtCents } : {}) });
      }
    }
  };
  walk(null, 0);
  if (visited.size !== input.sourceRows.length) incomplete();
  const totals = input.prepared.v3.totals;
  return parseClientContract2Snapshot({
    schemaVersion: 2, version: { ...input.version },
    project: input.project, issuer: input.issuer, company: input.company, rows,
    totals: {
      grossHtCents: totals.grossHtCents,
      commercialDiscountCents: totals.discount.appliedCents,
      discountIntent: totals.discount.kind === "rate"
        ? { kind: "rate", rateBp: totals.discount.rateBp }
        : { kind: totals.discount.kind },
      commercialRoundingCents: totals.commercialRoundingCents,
      netHtCents: totals.netHtCents,
      taxByRate: totals.taxByRate.map((entry) => ({ ...entry })),
      taxCents: totals.taxCents,
      payableTtcCents: totals.payableTtcCents,
      reverseCharge: totals.reverseCharge,
    },
    exclusions: input.exclusions,
  });
}

/** Seal5 d'une v3 : lie un hash de charge 6 réellement calculé à la copie 2 et au PDF publiés. */
export function computeOfferSealHashV2(input: {
  calculationHash: string;
  snapshot: unknown;
  documentProof: unknown;
}, options: OfferProofParseOptions = {}): string {
  return run("OFFER_SEAL_INPUT_INVALID", () => {
    const source = object(input, ["calculationHash", "snapshot", "documentProof"], "seal input");
    const calculationHash = hash(source.calculationHash, "seal calculationHash");
    const captured = parseContract2(source.snapshot);
    const proof = parseOfferDocumentProof(source.documentProof, options);
    if (proof.clientContractVersion !== 2 || canonicalJson(captured) !== canonicalJson(proof.clientContractSnapshot)) invalid("seal document copy");
    const payload: Seal5V3 = {
      meta: { payloadVersion: 5, versionId: captured.version.id, tenantId: captured.version.tenantId,
        projectId: captured.version.projectId, contentRevision: captured.version.contentRevision, calcEngineVersion: 3 },
      calculation: { payloadVersion: 6, sha256: calculationHash },
      clientContract: captured,
      document: { sha256Hash: proof.sha256Hash, layoutOptions: proof.layoutOptions, termsSnapshot: proof.termsSnapshot },
    };
    return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
  });
}
