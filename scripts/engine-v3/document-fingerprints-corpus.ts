import { createHash } from "node:crypto";

import {
  computeEstimateLineSaleSplit,
  computeEstimateLineValues,
  computeEstimateTotals,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";

/**
 * Deterministic v1/v2 document corpus for the Lot 2 document fingerprints
 * (docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md §10.3).
 *
 * Every identity is fixed: seal payloads and client contracts embed the
 * version, tenant, project, line and issuer identifiers, so a random UUID
 * would change the fingerprint of an unchanged document. Amounts stored on
 * the seeded rows are what the historical v1 line save wrote (gross line,
 * PU, line tax) and are derived here from the frozen engine, never typed by
 * hand: a v1 document reads them back, a v2 document replaces them by the
 * real freeze before any document exists.
 */

export const FINGERPRINT_ID_PREFIX = "d0cf1000-0000-4000-8000-";

export function fingerprintId(n: number) {
  if (!Number.isSafeInteger(n) || n <= 0 || n > 999_999_999_999) {
    throw new Error("Fingerprint identities are positive 12-digit integers.");
  }
  return `${FINGERPRINT_ID_PREFIX}${String(n).padStart(12, "0")}`;
}

export const OWNER = {
  id: fingerprintId(1),
  email: "engine-fingerprint-owner@example.test",
  fullName: "Empreinte Émetteur",
  jobTitle: "Chargé d'affaires",
  phone: "+33 1 00 00 00 01",
  workEmail: "engine-fingerprint-issuer@example.invalid",
} as const;

export const TENANT = {
  id: fingerprintId(101),
  name: "ENGINE FP entreprise",
  slug: "engine-fp-entreprise",
} as const;

export const PROJECT = {
  id: fingerprintId(201),
  name: "ENGINE FP affaire",
  reference: "EFP-AFF",
  estimateReference: "EFP-DEV",
  clientName: "Client empreinte",
  siteAddress: "1 rue de l'Empreinte 75001 Paris",
} as const;

/** The editor page session that holds every draft lock of the corpus. */
export const LOCK_SESSION_ID = fingerprintId(701);
export const LABOR_SPLIT_FLAG_ID = fingerprintId(801);
export const DATE_DEVIS = "2026-10-01";
export const VALIDITE_JOURS = 30;

export const LABOR_ROLES = {
  pose: { id: fingerprintId(501), name: "ENGINE FP pose", rate: 4000, position: 0 },
  atelier: { id: fingerprintId(502), name: "ENGINE FP atelier", rate: 3500, position: 1 },
  chantier: { id: fingerprintId(503), name: "ENGINE FP chantier", rate: 4500, position: 2 },
} as const;
type LaborRoleKey = keyof typeof LABOR_ROLES;

export const MARGIN_TIERS = [
  { id: fingerprintId(601), threshold_cents: 0, multiplier: 1.35, position: 0 },
  { id: fingerprintId(602), threshold_cents: 500_000, multiplier: 1.25, position: 1 },
  { id: fingerprintId(603), threshold_cents: 2_000_000, multiplier: 1.15, position: 2 },
] as const;

type LineNature = "supply_only" | "supply_and_labor" | "labor_only";

type SectionSpec = {
  kind: "section";
  key: string;
  parent?: string;
  position: number;
  title: string;
};

type LineSpec = {
  kind: "line";
  key: string;
  parent: string;
  position: number;
  title: string;
  unit: string;
  quantity: number;
  unitPriceCents: number;
  kFo: number;
  hMo: number;
  kMo?: number;
  majoration?: number;
  role?: LaborRoleKey;
  /** Atelier/chantier payload; the tenant labor-split flag is enabled. */
  split?: { hAtelier: number; kAtelier: number; hChantier: number; kChantier: number };
  nature: LineNature;
  /** Line tax rate when it differs from the version rate (multi-rate rows). */
  taxRateBp?: number;
};

export type FamilyFlow =
  /** Seeded draft, exported only; v2 live path, never frozen. */
  | "export"
  /** Real PDF route sequence: markEstimatePdfProcessing + generateEstimatePdfNow. */
  | "document"
  /** Document, then real manual emission (patchEstimateStatus draft -> sent). */
  | "emission"
  /** Emission, then real manual acceptance (sent -> accepted). */
  | "emission-accept"
  /** Synthetic historical issuance of a seeded v1 draft (seal written by TS). */
  | "historical-v1"
  /** Real v2 freeze (purpose send), then synthetic historical issuance. */
  | "historical-v2";

export type HistoricalSeal = {
  payloadVersion: 1 | 2 | 3 | 4;
  includeCalcEngineVersion?: boolean;
  includeLaborSplit?: boolean;
  /** Stored `seal_payload_version`; null for seals issued before the marker. */
  marker: 1 | 2 | 3 | 4 | null;
  status: "sent" | "accepted";
};

export type FamilySpec = {
  key: string;
  index: number;
  engine: 1 | 2;
  flow: FamilyFlow;
  title: string;
  exclusions: string | null;
  settings: {
    margin_mode: "fixed" | "tiered";
    margin_multiplier: number;
    discount_bp: number;
    discount_amount_cents: number | null;
    discount_mode: "simple" | "cascade";
    discount_steps: number[];
    global_coefficient: number;
    tax_rate_bp: number;
    rounding_mode: "none" | "nearest" | "up" | "down";
    rounding_step_cents: number;
    contractor_role: "principal" | "subcontractor";
  };
  historicalSeal?: HistoricalSeal;
  /** PDF layout preset requested for the document (default: client_detailed). */
  documentPreset?: "client_detailed" | "decision_summary" | "fo_mo";
  items: Array<SectionSpec | LineSpec>;
};

const simple: Omit<FamilySpec["settings"], "margin_multiplier" | "tax_rate_bp"> = {
  margin_mode: "fixed",
  discount_bp: 0,
  discount_amount_cents: null,
  discount_mode: "simple",
  discount_steps: [],
  global_coefficient: 1,
  rounding_mode: "none",
  rounding_step_cents: 100,
  contractor_role: "principal",
};

/**
 * Corpus families (§10.3): historical and fixed discounts, cascade,
 * reverse charge, several VAT rates, atelier/chantier split, decimal
 * quantities, tiers, coefficient and commercial rounding, across the v1 and
 * v2 engines and the draft, frozen, sent and accepted states.
 */
export const FAMILIES: readonly FamilySpec[] = [
  {
    key: "v1-draft-fixed-discount-bp",
    index: 1,
    engine: 1,
    flow: "document",
    title: "V1 brouillon remise 5 %",
    exclusions: "Hors raccordement électrique.",
    settings: { ...simple, margin_multiplier: 1.25, discount_bp: 500, tax_rate_bp: 2000 },
    documentPreset: "fo_mo",
    items: [
      { kind: "section", key: "s1", position: 0, title: "Plomberie sanitaire" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Tube cuivre 22 mm", unit: "ml", quantity: 12.5, unitPriceCents: 1234, kFo: 1.1, hMo: 3.25, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "WC suspendu", unit: "u", quantity: 3, unitPriceCents: 8790, kFo: 1, hMo: 0, nature: "supply_only" },
      { kind: "section", key: "s2", position: 1, title: "Chauffage" },
      { kind: "section", key: "s2a", parent: "s2", position: 0, title: "Chaufferie" },
      { kind: "line", key: "l3", parent: "s2a", position: 0, title: "Mise en service", unit: "ens", quantity: 1, unitPriceCents: 0, kFo: 1, hMo: 6.5, role: "pose", nature: "labor_only" },
      { kind: "line", key: "l4", parent: "s2a", position: 1, title: "Radiateur acier", unit: "u", quantity: 4, unitPriceCents: 15640, kFo: 1.05, hMo: 2, role: "pose", nature: "supply_and_labor" },
    ],
  },
  {
    key: "v1-draft-tiered-cascade-coefficient-rounding",
    index: 2,
    engine: 1,
    flow: "document",
    title: "V1 brouillon paliers et cascade",
    exclusions: null,
    settings: {
      ...simple, margin_mode: "tiered", margin_multiplier: 1.3, discount_mode: "cascade", discount_steps: [500, 250],
      global_coefficient: 1.05, tax_rate_bp: 1000, rounding_mode: "nearest", rounding_step_cents: 100,
    },
    documentPreset: "decision_summary",
    items: [
      { kind: "section", key: "s1", position: 0, title: "Gros œuvre" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Béton de propreté", unit: "m3", quantity: 0.333, unitPriceCents: 45000, kFo: 1, hMo: 1.2, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Isolant sous dalle", unit: "m2", quantity: 120, unitPriceCents: 1875, kFo: 1.12, hMo: 18, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l3", parent: "s1", position: 2, title: "Pompe de relevage", unit: "u", quantity: 2, unitPriceCents: 99999, kFo: 1, hMo: 0, nature: "supply_only" },
    ],
  },
  {
    key: "v1-sent-seal2",
    index: 3,
    engine: 1,
    flow: "historical-v1",
    title: "V1 envoyé, sceau 2",
    exclusions: "Validité sous réserve des prix fournisseurs.",
    settings: { ...simple, margin_multiplier: 1.18, discount_bp: 300, tax_rate_bp: 2000 },
    historicalSeal: { payloadVersion: 2, marker: 2, status: "sent" },
    documentPreset: "fo_mo",
    items: [
      { kind: "section", key: "s1", position: 0, title: "Réseaux" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Réseau PER", unit: "ml", quantity: 25, unitPriceCents: 980, kFo: 1, hMo: 5, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Nourrice", unit: "u", quantity: 1.5, unitPriceCents: 22000, kFo: 1.08, hMo: 0, nature: "supply_only" },
      { kind: "section", key: "s2", position: 1, title: "Équipements" },
      { kind: "line", key: "l3", parent: "s2", position: 0, title: "Ballon thermodynamique", unit: "u", quantity: 2, unitPriceCents: 64500, kFo: 1, hMo: 3.5, role: "pose", nature: "supply_and_labor" },
    ],
  },
  {
    key: "v1-sent-seal1-split-reverse-charge",
    index: 4,
    engine: 1,
    flow: "historical-v1",
    title: "V1 sous-traitance, sceau 1 ventilé",
    exclusions: null,
    settings: { ...simple, margin_multiplier: 1.4, tax_rate_bp: 2000, contractor_role: "subcontractor" },
    historicalSeal: { payloadVersion: 1, includeCalcEngineVersion: false, includeLaborSplit: true, marker: null, status: "sent" },
    documentPreset: "fo_mo",
    items: [
      { kind: "section", key: "s1", position: 0, title: "Sous-traitance" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Collecteur préfabriqué", unit: "u", quantity: 4, unitPriceCents: 12500, kFo: 1, hMo: 0, split: { hAtelier: 2.5, kAtelier: 1, hChantier: 4, kChantier: 1.1 }, nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Calorifuge", unit: "ml", quantity: 10, unitPriceCents: 2100, kFo: 1, hMo: 1.5, role: "pose", nature: "supply_and_labor" },
    ],
  },
  {
    key: "v1-accepted-seal1-presplit-rounding",
    index: 5,
    engine: 1,
    flow: "historical-v1",
    title: "V1 accepté, sceau 1 historique",
    exclusions: null,
    settings: { ...simple, margin_multiplier: 1.22, tax_rate_bp: 550, rounding_mode: "up", rounding_step_cents: 1000 },
    historicalSeal: { payloadVersion: 1, includeCalcEngineVersion: false, includeLaborSplit: false, marker: null, status: "accepted" },
    items: [
      { kind: "section", key: "s1", position: 0, title: "Travaux" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Robinet thermostatique", unit: "u", quantity: 7, unitPriceCents: 3333, kFo: 1, hMo: 2.75, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Forfait désembouage", unit: "fft", quantity: 1, unitPriceCents: 125000, kFo: 1, hMo: 0, nature: "supply_only" },
    ],
  },
  {
    key: "v2-draft-fixed-amount",
    index: 11,
    engine: 2,
    flow: "document",
    title: "V2 brouillon remise fixe",
    exclusions: "Hors percements.",
    settings: { ...simple, margin_multiplier: 1.3, discount_amount_cents: 12345, tax_rate_bp: 2000 },
    items: [
      { kind: "section", key: "s1", position: 0, title: "Plomberie" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Tube multicouche", unit: "ml", quantity: 8.5, unitPriceCents: 1560, kFo: 1.1, hMo: 4.25, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Mitigeur", unit: "u", quantity: 2, unitPriceCents: 31500, kFo: 1, hMo: 1.5, role: "pose", nature: "supply_and_labor" },
      { kind: "section", key: "s2", position: 1, title: "Divers" },
      { kind: "line", key: "l3", parent: "s2", position: 0, title: "Essais et réglages", unit: "ens", quantity: 1, unitPriceCents: 0, kFo: 1, hMo: 3, role: "pose", nature: "labor_only" },
    ],
  },
  {
    key: "v2-sent-accepted-discount-bp",
    index: 12,
    engine: 2,
    flow: "emission-accept",
    title: "V2 envoyé puis accepté",
    exclusions: null,
    settings: { ...simple, margin_multiplier: 1.22, discount_bp: 750, tax_rate_bp: 1000 },
    items: [
      { kind: "section", key: "s1", position: 0, title: "Lot 1" },
      { kind: "section", key: "s1a", parent: "s1", position: 0, title: "Sous-lot 1.1" },
      { kind: "line", key: "l1", parent: "s1a", position: 0, title: "Carrelage", unit: "m2", quantity: 15, unitPriceCents: 4250, kFo: 1, hMo: 7.5, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1a", position: 1, title: "Vasque", unit: "u", quantity: 3, unitPriceCents: 18990, kFo: 1.05, hMo: 0, nature: "supply_only" },
      { kind: "section", key: "s2", position: 1, title: "Lot 2" },
      { kind: "line", key: "l3", parent: "s2", position: 0, title: "Acier galvanisé", unit: "t", quantity: 0.75, unitPriceCents: 120000, kFo: 1, hMo: 0.5, role: "pose", nature: "supply_and_labor" },
    ],
  },
  {
    key: "v2-sent-cascade-coefficient-rounding",
    index: 13,
    engine: 2,
    flow: "emission",
    title: "V2 cascade, coefficient et arrondi",
    exclusions: null,
    settings: {
      ...simple, margin_multiplier: 1.28, discount_mode: "cascade", discount_steps: [1000, 500], global_coefficient: 1.08,
      tax_rate_bp: 2000, rounding_mode: "down", rounding_step_cents: 1000,
    },
    items: [
      { kind: "section", key: "s1", position: 0, title: "Chauffage" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Tube acier", unit: "ml", quantity: 33, unitPriceCents: 1789, kFo: 1, hMo: 11, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Vanne trois voies", unit: "u", quantity: 5, unitPriceCents: 7450, kFo: 1.15, hMo: 2.5, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l3", parent: "s1", position: 2, title: "Chaudière", unit: "u", quantity: 1, unitPriceCents: 250000, kFo: 1, hMo: 0, nature: "supply_only" },
    ],
  },
  {
    key: "v2-sent-labor-split-majoration",
    index: 14,
    engine: 2,
    flow: "emission",
    title: "V2 ventilation atelier et chantier",
    exclusions: null,
    settings: { ...simple, margin_multiplier: 1.35, tax_rate_bp: 2000 },
    documentPreset: "fo_mo",
    items: [
      { kind: "section", key: "s1", position: 0, title: "Atelier et chantier" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Gaine préfabriquée", unit: "ml", quantity: 7.125, unitPriceCents: 2890, kFo: 1, hMo: 0, majoration: 1.15, split: { hAtelier: 3.5, kAtelier: 1, hChantier: 6.25, kChantier: 1.2 }, nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Support", unit: "u", quantity: 2, unitPriceCents: 15000, kFo: 1, hMo: 4, majoration: 1.15, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l3", parent: "s1", position: 2, title: "Pose en hauteur", unit: "u", quantity: 1, unitPriceCents: 0, kFo: 1, hMo: 0, split: { hAtelier: 1, kAtelier: 1, hChantier: 8, kChantier: 1 }, nature: "labor_only" },
    ],
  },
  {
    key: "v2-sent-reverse-charge",
    index: 15,
    engine: 2,
    flow: "emission",
    title: "V2 sous-traitance autoliquidée",
    exclusions: null,
    settings: {
      ...simple, margin_multiplier: 1.15, discount_bp: 250, tax_rate_bp: 2000, rounding_mode: "nearest",
      rounding_step_cents: 100, contractor_role: "subcontractor",
    },
    items: [
      { kind: "section", key: "s1", position: 0, title: "Sous-traitance" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Chape", unit: "m2", quantity: 40, unitPriceCents: 2200, kFo: 1, hMo: 12, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Pompe à chaleur", unit: "u", quantity: 1, unitPriceCents: 48000, kFo: 1, hMo: 0, nature: "supply_only" },
    ],
  },
  {
    key: "v2-sent-tiered-reduced-rate",
    index: 16,
    engine: 2,
    flow: "emission",
    title: "V2 paliers, TVA 5,5 %",
    exclusions: null,
    settings: { ...simple, margin_mode: "tiered", margin_multiplier: 1.35, tax_rate_bp: 550 },
    documentPreset: "decision_summary",
    items: [
      { kind: "section", key: "s1", position: 0, title: "Rénovation énergétique" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Isolation des combles", unit: "m2", quantity: 60, unitPriceCents: 5400, kFo: 1, hMo: 30, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Fenêtre", unit: "u", quantity: 12, unitPriceCents: 21000, kFo: 1.1, hMo: 6, role: "pose", nature: "supply_and_labor" },
    ],
  },
  {
    key: "v2-historical-seal4-fixed-amount",
    index: 17,
    engine: 2,
    flow: "historical-v2",
    title: "V2 historique, sceau 4",
    exclusions: null,
    settings: { ...simple, margin_multiplier: 1.2, discount_amount_cents: 5000, tax_rate_bp: 2000 },
    historicalSeal: { payloadVersion: 4, marker: 4, status: "sent" },
    items: [
      { kind: "section", key: "s1", position: 0, title: "Équipement" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Adoucisseur", unit: "u", quantity: 10, unitPriceCents: 4500, kFo: 1, hMo: 2, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Tube PVC", unit: "ml", quantity: 3.5, unitPriceCents: 1999, kFo: 1.2, hMo: 0, nature: "supply_only" },
    ],
  },
  {
    key: "v2-historical-seal2-multi-rate",
    index: 18,
    engine: 2,
    flow: "historical-v2",
    title: "V2 historique, sceau 2, taux mixtes",
    exclusions: null,
    settings: { ...simple, margin_multiplier: 1.25, discount_bp: 500, tax_rate_bp: 1000 },
    historicalSeal: { payloadVersion: 2, marker: 2, status: "sent" },
    items: [
      { kind: "section", key: "s1", position: 0, title: "Taux mixtes" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Climatiseur", unit: "u", quantity: 2, unitPriceCents: 30000, kFo: 1, hMo: 1, role: "pose", nature: "supply_and_labor", taxRateBp: 2000 },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Faïence", unit: "m2", quantity: 6, unitPriceCents: 3800, kFo: 1, hMo: 2, role: "pose", nature: "supply_and_labor", taxRateBp: 1000 },
      { kind: "line", key: "l3", parent: "s1", position: 2, title: "Thermostat", unit: "u", quantity: 1, unitPriceCents: 9900, kFo: 1, hMo: 0, nature: "supply_only", taxRateBp: 550 },
    ],
  },
  {
    key: "v2-draft-live-cascade-coefficient",
    index: 19,
    engine: 2,
    flow: "export",
    title: "V2 brouillon non figé",
    exclusions: null,
    settings: {
      ...simple, margin_multiplier: 1.3, discount_mode: "cascade", discount_steps: [300], global_coefficient: 0.98,
      tax_rate_bp: 2000, rounding_mode: "up", rounding_step_cents: 500,
    },
    items: [
      { kind: "section", key: "s1", position: 0, title: "Chantier" },
      { kind: "line", key: "l1", parent: "s1", position: 0, title: "Tube cuivre recuit", unit: "ml", quantity: 9.999, unitPriceCents: 1111, kFo: 1.01, hMo: 2.222, role: "pose", nature: "supply_and_labor" },
      { kind: "line", key: "l2", parent: "s1", position: 1, title: "Main-d'œuvre seule", unit: "h", quantity: 4, unitPriceCents: 0, kFo: 1, hMo: 5, role: "pose", nature: "labor_only" },
    ],
  },
];

export function familyVersionId(family: Pick<FamilySpec, "index">) {
  return fingerprintId(300 + family.index);
}

export function familyItemId(family: Pick<FamilySpec, "index" | "items">, key: string) {
  const position = family.items.findIndex((item) => item.key === key);
  if (position < 0) throw new Error(`Unknown corpus item ${key}.`);
  return fingerprintId(10_000 + family.index * 100 + position + 1);
}

type JsonScalar = string | number | boolean | null;
type SeedRow = Record<string, JsonScalar | number[]>;

export type CorpusSeedPlan = {
  versions: SeedRow[];
  items: SeedRow[];
};

function roleId(role: LaborRoleKey | undefined) {
  return role ? LABOR_ROLES[role].id : null;
}

function lineRecord(family: FamilySpec, line: LineSpec): EstimateItemRecord {
  return {
    id: familyItemId(family, line.key),
    item_type: "line",
    parent_id: familyItemId(family, line.parent),
    title: line.title,
    description: line.unit,
    position: line.position,
    quantity: line.quantity,
    unit_price_ht_cents: line.unitPriceCents,
    tax_rate_bp: line.taxRateBp ?? family.settings.tax_rate_bp,
    k_fo: line.kFo,
    h_mo: line.hMo,
    h_mo_majoration: line.majoration ?? 1,
    k_mo: line.kMo ?? 1,
    labor_role_id: roleId(line.role),
    labor_role_hourly_rate_cents: line.role ? LABOR_ROLES[line.role].rate : 0,
    h_mo_atelier: line.split ? line.split.hAtelier : null,
    k_mo_atelier: line.split ? line.split.kAtelier : 1,
    labor_role_atelier_id: line.split ? LABOR_ROLES.atelier.id : null,
    labor_role_atelier_hourly_rate_cents: line.split ? LABOR_ROLES.atelier.rate : 0,
    h_mo_chantier: line.split ? line.split.hChantier : null,
    k_mo_chantier: line.split ? line.split.kChantier : 1,
    labor_role_chantier_id: line.split ? LABOR_ROLES.chantier.id : null,
    labor_role_chantier_hourly_rate_cents: line.split ? LABOR_ROLES.chantier.rate : 0,
    category_id: null,
    pu_ht_cents: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
  };
}

/**
 * Stored v1 amounts, as the historical line save and footer wrote them:
 * gross sale line, PU, line tax at the version rate, and a net footer whose
 * commercial rounding is folded into `total_tax_cents`. The v1 families that
 * carry a stored FO/MO split (labor split payload) also store it coherently.
 */
function storedAmounts(family: FamilySpec, lines: EstimateItemRecord[]) {
  const settings = family.settings;
  const reverseCharge = settings.contractor_role === "subcontractor";
  const rates = new Map(Object.values(LABOR_ROLES).map((role) => [role.id, role.rate] as const));
  const base = {
    lineItems: lines,
    marginMultiplier: settings.margin_multiplier,
    marginMode: settings.margin_mode,
    marginTiers: MARGIN_TIERS.map((tier) => ({ ...tier })),
    discountMode: settings.discount_mode,
    discountStepsBp: settings.discount_steps,
    globalCoefficient: settings.global_coefficient,
    taxRateBp: settings.tax_rate_bp,
    roundingMode: settings.rounding_mode,
    roundingStepCents: settings.rounding_step_cents,
    isLaborSplitEnabled: true,
    vatReverseCharge: reverseCharge,
  };
  const beforeDiscount = computeEstimateTotals({ ...base, discountCents: 0 });
  const discountCents = settings.discount_amount_cents ?? (beforeDiscount.saleSubtotalCents > 0
    ? Math.round((beforeDiscount.saleSubtotalCents * settings.discount_bp) / 10000) : 0);
  const totals = computeEstimateTotals({ ...base, discountCents });
  const lineTaxRateBp = reverseCharge ? 0 : settings.tax_rate_bp;
  const storeSplit = family.engine === 1 && lines.some((line) => line.h_mo_atelier !== null);
  const lineValues = new Map(lines.map((line) => {
    const values = computeEstimateLineValues(line, {
      marginMultiplier: totals.appliedMarginMultiplier,
      taxRateBp: lineTaxRateBp,
      isLaborSplitEnabled: true,
    });
    const split = computeEstimateLineSaleSplit(line, {
      marginMultiplier: totals.appliedMarginMultiplier,
      taxRateBp: lineTaxRateBp,
      laborRateById: rates,
      isLaborSplitEnabled: true,
      laborRateAtelierById: rates,
      laborRateChantierById: rates,
    });
    if (split.saleLineCents !== values.saleLineCents) {
      throw new Error(`Corpus line ${line.id} has an incoherent stored split.`);
    }
    return [line.id, {
      pu_ht_cents: values.puHtCents,
      line_total_ht_cents: values.saleLineCents,
      line_tax_cents: values.taxLineCents,
      line_total_ttc_cents: values.ttcLineCents,
      ...(storeSplit ? {
        snapshot_pu_ht_cents: values.puHtCents,
        snapshot_fo_ht_cents: split.foSaleLineCents,
        snapshot_mo_ht_cents: split.moSaleLineCents,
        snapshot_mo_atelier_ht_cents: split.moAtelierSaleLineCents,
        snapshot_mo_chantier_ht_cents: split.moChantierSaleLineCents,
      } : {}),
    }] as const;
  }));
  return {
    version: {
      margin_multiplier: totals.appliedMarginMultiplier,
      total_ht_cents: totals.saleTotalCents,
      total_tax_cents: totals.adjustedTaxCents,
      total_ttc_cents: totals.roundedTtcCents,
      rounding_adjustment_cents: totals.roundingAdjustmentCents,
    },
    lines: lineValues,
  };
}

export function buildCorpusSeedPlan(): CorpusSeedPlan {
  const versions: SeedRow[] = [];
  const items: SeedRow[] = [];
  const seenKeys = new Set<string>();
  for (const family of FAMILIES) {
    if (seenKeys.has(family.key) || family.index <= 0 || family.index >= 100) {
      throw new Error(`Corpus family ${family.key} must have a unique key and a 1-99 index.`);
    }
    seenKeys.add(family.key);
    const keys = new Set<string>();
    for (const item of family.items) {
      if (keys.has(item.key) || (item.parent !== undefined && !keys.has(item.parent))) {
        throw new Error(`Corpus family ${family.key} must list each parent before its children.`);
      }
      keys.add(item.key);
    }
    const lines = family.items
      .filter((item): item is LineSpec => item.kind === "line")
      .map((line) => lineRecord(family, line));
    const stored = storedAmounts(family, lines);
    const settings = family.settings;
    versions.push({
      id: familyVersionId(family),
      project_id: PROJECT.id,
      version_number: family.index,
      status: "draft",
      calc_engine_version: family.engine,
      title: family.title,
      exclusions: family.exclusions,
      date_devis: DATE_DEVIS,
      validite_jours: VALIDITE_JOURS,
      currency: "EUR",
      margin_mode: settings.margin_mode,
      discount_bp: settings.discount_bp,
      discount_amount_cents: settings.discount_amount_cents,
      discount_mode: settings.discount_mode,
      discount_steps: [...settings.discount_steps],
      global_coefficient: settings.global_coefficient,
      max_section_depth: 4,
      tax_rate_bp: settings.tax_rate_bp,
      rounding_mode: settings.rounding_mode,
      rounding_step_cents: settings.rounding_step_cents,
      contractor_role: settings.contractor_role,
      ...stored.version,
    });
    for (const item of family.items) {
      const id = familyItemId(family, item.key);
      const common = {
        id,
        version_id: familyVersionId(family),
        parent_id: item.parent ? familyItemId(family, item.parent) : null,
        item_type: item.kind,
        position: item.position,
        title: item.title,
      };
      if (item.kind === "section") {
        items.push(common);
        continue;
      }
      const record = lines.find((line) => line.id === id)!;
      const values = stored.lines.get(id)!;
      items.push({
        ...common,
        line_nature: item.nature,
        description: item.unit,
        quantity: item.quantity,
        unit_price_ht_cents: item.unitPriceCents,
        tax_rate_bp: record.tax_rate_bp,
        k_fo: item.kFo,
        h_mo: item.hMo,
        h_mo_majoration: record.h_mo_majoration ?? 1,
        k_mo: record.k_mo,
        labor_role_id: record.labor_role_id,
        h_mo_atelier: record.h_mo_atelier ?? null,
        k_mo_atelier: record.k_mo_atelier ?? 1,
        labor_role_atelier_id: record.labor_role_atelier_id ?? null,
        h_mo_chantier: record.h_mo_chantier ?? null,
        k_mo_chantier: record.k_mo_chantier ?? 1,
        labor_role_chantier_id: record.labor_role_chantier_id ?? null,
        ...values,
      });
    }
  }
  return { versions, items };
}

function jsonLiteral(value: unknown) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

function insertRow(table: string, row: SeedRow) {
  const columns = Object.keys(row);
  if (columns.some((column) => !/^[a-z_]+$/.test(column)) || !/^[a-z_]+$/.test(table)) {
    throw new Error("Corpus SQL identifiers must be plain lowercase names.");
  }
  const list = columns.join(", ");
  return `insert into public.${table} (${list}) select ${list} from jsonb_populate_record(null::public.${table}, ${jsonLiteral(row)});`;
}

/**
 * One transaction, run as `postgres` on the owned disposable stack after the
 * owner exists in Auth (its real bootstrap created the personal tenant). All
 * application triggers stay enabled: drafts are seeded exactly like the
 * pgTAP fixtures seed them. Any deviation aborts the whole seed.
 */
export function renderCorpusSeedSql(plan: CorpusSeedPlan = buildCorpusSeedPlan()) {
  const ids = {
    owner: OWNER.id, tenant: TENANT.id, project: PROJECT.id, session: LOCK_SESSION_ID,
    versions: plan.versions.map((version) => version.id), items: plan.items.length,
  };
  const statements = [
    "begin;",
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    `do $preflight$
declare ctx jsonb := ${jsonLiteral(ids)};
begin
  if current_user <> 'postgres' or current_database() <> 'postgres' then
    raise exception 'ENGINE_FP_SEED: the corpus is seeded only by the owned postgres connection';
  end if;
  if not exists (select 1 from auth.users where id = (ctx->>'owner')::uuid) then
    raise exception 'ENGINE_FP_SEED: the corpus owner must exist in Auth first';
  end if;
  if exists (select 1 from public.tenants where id::text like '${FINGERPRINT_ID_PREFIX}%')
    or exists (select 1 from public.estimate_projects where id::text like '${FINGERPRINT_ID_PREFIX}%')
    or exists (select 1 from public.estimate_versions where id::text like '${FINGERPRINT_ID_PREFIX}%') then
    raise exception 'ENGINE_FP_SEED: the corpus prefix is already present';
  end if;
end
$preflight$;`,
    `update public.profiles set full_name = ${sqlText(OWNER.fullName)}, job_title = ${sqlText(OWNER.jobTitle)},
  phone = ${sqlText(OWNER.phone)}, work_email = ${sqlText(OWNER.workEmail)} where id = ${sqlText(OWNER.id)}::uuid;`,
    `update public.tenant_memberships set is_default = false where user_id = ${sqlText(OWNER.id)}::uuid;`,
    `insert into public.tenants (id, name, slug) values (${sqlText(TENANT.id)}::uuid, ${sqlText(TENANT.name)}, ${sqlText(TENANT.slug)});`,
    `insert into public.tenant_memberships (tenant_id, user_id, role, is_default) values (${sqlText(TENANT.id)}::uuid, ${sqlText(OWNER.id)}::uuid, 'admin', true);`,
    ...Object.values(LABOR_ROLES).map((role) => insertRow("labor_roles", {
      id: role.id, tenant_id: TENANT.id, user_id: OWNER.id, name: role.name,
      hourly_rate_cents: role.rate, is_active: true, position: role.position,
    })),
    `delete from public.margin_tiers where tenant_id = ${sqlText(TENANT.id)}::uuid;`,
    ...MARGIN_TIERS.map((tier) => insertRow("margin_tiers", { ...tier, tenant_id: TENANT.id })),
    `delete from public.feature_flags where tenant_id = ${sqlText(TENANT.id)}::uuid and flag_key = 'EST_031_LABOR_SPLIT';`,
    insertRow("feature_flags", { id: LABOR_SPLIT_FLAG_ID, tenant_id: TENANT.id, flag_key: "EST_031_LABOR_SPLIT", enabled: true, value: null }),
    insertRow("estimate_projects", {
      id: PROJECT.id, tenant_id: TENANT.id, user_id: OWNER.id, name: PROJECT.name, reference: PROJECT.reference,
      estimate_reference: PROJECT.estimateReference, client_name: PROJECT.clientName, site_address: PROJECT.siteAddress,
    }),
    ...plan.versions.map((version) => insertRow("estimate_versions", version)),
    ...plan.items.filter((item) => !hasStoredSplit(item)).map((item) => insertRow("estimate_items", item)),
    // The stored FO/MO split columns are managed: guard_estimate_v2_snapshot_columns
    // accepts them only from service_role inside a snapshot freeze, as the
    // pgTAP governance suite writes them. Only the v1 lines that carry a stored
    // split take this path; the marker and role end with the statement block.
    ...(plan.items.some(hasStoredSplit) ? [
      "set local role service_role;",
      "select pg_catalog.set_config('miaouffrage.estimate_v2_snapshot_freeze', 'on', true);",
      ...plan.items.filter(hasStoredSplit).map((item) => insertRow("estimate_items", item)),
      "select pg_catalog.set_config('miaouffrage.estimate_v2_snapshot_freeze', 'off', true);",
      "reset role;",
    ] : []),
    `insert into public.draft_locks (version_id, user_id, session_id, expires_at)
select id, ${sqlText(OWNER.id)}::uuid, ${sqlText(LOCK_SESSION_ID)}::uuid, clock_timestamp() + interval '6 hours'
from public.estimate_versions where id::text like '${FINGERPRINT_ID_PREFIX}%' and status = 'draft';`,
    `do $readback$
declare ctx jsonb := ${jsonLiteral(ids)};
begin
  if (select count(*) from public.estimate_versions where id::text like '${FINGERPRINT_ID_PREFIX}%'
      and tenant_id = (ctx->>'tenant')::uuid and project_id = (ctx->>'project')::uuid and status = 'draft')
      <> jsonb_array_length(ctx->'versions')
    or (select count(*) from public.estimate_items where id::text like '${FINGERPRINT_ID_PREFIX}%'
      and tenant_id = (ctx->>'tenant')::uuid) <> (ctx->>'items')::integer
    or (select count(*) from public.draft_locks where version_id::text like '${FINGERPRINT_ID_PREFIX}%'
      and user_id = (ctx->>'owner')::uuid and session_id = (ctx->>'session')::uuid) <> jsonb_array_length(ctx->'versions')
    or (select count(*) from public.tenant_memberships where user_id = (ctx->>'owner')::uuid and is_default) <> 1
    or not exists (select 1 from public.tenant_memberships where user_id = (ctx->>'owner')::uuid
      and tenant_id = (ctx->>'tenant')::uuid and role = 'admin' and is_default) then
    raise exception 'ENGINE_FP_SEED: corpus readback differs from the plan';
  end if;
end
$readback$;`,
    "commit;",
    "select 'ENGINE_FP_SEED_COMMITTED';",
  ];
  return `${statements.join("\n")}\n`;
}

function hasStoredSplit(item: SeedRow) {
  return Object.hasOwn(item, "snapshot_pu_ht_cents");
}

function sqlText(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/**
 * Any edit of the corpus definition invalidates a recorded baseline; `check`
 * refuses it. Derived seed amounts are deliberately excluded: they come from
 * the frozen engine and are covered by the `seeded` stage fingerprints, so an
 * engine drift is reported as a fingerprint difference, not a corpus change.
 */
export function corpusDigest() {
  const definition = {
    prefix: FINGERPRINT_ID_PREFIX, owner: OWNER, tenant: TENANT, project: PROJECT, session: LOCK_SESSION_ID,
    flag: LABOR_SPLIT_FLAG_ID, dateDevis: DATE_DEVIS, validiteJours: VALIDITE_JOURS,
    laborRoles: LABOR_ROLES, marginTiers: MARGIN_TIERS, families: FAMILIES,
  };
  return createHash("sha256").update(JSON.stringify(canonical(definition))).digest("hex");
}
