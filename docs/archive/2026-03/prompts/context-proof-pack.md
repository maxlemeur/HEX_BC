# TIMAX vNext Context Proof Pack

Ce document est un pack de contexte autonome pour une LLM sans acces au repo.
Il combine:
- une lecture produit du flux principal;
- des preuves techniques ciblees sous forme d'extraits de code;
- une distinction explicite entre `prouve`, `partiel` et `inference`.

Il sert a repondre a cette question:

> Dans quelle mesure TIMAX tient deja la promesse
> "je depose mes documents, TIMAX structure, quantifie, aide au pricing et boucle le chiffrage"
> et que faut-il construire pour la vNext, avec une UX centree affaire ?

## 1. Regle de lecture

- `Prouve`: l'extrait ci-dessous montre directement la capability.
- `Partiel`: le code montre une brique reelle, mais pas la promesse complete.
- `Inference`: deduction raisonnable a partir du code, mais non prouvee de bout en bout.

## 2. Thèse centrale

Le flux principal prouve dans la codebase est:

`affaire -> intake documentaire -> brief -> import DPGF tabulaire -> mapping -> creation de version -> sync plans -> takeoff IA -> review/apply -> suggestions de prix`

Les branches adjacentes existent aussi:
- `version-zero`: generation d'une structure V0 a partir du brief.
- `generated-ouvrages`: suggestions d'ouvrages depuis des extraits documentaires.
- `takeoff estimate-first`: ancien flux encore present mais non canonique.

La promesse marketing depasse encore le flux principal sur plusieurs points:
- DPGF PDF vers lignes de devis dans le pipeline canonique;
- drop unique de grilles fournisseurs connecte directement au pricing affaire;
- arbitrage automatique fournisseur par ligne avec stock;
- finish line totalement automatique devis + commandes.

## 3. Objets metier a connaitre

- `estimate_projects`: l'affaire.
- `estimate_versions`: les versions de devis/chiffrage d'une affaire.
- `dpgf_imports`: un import tabulaire source.
- `dpgf_rows_raw` / `dpgf_rows_mapped`: lignes source puis mappees.
- `plan_sets` / `plan_files`: plans exploitables pour le takeoff.
- `takeoff_jobs` / `takeoff_items`: jobs IA et quantites extraites.
- `supplier_prices` / `pricebook` / catalogue: base de suggestions fournisseur.
- `purchase_orders`: bons de commande.

## 4. Flux principal prouve

### 4.1 Hub affaire

Statut: `Prouve`

Le hub affaire assemble dans une meme page:
- intake
- source DPGF
- marge
- plans / takeoff
- registre
- version zero

Extrait:

```ts
import { AffaireHub } from "@/components/affaires/AffaireHub";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import {
  fetchAffaireHubDpgfSource,
  fetchAffaireHubMarginAnalysis,
  fetchAffaireHubPlansSummary,
  fetchAffaireHubSummary,
  fetchAffaireHubTimeline,
} from "@/lib/affaires/server";
import { fetchVersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";

const summaryPromise = fetchAffaireHubSummary(projectId);
const timelinePromise = fetchAffaireHubTimeline(projectId, timelinePage);
const dpgfSourcePromise = fetchAffaireHubDpgfSource(projectId);
const marginAnalysisPromise = fetchAffaireHubMarginAnalysis(projectId);
const intakeWorkspacePromise = fetchAffaireIntakeWorkspace(projectId);
```

Lecture:
- l'affaire est bien le conteneur UX principal;
- le produit assemble deja plusieurs sous-systemes autour d'un meme projet.

### 4.2 Intake documentaire affaire

Statut: `Prouve`

Le moteur intake prend un dossier heterogene, classe les pieces, genere un brief et synchronise plans + registre.

Extrait:

```ts
import {
  AFFAIRE_INTAKE_BUCKET,
  AFFAIRE_INTAKE_ALLOWED_EXTENSIONS,
  AFFAIRE_INTAKE_ALLOWED_MIME_TYPES,
  AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS,
  affaireIntakeBriefDraftSchema,
  affaireIntakeDocumentKindSchema,
} from "@/lib/affaires/intake";
import { syncTakeoffPlanSetFromAffaireIntake } from "@/lib/affaires/intake-plan-sync";
import {
  syncAffaireRegisterFromBrief,
  syncAffaireRegisterMissingPieces,
} from "@/lib/affaires/register-server";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";
```

Indices structurants verifies dans la couche intake:
- types documentaires: `dpgf`, `plans`, `cctp`, `bpu_dqe`, `annexes`, `emails`, `a_classer`
- upload bucket dedie
- classification IA
- generation/confirmation du brief
- sync vers plan sets takeoff
- sync vers registre affaire

Modeles/prompts utilises dans cette couche:

```ts
// indices verifies dans src/lib/affaires/intake-server.ts
"est371_affaire_intake_v1"
"gemini-3-flash-preview"
"est372_affaire_brief_v1"
"gemini-3-flash-preview"
```

Lecture:
- TIMAX sait deja absorber des pieces heterogenes dans une affaire;
- ce n'est pas encore le meme pipeline que l'import tabulaire DPGF.

### 4.3 Import DPGF canonique

Statut: `Prouve` pour CSV/XLSX, `Partiel` pour PDF

Le parseur canonique d'import ne traite que les formats tabulaires.

Extrait:

```ts
export type ImportSourceFormat = "json" | "csv" | "xlsx";

export function detectImportSourceFormat(
  filename: string,
  mimeType: string | null | undefined
): "csv" | "xlsx" {
  if (lowerName.endsWith(".csv") || lowerType.includes("csv")) {
    return "csv";
  }

  if (
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls") ||
    lowerName.endsWith(".xlsm") ||
    lowerType.includes("spreadsheet") ||
    lowerType.includes("excel")
  ) {
    return "xlsx";
  }

  return "csv";
}
```

Lecture:
- le flux robuste prouve est tabulaire;
- la promesse "DPGF PDF -> lignes de devis" n'est pas prouvee dans ce pipeline.

### 4.4 Mapping DPGF

Statut: `Prouve`

Le mapping de colonnes est une vraie brique applicative avec preview, suggestions, validation, templates et memoire.

Extrait:

```ts
export type MappingValidation = {
  is_valid: boolean;
  missing_required_fields: MappingTargetField[];
  duplicate_target_assignments: Array<{ target: MappingTargetField; sources: string[] }>;
  mapped_sources_count: number;
  mapped_targets_count: number;
};

export type MappingSuggestion = {
  suggestions: SourceToTargetMapping;
  source_columns: string[];
  templates: TemplateRow[];
  sample_values: Record<string, string[]>;
  confidence_by_source: Record<string, MappingSuggestionConfidence>;
  template_exact_match: MappingTemplateExactMatch | null;
  auto_validation: MappingAutoValidation;
};
```

Lecture:
- le systeme ne fait pas qu'importer des lignes brutes;
- il mappe explicitement les colonnes source vers la semantique devis.

### 4.5 Creation d'affaire et de version depuis import

Statut: `Prouve`

Il existe deux chemins serveur:
- creer une nouvelle affaire + V1 depuis import;
- creer une nouvelle version dans une affaire existante depuis import.

Extrait server action `confirmUnifiedImportFlow`:

```ts
const { data, error } = await input.supabase.rpc("create_estimate_version_from_import_lines", {
  p_project_id: input.projectId,
  p_import_id: input.importId,
  p_version_title: input.versionTitle,
  p_section_title: input.sectionTitle,
  p_lines: input.lines,
});
```

Extrait server action `quickCreateAffaire`:

```ts
const { data: rpcData, error: rpcError } = await supabase.rpc(
  "create_affaire_from_import_lines",
  {
    p_import_id: importId,
    p_project_name: projectName,
    p_project_client: clientName,
    p_project_reference: reference,
    p_version_title: normalizeNullableText(parsed.data.versionTitle),
    p_section_title: normalizeNullableText(parsed.data.sectionTitle),
    p_lines: toRpcImportLines(
      sortValidLinesForEstimateCreation(normalizedRows.validLines)
    ),
  }
);
```

Lecture:
- "creer une affaire depuis document tabulaire" est deja reel;
- la materialisation estimate est un contrat SQL stable, pas un bricolage front.

### 4.6 Contrats SQL de materialisation

Statut: `Prouve`

RPC pour creer une nouvelle version depuis import:

```sql
create or replace function public.create_estimate_version_from_import_lines(
  p_project_id uuid,
  p_import_id uuid,
  p_version_title text,
  p_section_title text,
  p_lines jsonb
)
returns table (
  version_id uuid,
  section_id uuid,
  inserted_count integer,
  total_ht_cents integer,
  total_tax_cents integer,
  total_ttc_cents integer
)
```

RPC pour creer une nouvelle affaire + V1 depuis import:

```sql
create or replace function public.create_affaire_from_import_lines(
  p_import_id uuid,
  p_project_name text,
  p_project_client text default null,
  p_project_reference text default null,
  p_version_title text default null,
  p_section_title text default null,
  p_lines jsonb default '[]'::jsonb
)
returns table (
  project_id uuid,
  version_id uuid,
  section_id uuid,
  inserted_count integer,
  total_ht_cents integer,
  total_tax_cents integer,
  total_ttc_cents integer
)
```

Lecture:
- la creation du devis n'est pas theorique;
- elle est encapsulee dans deux RPC centrales.

### 4.7 Plans -> takeoff IA

Statut: `Prouve`

Le takeoff moderne est plan-set centric et lance des jobs asynchrones rattaches a une version de devis.

Extrait:

```ts
export async function createTakeoffJobFromPlanSet(input: {
  projectId: string;
  planSetId: string;
  estimateVersionId: string;
  level?: TakeoffLevel;
}): Promise<TakeoffJobCreateResponse> {
  // Verify plan set belongs to the project and tenant
  const { data: planSetRow } = await supabase
    .from("plan_sets")
    .select("id")
    .eq("id", input.planSetId)
    .eq("project_id", input.projectId)
    .eq("tenant_id", tenantId)
    .single();

  const { data: insertedJob } = await supabase
    .from("takeoff_jobs")
    .insert({
      id: jobId,
      tenant_id: tenantId,
      estimate_version_id: input.estimateVersionId,
      plan_set_id: input.planSetId,
      level,
      status: "pending",
    })
```

Lecture:
- le takeoff n'est pas seulement un upload libre;
- il s'appuie sur des plans synchronises dans l'affaire.

### 4.8 Prompting et niveaux takeoff

Statut: `Prouve`

Le moteur IA n'est pas monolithique: il distingue les niveaux A/B/C, les modeles et les contraintes de schema.

Extrait:

```ts
export const TAKEOFF_PROMPT_VERSION_BY_LEVEL = {
  A: "takeoff-a-v1",
  B: "takeoff-b-v1",
  C: "takeoff-c-v1",
} as const;

export const TAKEOFF_LEVEL_MODEL_MATRIX = {
  A: { model: "gemini-3-flash-preview", thinkingLevel: "low" },
  B: { model: "gemini-3.1-pro-preview", thinkingLevel: "medium" },
  C: { model: "gemini-3.1-pro-preview", thinkingLevel: "high" },
} as const;
```

Extrait schema:

```ts
export const TakeoffItemSchema = z.object({
  designation: requiredTextSchema.max(500),
  quantity: positiveQuantitySchema,
  unit: requiredTextSchema.max(64),
  category: optionalNullableTextSchema.optional(),
  source_page: positiveIntegerSchema.optional(),
  source_file: requiredTextSchema.max(255).optional(),
  confidence: confidenceSchema.optional(),
  evidence: requiredTextSchema.max(2000).optional(),
}).strict();

if (payload.metadata.level === "C") {
  if (payload.confidence === undefined) { ... }
  if (item.confidence === undefined) { ... }
  if (item.source_page === undefined) { ... }
  if (!item.evidence || item.evidence.trim().length === 0) { ... }
}
```

Lecture:
- la promesse "confiance, evidence, page source" est reellement codee;
- elle est surtout forte sur le niveau C, pas uniforme sur tous les niveaux.

### 4.9 Classification de documents takeoff

Statut: `Prouve` pour la recommandation de type, `Partiel` pour DPGF PDF canonique

Le moteur takeoff sait reconnaitre des PDFs tabulaires, mais cela ne prouve pas encore l'integration dans le pipeline DPGF canonique.

Extrait:

```ts
export type TakeoffDocumentClass =
  | "structured"
  | "tabular_pdf"
  | "complex_plan"
  | "unsupported";

if (matchedTableHints.length > 0 && matchedPlanHints.length === 0) {
  return buildRecommendation({
    documentClass: "tabular_pdf",
    recommendedLevel: "B",
    compatibleLevels: ["B", "C"],
    recommendationStrength: "high",
    signals,
  });
}
```

Lecture:
- il existe une capacite de classification `tabular_pdf`;
- mais elle vit cote takeoff, pas dans le parseur canonique `csv/xlsx`.

### 4.10 Apply takeoff dans le devis

Statut: `Prouve`

Le takeoff applique les quantites dans la version de devis via une RPC atomique avec strategies `append`, `replace`, `merge`.

Extrait TypeScript:

```ts
export async function applyTakeoffJob(
  jobId: string,
  body: unknown
): Promise<TakeoffApplyResponse> {
  if (jobRow.status !== "completed") {
    throw new TakeoffError({
      message: "Le job doit etre en statut completed pour etre applique.",
    });
  }
}
```

Extrait SQL:

```sql
create or replace function public.apply_takeoff_job(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid default null
)
returns table (
  created_count integer,
  updated_count integer,
  ignored_count integer,
  created_ids uuid[],
  scope text
)
```

Lecture:
- l'application au chiffrage est reelle;
- elle reste un workflow de review/apply, pas un full-auto sans etape de controle.

## 5. Pricing fournisseur et arbitrage

### 5.1 Suggestions de prix takeoff

Statut: `Prouve`

Le systeme calcule une fourchette `low/target/high`, une confiance, une justification et des sources.

Extrait:

```ts
export type BuiltTakeoffPriceSuggestion = {
  lowCents: number;
  targetCents: number;
  highCents: number;
  confidenceScore: number;
  confidenceLabel: "low" | "medium" | "high";
  candidateCount: number;
  outlierCount: number;
  justification: string;
  factors: TakeoffPriceSuggestionFactor[];
  sources: TakeoffPriceSuggestionSource[];
};
```

Extrait de justification:

```ts
const segments = [
  countsByKind.get("pricebook")
    ? `${countsByKind.get("pricebook")} source fournisseur`
    : null,
  countsByKind.get("history")
    ? `${countsByKind.get("history")} reference interne`
    : null,
  countsByKind.get("similar_item")
    ? `${countsByKind.get("similar_item")} ouvrage proche`
    : null,
];
```

Lecture:
- TIMAX sait assister le pricing;
- la suggestion est explicable et multi-sources.

### 5.2 Import de grilles fournisseurs

Statut: `Partiel`

Il existe un import CSV de pricebook avec mapping et resolution des inconnus.

Extrait:

```ts
const TARGET_FIELDS = [
  { value: "supplier_name", label: "Fournisseur", required: true },
  { value: "product_reference", label: "Reference produit" },
  { value: "product_designation", label: "Designation produit" },
  { value: "unit_price", label: "Prix unitaire", required: true },
  { value: "currency", label: "Devise" },
];

const GUIDE_STEPS = ["Charger", "Detection", "Associer", "Resoudre", "Importer"];
```

Lecture:
- il y a bien une brique pricebook/import fournisseur;
- mais la promesse "je drop 4 Excel fournisseurs dans l'affaire et le moteur les exploite automatiquement" n'est pas encore prouvee de bout en bout.

### 5.3 Comparaison fournisseur par ligne

Statut: `Partiel fort`

Il existe une API de comparaison fournisseur par ligne avec alternatives `best_price`, `most_recent`, `preferred_supplier`.

Extrait:

```ts
type SupplierAlternativeKind = "best_price" | "most_recent" | "preferred_supplier";

const alternativeKindOrder: SupplierAlternativeKind[] = [
  "best_price",
  "most_recent",
  "preferred_supplier",
];
```

Extrait:

```ts
export async function getEstimateSupplierComparisons(
  versionId: string,
  itemIds: string[]
) {
  const { data: rows } = await supabase
    .from("estimate_items")
    .select("id, item_type, title, selected_supplier_price_id")

  const suggestionsEntries = await Promise.all(
    Array.from(queryByNormalizedKey.entries()).map(async ([normalizedQuery, query]) => {
      const suggestion = await suggestEstimateCataloguePrices(versionId, query);
      return [normalizedQuery, suggestion] as const;
    })
  );

  return {
    stale_price_days: stalePriceDays,
    comparisons,
  };
}
```

Lecture:
- la comparaison fournisseur ligne par ligne existe;
- elle est assistee, pas encore prouvee comme arbitrage automatique global sans validation humaine.

### 5.4 Stock-aware pricing

Statut: `Absent`

Je n'ai pas trouve de preuve ciblee d'un arbitrage prix integre avec stock temps reel.

Implication:
- la phrase marketing "le cuivre chez A, le PVC chez B, la robinetterie en stock" n'est pas soutenue telle quelle.

## 6. Aide IA cote devis

### 6.1 Version zero depuis brief

Statut: `Prouve`, mais `adjacent`

Le systeme sait generer une V0 structurelle depuis le brief, mais ce n'est pas le flux principal DPGF/takeoff.

Point important verifie dans le code:
- la materialisation de V0 cree des lignes avec prix a `0`.

Lecture:
- utile pour preparer le devis;
- ne doit pas etre vendu comme moteur de pricing final.

### 6.2 Generated ouvrages

Statut: `Prouve`, mais `adjacent`

Cette branche propose des ouvrages depuis des extraits documentaires.

Lecture:
- capability reelle d'assistance;
- a ne pas confondre avec l'import DPGF ni avec le takeoff.

### 6.3 Explications IA sur ligne / diff

Statut: `A confirmer`

Des indices existent dans la codebase selon une exploration precedente, mais ce pack ne les re-prouve pas directement ici.

Regle pour la LLM:
- ne pas presenter cette capability comme certaine si elle n'est pas documentee ailleurs dans le contexte fourni.

## 7. Finish line: export, envoi, commandes

### 7.1 Export PDF devis

Statut: `Prouve`

L'API de generation et de recuperation du PDF devis existe.

Extrait:

```ts
import {
  generateEstimatePdfNow,
  getEstimatePdfStatus,
  markEstimatePdfFailed,
  markEstimatePdfProcessing,
} from "@/lib/estimates/pdf-generator";

export async function POST(request: Request, { params }) {
  const currentStatus = await getEstimatePdfStatus(versionId);
  await markEstimatePdfProcessing(versionId);
  after(async () => {
    await generateEstimatePdfNow(versionId, {
      force,
      triggeredBy: "manual",
    });
  });
}
```

Lecture:
- l'export PDF devis n'est pas a classer `absent`.

### 7.2 Envoi email du devis

Statut: `Prouve`

Le systeme sait forcer la generation du PDF puis envoyer l'email avec piece jointe.

Extrait:

```ts
const generatedPdf = await generateEstimatePdfNow(input.versionId, {
  force: true,
  triggeredBy: "send",
});

const { data, error } = await resend.emails.send({
  from: getRequiredEnvVar("EMAIL_FROM"),
  to: input.payload.to,
  cc: input.payload.cc,
  subject: input.payload.subject,
  react: EstimateEmailTemplate(...),
  attachments: [
    {
      filename: buildAttachmentFilename(projectName, version.version_number),
      content: pdfBuffer,
    },
  ],
});
```

Lecture:
- la sortie "le devis PDF part au client" est deja largement couverte.

### 7.3 Export BDC

Statut: `Prouve`

L'export version supporte explicitement le mode `bdc`.

Extrait:

```ts
type ExportMode = "standard" | "dpgf" | "bdc";

const exported =
  mode === "dpgf"
    ? await streamEstimateVersionDpgfXlsx(versionId)
    : mode === "bdc"
      ? await streamEstimateVersionBdcV11Xlsx(versionId)
      : await streamEstimateVersionXlsx(versionId);
```

Lecture:
- la finish line documentaire est plus avancee que "absente";
- cela ne prouve pas encore une generation automatique de commandes fournisseurs.

### 7.4 Purchase orders

Statut: `Prouve` pour le module, `Partiel` pour la chaine automatique depuis le devis

Il existe un vrai sous-systeme de bons de commande:
- API CRUD
- ecrans `/dashboard/orders`
- lignes, statuts, pieces jointes devis

Extrait API create:

```ts
type CreatePurchaseOrderPayload = {
  supplierId: string;
  deliverySiteId: string;
  expectedDeliveryDate?: string | null;
  notes?: string | null;
  items: LinePayload[];
};

const { data: insertedOrder } = await supabase
  .from("purchase_orders")
  .insert({
    reference: tempReference,
    supplier_id: parsedPayload.supplierId,
    delivery_site_id: parsedPayload.deliverySiteId,
    status: "draft",
  })
  .select("id, order_number")
  .single();
```

Lecture:
- le module commande existe clairement;
- en revanche, le chainage automatique "devis final -> arbitrage fournisseur -> BC prets" reste seulement `partiel`.

## 8. Capabilities: synthese honnete

### 8.1 Solides

- affaire hub unifie comme point d'entree principal
- intake documentaire avec classification et brief
- import DPGF tabulaire CSV/XLSX
- mapping de colonnes avec preview, validation, templates
- creation affaire/version depuis import via RPC SQL
- takeoff sur plans PDF avec jobs asynchrones
- review/apply des quantites dans le devis
- suggestions de prix explicables
- export PDF devis
- envoi email du devis
- export BDC
- module purchase orders

### 8.2 Partielles

- DPGF PDF: classification/indices adjacents, mais pas pipeline canonique prouve
- import des grilles fournisseurs: present via pricebook CSV, pas encore experience affaire-first "drop all"
- comparaison fournisseur ligne par ligne: presente, mais arbitre automatique global non prouve
- plans annotes a la main: support fichiers oui, robustesse manuscrite non prouvee
- chaine estimate -> commandes fournisseurs pretes: module present, orchestration automatique non prouvee

### 8.3 Adjacentes

- version zero depuis brief
- generated ouvrages depuis texte
- legacy takeoff estimate-first

### 8.4 Absentes ou non prouvees

- stock-aware pricing
- fermeture complete de la boucle pricing sans intervention
- ouvrages techniques metier reconnus de facon explicite et generalisee dans le flux canonique
- promesse "zero erreur de nomenclature" comme garantie forte

## 9. Conclusion pour la promesse produit

### Ce que TIMAX peut dire honnetement aujourd'hui

TIMAX est deja credible comme plateforme `affaire-first` qui:
- centralise un dossier heterogene;
- produit un brief exploitable;
- cree une version de devis depuis un DPGF tabulaire;
- quantifie des plans PDF avec provenance et revue;
- assiste le pricing;
- exporte et envoie le devis;
- dispose d'un module de bons de commande.

### Ce que TIMAX ne doit pas encore surpromettre

- "DPGF PDF importe automatiquement dans le meme pipeline robuste que CSV/XLSX"
- "4 grilles fournisseurs deposees dans l'affaire sont automatiquement normalisees et arbitrees par ligne"
- "choix fournisseur optimise avec stock en temps reel"
- "chiffrage final entierement boucle sans revue humaine"

## 10. Implications vNext

Si l'objectif produit est:

> "deposer tout le dossier le matin et boucler un chiffrage fiable avant midi"

alors les priorites vNext sont:

1. Unifier l'UX autour d'un seul parcours affaire visible de bout en bout.
2. Brancher un vrai `DPGF PDF -> pipeline import canonique`.
3. Integrer les imports fournisseurs dans le flux affaire, pas a cote.
4. Transformer la comparaison fournisseur assistee en preselection exploitable a grande echelle.
5. Relier explicitement le devis final aux commandes fournisseurs.

## 11. Fichiers source de reference

- `src/app/dashboard/affaires/[projectId]/page.tsx`
- `src/lib/affaires/intake-server.ts`
- `src/lib/imports/parser.ts`
- `src/lib/mappings/server.ts`
- `src/app/dashboard/affaires/_actions/import-flow.ts`
- `src/app/dashboard/affaires/_actions/quick-create-affaire.ts`
- `src/lib/takeoff/server.ts`
- `src/lib/takeoff/prompts.ts`
- `src/lib/takeoff/schemas.ts`
- `src/lib/takeoff/document-classifier.ts`
- `src/lib/takeoff/price-suggestions.ts`
- `src/components/catalogue/PriceBookCsvImport.tsx`
- `src/lib/estimates/server.ts`
- `src/app/api/estimates/[versionId]/pdf/route.ts`
- `src/lib/email/send-estimate.ts`
- `src/app/api/estimates/[versionId]/export/route.ts`
- `src/app/api/purchase-orders/route.ts`
- `supabase/migrations/20260307113000_ux2_009_create_estimate_version_from_import_lines_section_defaults_fix.sql`
- `supabase/migrations/20260305103000_ux2_011_quick_create_from_import.sql`
- `supabase/migrations/20260225133000_tkf013_takeoff_apply_rpc.sql`
