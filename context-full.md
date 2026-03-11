# Context Full LLM

## Feature cible

`Creer une affaire a partir de document jusqu'au remplissage automatique du chiffrage`

Ce document est volontairement autonome. Il est fait pour une LLM qui n'a **pas acces au codebase**.

Il decrit:

- le flux canonique actuel
- les contrats metier utiles
- les routes API et server actions
- les schemas de donnees
- les RPC SQL critiques
- les prompts IA importants
- les implementations concurrentes a ne pas confondre

## 1. Reponse courte

Le chemin principal actuel dans le code est **affaire-first**:

1. des documents entrent dans une `affaire` via un workspace d'intake
2. les documents sont classes et un `brief affaire` est genere
3. un document tabulaire de chiffrage type DPGF peut etre importe, mappe, puis transforme en `estimate version`
4. des documents classes comme `plans` sont synchronises vers des `plan_sets`
5. un job `takeoff` est lance a partir d'un `plan_set`
6. le resultat du takeoff est revu puis applique dans le devis
7. des `price suggestions` peuvent completer le prix apres creation des lignes

Trois autres branches existent mais ne doivent pas etre confondues avec ce flux principal:

- `version-zero` drafts: pre-remplissage structurel depuis le brief confirme
- `generated-ouvrages`: generation IA d'ouvrages depuis des fragments texte
- `estimate-first takeoff`: ancien flux encore present, marque comme legacy/deprecated

## 2. Topologie fonctionnelle

### 2.1 Les 4 sous-systemes qui composent vraiment la feature

1. **Intake affaire**
   - Gere les documents entrants du dossier
   - Classe les documents
   - Genere un brief
   - Alimente le registre des hypotheses / manques

2. **Import DPGF + mapping**
   - Gere les fichiers tabulaires CSV/XLSX/Excel
   - Mappe les colonnes source vers les champs du devis
   - Cree une affaire + V1, ou une nouvelle version d'estimation

3. **Plans + takeoff**
   - Gere les jeux de plans PDF
   - Lance l'analyse IA des plans
   - Produit des items quantifies et justifies

4. **Apply + price suggestions**
   - Injecte les items takeoff revus dans le devis
   - Complete le prix avec des suggestions fondees sur historique / fournisseurs / ouvrages proches

### 2.2 Fichiers source structurants

Ces chemins sont les meilleurs points de reference si un humain veut verifier ce document:

- `src/app/dashboard/affaires/[projectId]/page.tsx`
- `src/components/affaires/AffaireHub.tsx`
- `src/lib/affaires/intake.ts`
- `src/lib/affaires/intake-server.ts`
- `src/lib/imports/server.ts`
- `src/lib/mappings/server.ts`
- `src/lib/affaires/import-flow.ts`
- `src/lib/affaires/import-flow-server.ts`
- `src/lib/affaires/intake-plan-sync.ts`
- `src/lib/takeoff/plans.ts`
- `src/lib/takeoff/schemas.ts`
- `src/lib/takeoff/prompts.ts`
- `src/lib/takeoff/server.ts`
- `src/lib/takeoff/processor.ts`
- `src/lib/takeoff/price-suggestions.ts`
- `supabase/functions/process_takeoff_job/index.ts`

## 3. Entrees utilisateur reelles

### 3.1 Hub affaire

Le point d'entree produit principal est le hub affaire:

- `src/app/dashboard/affaires/[projectId]/page.tsx`
- `src/components/affaires/AffaireHub.tsx`

Le hub affiche ou orchestre:

- le workspace d'intake
- le brief affaire
- la source DPGF liee
- les plans / metres
- la timeline des versions
- les alertes / registre
- les suggestions takeoff
- parfois la branche V0 IA

Conclusion importante:

- la feature n'est pas un simple import de document
- elle est pensee comme un workflow centralise autour d'une `affaire`

### 3.2 Surfaces UI directement impliquees

- `src/components/affaires/IntakeWorkspace.tsx`
- `src/components/affaires/BriefDraftCard.tsx`
- `src/components/affaires/UnifiedImportFlow.tsx`
- `src/components/affaires/PlansStep.tsx`
- `src/components/takeoff/TakeoffLaunchPrompt.tsx`
- `src/components/affaires/LaunchMetreDialog.tsx`
- `src/components/takeoff/TakeoffActivityCenter.tsx`
- `src/components/takeoff/TakeoffReviewPage.tsx`
- `src/components/takeoff/TakeoffApplyWizard.tsx`

## 4. Intake affaire

### 4.1 Contrat metier

Source:

- `src/lib/affaires/intake.ts`

Constantes importantes:

```ts
export const AFFAIRE_INTAKE_BUCKET = "affaire-intake";
export const AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL = "50 Mo";
```

Extensions supportees:

```ts
[
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "txt",
  "csv",
  "eml",
  "xls",
  "xlsx",
  "doc",
  "docx",
]
```

MIME types supportes:

```ts
[
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "message/rfc822",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]
```

Types de documents metier:

```ts
z.enum([
  "dpgf",
  "plans",
  "cctp",
  "bpu_dqe",
  "annexes",
  "emails",
  "a_classer",
]);
```

Statuts d'upload:

```ts
z.enum(["queued", "processing", "ready", "partial_failure", "failed"]);
```

Statuts de classification:

```ts
z.enum(["queued", "processing", "classified", "ambiguous", "failed"]);
```

Statut du brief:

```ts
z.enum(["a_confirmer", "confirme"]);
```

Structure du brief:

```ts
const affaireIntakeBriefDraftSchema = z.object({
  status: affaireIntakeBriefStatusSchema,
  summary: z.string().min(1).max(900),
  projectObject: z.string().min(1).max(400),
  scope: z.array(z.string()).max(12),
  lots: z.array(z.string()).max(20),
  receivedPieces: z.array(z.string()).max(20),
  assumptions: z.array(z.string()).max(12),
  vigilancePoints: z.array(z.string()).max(12),
  missingElements: z.array(z.string()).max(12),
  sources: z.array(affaireIntakeBriefSourceSchema).max(120),
  uploadId: z.string().uuid().nullable(),
  lastGeneratedAt: z.string().datetime().nullable(),
  confirmedAt: z.string().datetime().nullable(),
});
```

Interpretation metier:

- un upload intake peut contenir plusieurs fichiers heterogenes
- chaque fichier est classe individuellement
- le brief est une synthese normalisee du dossier
- le brief conserve de la provenance vers les documents source

### 4.2 Pipeline serveur

Source:

- `src/lib/affaires/intake-server.ts`
- `src/app/api/affaires/[projectId]/intake/files/route.ts`

Prompts IA intake:

```ts
const AFFAIRE_INTAKE_CLASSIFICATION_PROMPT_VERSION = "est371_affaire_intake_v1";
const AFFAIRE_INTAKE_CLASSIFICATION_MODEL = "gemini-3-flash-preview";
const AFFAIRE_INTAKE_CLASSIFICATION_THINKING_LEVEL = "low";

const AFFAIRE_BRIEF_PROMPT_VERSION = "est372_affaire_brief_v1";
const AFFAIRE_BRIEF_MODEL = "gemini-3-flash-preview";
```

Fonctions importantes:

```ts
createAffaireIntakeUpload(...)
processAffaireIntakeUpload(uploadId)
fetchAffaireIntakeWorkspace(projectId)
confirmAffaireBrief({ projectId })
reclassifyAffaireDocument(...)
```

Semantique:

- `createAffaireIntakeUpload(...)` enregistre l'upload et stocke les fichiers
- `processAffaireIntakeUpload(uploadId)` lance la classification et le brief
- `fetchAffaireIntakeWorkspace(projectId)` reconstruit l'etat du workspace
- `confirmAffaireBrief(...)` fige le brief et declenche les synchronisations aval
- `reclassifyAffaireDocument(...)` permet une correction humaine

Route HTTP d'upload:

- `POST /api/affaires/[projectId]/intake/files`

Elle:

1. recoit un `multipart/form-data`
2. appelle `createAffaireIntakeUpload`
3. declenche ensuite `processAffaireIntakeUpload`

### 4.3 Ce que l'intake alimente en aval

L'intake peut alimenter:

- le `brief affaire`
- le `register` de risques / hypotheses / manques
- la synchronisation des documents `plans` vers les `plan_sets`
- indirectement la branche `version-zero`

## 5. Import DPGF + mapping + creation de devis

### 5.1 Ingestion des fichiers DPGF

Sources:

- `src/lib/imports/server.ts`
- `src/app/api/imports/route.ts`

Bucket:

```ts
const DPGF_IMPORTS_BUCKET = "dpgf-imports";
```

Tables principales:

- `dpgf_imports`
- `dpgf_rows_raw`

API:

- `GET /api/imports`
- `POST /api/imports`

Le `POST /api/imports` accepte:

- `application/json`
- `multipart/form-data`

Fonctions exposees:

```ts
listUserImports(...)
createImportFromJsonBody(...)
createImportFromMultipartFormData(...)
```

Interpretation:

- l'import DPGF est un pipeline separe de l'intake affaire
- il est specialise dans les fichiers tabulaires de chiffrage

### 5.2 Mapping des colonnes source

Sources:

- `src/lib/mappings/server.ts`
- `src/lib/mappings/schemas.ts`
- `src/app/api/mappings/route.ts`

Champs cibles reconnus:

```ts
[
  "hex_code",
  "designation",
  "quantity",
  "unit",
  "unit_price_ht",
  "total_ht",
  "category",
  "supply_type",
  "supplier_ref",
  "labor_hours",
  "h_mo_majoration",
  "notes",
]
```

Champs minimaux obligatoires:

```ts
["hex_code", "designation"]
```

Actions API disponibles:

```ts
preview
suggestions
validate
duplicates
create
save-template
```

Fonctions serveur:

```ts
listMappings(...)
previewMapping(...)
suggestMapping(...)
validateMapping(...)
findDuplicates(...)
createMapping(...)
saveTemplate(...)
```

Interpretation:

- le mapping convertit des colonnes source arbitraires en semantique estimate
- sans mapping valide, l'import ne peut pas materialiser un devis propre
- le mapping utilise templates + memory + heuristiques

### 5.3 Normalisation vers des lignes de devis

Source:

- `src/lib/affaires/import-flow.ts`

Type central:

```ts
type ValidImportFlowLine = {
  mappedRowId: string;
  rowIndex: number;
  title: string;
  description: string | null;
  quantity: number;
  unitPriceHtCents: number;
  taxRateBp: number;
  kFo: number;
  hMo: number;
  hMoMajoration: number;
  kMo: number;
  puHtCents: number;
  lineTotalHtCents: number;
  lineTaxCents: number;
  lineTotalTtcCents: number;
};
```

Regles de normalisation importantes:

- `designation` est prioritaire pour le titre
- sinon fallback sur `reference` ou `hex_code`
- `quantity` doit etre `> 0`
- `unit_price_ht` est lu directement si disponible
- sinon fallback sur `total_ht / quantity`
- la TVA est convertie en basis points
- `notes` deviennent la description
- les montants finaux sont recalcules avec `computeEstimateLineValues(...)`

Extrait utile:

```ts
const resolvedUnitPrice =
  unitPriceRaw !== null
    ? unitPriceRaw
    : totalHtRaw !== null
      ? totalHtRaw / roundedQuantity
      : null;
```

Sortie statistique:

```ts
type ImportFlowStats = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  insertedRows: number;
  skippedRows: number;
};
```

### 5.4 Bridge serveur vers le RPC SQL

Source:

- `src/lib/affaires/import-flow-server.ts`

Fonctions importantes:

```ts
getCurrentMembershipOrThrow(...)
getImportOrThrow(...)
assertProjectAccessOrThrow(...)
ensureImportProjectLink(...)
fetchVersionComputationContext(...)
fetchMappedRowsForImport(...)
fetchLatestMappingId(...)
sortValidLinesForEstimateCreation(...)
toRpcImportLines(...)
```

Payload final envoye au RPC:

```ts
type RpcImportLinesPayload = {
  mapped_row_id: string;
  row_index: number;
  title: string;
  description: string | null;
  quantity: number;
  unit_price_ht_cents: number;
  tax_rate_bp: number;
  k_fo: number;
  h_mo: number;
  h_mo_majoration: number;
  k_mo: number;
  pu_ht_cents: number;
  line_total_ht_cents: number;
  line_tax_cents: number;
  line_total_ttc_cents: number;
};
```

Interpretation:

- les lignes envoyees au SQL sont deja normalisees et calculees
- le SQL ne part pas de colonnes brutes, mais d'un payload semantique propre

### 5.5 Deux ecritures metier distinctes

Sources:

- `src/app/dashboard/affaires/_actions/quick-create-affaire.ts`
- `src/app/dashboard/affaires/_actions/import-flow.ts`

#### A. Creer une affaire + premiere version depuis import

Server action:

```ts
quickCreateAffaire(input)
```

Elle peut:

- creer une affaire vide + V1 si pas d'import valide
- ou appeler le RPC `create_affaire_from_import_lines`

Signature SQL:

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

Le RPC:

- cree `estimate_projects`
- lie `dpgf_imports.project_id`
- cree `estimate_versions` numero `1`
- cree un item racine de type `section`
- cree ensuite les lignes sous cette section

#### B. Ajouter une version depuis import a une affaire existante

Server action:

```ts
confirmUnifiedImportFlow(...)
```

Elle appelle:

```ts
rpc("create_estimate_version_from_import_lines", ...)
```

Signature SQL:

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

Le RPC:

- retrouve le projet cible
- verifie que l'import est lie a ce projet
- calcule le `version_number` suivant
- reprend certains parametres de la derniere version
- cree une nouvelle version
- cree une `section`
- injecte les lignes

### 5.6 Point de vigilance important

Le flux logue explicitement:

```ts
console.warn("takeoff carry-over skipped for import flow", ...)
```

Interpretation:

- si une nouvelle version est creee depuis import, le rattachement takeoff vers cette version n'est pas garanti a 100%
- le carry-over est best-effort

## 6. Plans -> plan sets -> takeoff

### 6.1 Sync automatique des plans depuis l'intake

Source:

- `src/lib/affaires/intake-plan-sync.ts`

But:

- prendre les documents intake classes `plans`
- les recopier dans `plan_sets` / `plan_files`
- les marquer comme provenant de `affaire-intake`

Details importants:

- seuls les documents `uploaded + classified + document_kind = plans` sont eligibles
- le systeme cree ou reutilise un plan set canonique pour le projet
- le fichier est copie du bucket `affaire-intake` vers le bucket `plan-files`

Type de metadata utile:

```ts
type IntakePlanFileMetadata = {
  source: "affaire-intake";
  intake_document_id: string;
  intake_upload_id: string;
  intake_storage_path: string;
};
```

Interpretation:

- les plans utilisees par takeoff ne viennent pas directement du workspace intake
- elles sont materialisees dans une couche propre au takeoff

### 6.2 Contrat des plans

Source:

- `src/lib/takeoff/plans.ts`

Bucket:

```ts
export const PLAN_FILES_BUCKET = "plan-files";
```

Fonctions importantes:

```ts
listPlanSets(...)
createPlanSet(...)
listPlanFiles(...)
createPlanFile(...)
```

Point critique:

- `plans.ts` accepte a la fois `project_id` et `estimate_version_id`

Interpretation:

- le modele est en transition
- le flux produit actuel est oriente `project_id`
- la compatibilite `estimate_version_id` existe encore pour le legacy

## 7. Takeoff

### 7.1 But metier

Le takeoff analyse des plans PDF et produit des lignes de quantite / unite / designation qui peuvent etre appliquees au devis.

Il ne faut pas le confondre avec:

- l'import DPGF tabulaire
- le V0 structurel
- les generated ouvrages

### 7.2 Prompting et niveaux d'analyse

Source:

- `src/lib/takeoff/prompts.ts`

Versions de prompts:

```ts
export const TAKEOFF_PROMPT_VERSION_BY_LEVEL = {
  A: "takeoff-a-v1",
  B: "takeoff-b-v1",
  C: "takeoff-c-v1",
} as const;
```

Modeles observes:

- niveau `A`: `gemini-3-flash-preview`
- niveau `B`: `gemini-3.1-pro-preview`
- niveau `C`: `gemini-3.1-pro-preview`

Interpretation:

- `A` = extraction plus legere / plus economique
- `B` = extraction structurante avec tables attendues
- `C` = extraction exigeante avec confiance et evidence obligatoires

### 7.3 Schema de sortie du takeoff

Source:

- `src/lib/takeoff/schemas.ts`

Contrat simplifie:

```ts
const TakeoffItemSchema = z.object({
  designation: z.string().min(1).max(500),
  quantity: z.number().gt(0),
  unit: z.string().min(1).max(64),
  category: z.string().nullable().optional(),
  source_page: z.number().int().min(1).optional(),
  source_file: z.string().max(255).optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.string().max(2000).optional(),
});

const TakeoffMetadataSchema = z.object({
  level: z.enum(["A", "B", "C"]),
  prompt_version: z.string().max(64),
  file_type: z.string().max(64),
  schema_version: z.string().max(32),
});

const TakeoffExchangeSchema = z.object({
  items: z.array(TakeoffItemSchema),
  warnings: z.array(TakeoffWarningSchema),
  tables: z.array(TakeoffTableSchema).optional(),
  metadata: TakeoffMetadataSchema,
  confidence: z.number().min(0).max(1).optional(),
});
```

Regles supplementaires encodees:

- si `level = B`, `tables` est requis
- si `level = C`, un `confidence` global est requis
- si `level = C`, chaque item doit aussi avoir `confidence`, `source_page`, `evidence`

Interpretation:

- le takeoff n'est pas juste une liste libre de lignes
- c'est un contrat strict avec exigences croissantes selon le niveau de qualite

### 7.4 Serveur takeoff

Source:

- `src/lib/takeoff/server.ts`

Fonctions importantes:

```ts
fetchDpgfTakeoffComparison(...)
requestTakeoffPriceSuggestion(...)
saveTakeoffDpgfManualLink(...)
saveTakeoffReviewDecision(...)
applyTakeoffJob(...)
createTakeoffJobFromFormData(...)
createTakeoffJobFromPlanSet(...)
```

Interpretation des deux create:

- `createTakeoffJobFromPlanSet(...)` = chemin actuel affaire-first
- `createTakeoffJobFromFormData(...)` = chemin legacy/parallel via upload direct

### 7.5 Lancement depuis le hub affaire

Source:

- `src/app/dashboard/affaires/_actions/takeoff.ts`

Contrat:

```ts
const launchTakeoffFromPlanSetSchema = z.object({
  projectId: z.string().uuid(),
  planSetId: z.string().uuid(),
  versionId: z.string().uuid(),
  level: z.enum(["A", "B", "C"]).default("B"),
});
```

Execution:

1. `createTakeoffJobFromPlanSet(...)`
2. `triggerTakeoffJobProcessing({ jobId, trigger: "create" })`
3. revalidation du hub affaire et de la page takeoff

### 7.6 Runtime asynchrone

Sources:

- `src/lib/takeoff/processor.ts`
- `supabase/functions/process_takeoff_job/index.ts`
- `src/lib/takeoff/edge-trigger.ts`
- `src/lib/takeoff/async-worker.ts`

Role:

- recuperer les fichiers source
- choisir sync vs batch
- chunker les PDFs
- appeler Gemini
- valider contre `TakeoffExchangeSchema`
- persister `takeoff_results` et `takeoff_items`
- gerer retry / reconcile / relance

### 7.7 Revue et application

Sources:

- `src/app/dashboard/affaires/[projectId]/takeoff/[jobId]/review/page.tsx`
- `src/components/takeoff/TakeoffReviewPage.tsx`
- `src/components/takeoff/TakeoffApplyWizard.tsx`
- `src/app/api/takeoff/jobs/[jobId]/apply/route.ts`
- `supabase/migrations/20260225133000_tkf013_takeoff_apply_rpc.sql`

Signature SQL:

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

Regles metier du RPC:

- `p_strategy` doit etre `append`, `replace` ou `merge`
- le job takeoff doit etre `completed`
- la version cible doit etre `draft`
- si une section cible est fournie, elle doit appartenir a la version

Ce que fait le RPC:

- lit les `takeoff_items` non exclus
- cree ou met a jour des `estimate_items`
- ecrit `source_provider = 'takeoff'`
- attache `source_job_id`, `source_file_name`, `source_page`
- initialise les prix a `0`

Interpretation:

- le takeoff remplit d'abord la structure quantifiee
- le prix peut etre complete ensuite

## 8. Price suggestions

### 8.1 But

Source:

- `src/lib/takeoff/price-suggestions.ts`

Le moteur de suggestion de prix:

- prend des sources de prix candidates
- ecarte les outliers
- calcule `low`, `target`, `high`
- produit une confiance
- produit une justification textuelle

Type d'entree:

```ts
type TakeoffPriceSuggestionCandidate = {
  sourceKind: TakeoffPriceSuggestionSourceKind;
  kind: TakeoffDpgfComparisonEvidenceKind;
  label: string;
  sourceRef: string;
  priceCents: number;
  freshnessLabel: string | null;
  confidenceScore: number | null;
  sourceRecordTable: string | null;
  sourceRecordId: string | null;
  weight: number;
  metadata: Record<string, unknown>;
};
```

Type de sortie:

```ts
type BuiltTakeoffPriceSuggestion = {
  lowCents: number;
  targetCents: number;
  highCents: number;
  confidenceScore: number;
  confidenceLabel: "low" | "medium" | "high";
  candidateCount: number;
  outlierCount: number;
  justification: string;
  factors: TakeoffPriceSuggestionFactor[];
  summary: Record<string, unknown>;
  sources: TakeoffPriceSuggestionSource[];
};
```

Mechanique:

- quantiles ponderes a 20%, 50%, 80%
- filtrage des outliers via IQR
- score de confiance base sur:
  - diversite des sources
  - volume des sources
  - dispersion des prix

Facteurs explicatifs generes:

- bucket de quantite
- fraicheur
- historique meme projet
- match de categorie
- match d'unite

Interpretation:

- ce moteur n'invente pas un prix brut sans trace
- il produit une fourchette explicable avec provenance

## 9. Base de donnees

### 9.1 Intake / brief / registre

Migrations:

- `supabase/migrations/20260306210000_est371_affaire_intake.sql`
- `supabase/migrations/20260306224500_est372_affaire_brief.sql`
- `supabase/migrations/20260307000500_est373_affaire_register.sql`

Tables logiques:

- `affaire_intake_uploads`
- `affaire_intake_documents`
- `affaire_intake_events`
- `affaire_briefs`
- `affaire_brief_source_links`
- `affaire_register_entries`
- `affaire_register_events`

Modele mental:

- `uploads`: groupe de fichiers envoyes
- `documents`: resultat par fichier
- `briefs`: synthese du dossier
- `source_links`: provenance fine
- `register`: hypotheses, risques, manques, journalisation

### 9.2 Import DPGF / mapping / estimate creation

Migrations:

- `supabase/migrations/011_dpgf_import_tables_s3.sql`
- `supabase/migrations/012_mapping_tables_s4.sql`
- `supabase/migrations/20260305103000_ux2_011_quick_create_from_import.sql`
- `supabase/migrations/20260307113000_ux2_009_create_estimate_version_from_import_lines_section_defaults_fix.sql`

Tables logiques:

- `dpgf_imports`
- `dpgf_rows_raw`
- `dpgf_mappings`
- `dpgf_rows_mapped`
- `mapping_templates`
- `mapping_memory`

Modele mental:

- on stocke d'abord les lignes brutes
- on applique un mapping
- on obtient des lignes semantiques
- le SQL materialise ensuite `estimate_versions` et `estimate_items`

Important:

- la migration `20260307113000_...section_defaults_fix.sql` est la source de verite actuelle pour `create_estimate_version_from_import_lines`
- l'ancienne migration du meme RPC ne doit pas etre prise comme contrat final

### 9.3 Takeoff / plans / apply / pricing

Migrations:

- `supabase/migrations/20260224123000_tkf001_takeoff_schema.sql`
- `supabase/migrations/20260224203000_tkf017_takeoff_plans.sql`
- `supabase/migrations/20260305120000_v3_001_plan_sets_project_scope.sql`
- `supabase/migrations/20260305124000_v3_002_plan_sets_project_rls.sql`
- `supabase/migrations/20260305132000_v3_005_plan_sets_scope_consistency_fix.sql`
- `supabase/migrations/20260305134000_v3_006_plan_sets_scope_storage_compat.sql`
- `supabase/migrations/20260225133000_tkf013_takeoff_apply_rpc.sql`
- `supabase/migrations/20260306110000_v3_011_takeoff_version_links.sql`
- `supabase/migrations/20260306130000_v3_010_takeoff_dpgf_links.sql`
- `supabase/migrations/20260306153000_v3_010_takeoff_review_decisions_and_multi_links.sql`
- `supabase/migrations/20260306235900_est392_takeoff_price_suggestions.sql`

Tables / objets logiques:

- `takeoff_jobs`
- `takeoff_results`
- `takeoff_items`
- `plan_sets`
- `plan_files`
- `takeoff_version_links`
- tables de liens DPGF/takeoff
- tables de review decisions
- tables de suggestions de prix

Modele mental:

- `takeoff_jobs` = etat d'execution
- `takeoff_results` = artefacts / meta / couts / tokens / resultat modele
- `takeoff_items` = lignes metier reviewables et applicables
- `plan_sets` = collections de plans
- `plan_files` = fichiers PDF reels
- tables de lien = rapprochement DPGF / takeoff / versions

## 10. Flows adjacents a ne pas confondre

### 10.1 Version zero drafts

Sources:

- `src/lib/estimates/version-zero-drafts.ts`
- `src/app/api/estimates/[versionId]/version-zero-drafts/route.ts`
- `src/lib/estimates/structure-drafts.ts`
- `src/lib/estimates/schemas.ts`

Fonctions importantes:

```ts
fetchVersionZeroDraftSummary(...)
generateVersionZeroDraft(...)
materializeVersionZeroDraft(...)
```

Point critique:

```ts
unit_price_ht_cents: 0
```

Interpretation:

- le V0 remplit surtout une structure de devis
- il n'est pas un moteur complet de pricing final
- il peut utiliser le brief confirme comme source de construction

### 10.2 Generated ouvrages

Sources:

- `src/lib/estimates/generated-ouvrages.ts`
- `src/app/dashboard/affaires/_actions/generated-ouvrages.ts`
- `supabase/migrations/20260307110000_est381_generated_ouvrages.sql`
- `supabase/migrations/20260307173000_est383_generated_ouvrage_subdetails.sql`

Interpretation:

- autre strategie IA
- plus proche d'une generation d'ouvrages depuis fragments de texte
- distincte de takeoff et distincte du V0

### 10.3 Legacy estimate-first takeoff

Sources:

- `src/app/dashboard/estimates/[versionId]/takeoff/new/page.tsx`
- `src/app/dashboard/estimates/[versionId]/takeoff/[jobId]/page.tsx`
- `src/app/dashboard/estimates/[versionId]/takeoff/[jobId]/review/page.tsx`
- `src/components/takeoff/TakeoffUploadForm.tsx`
- `src/components/takeoff/TakeoffJobMonitor.tsx`
- `src/components/takeoff/TakeoffDeprecationBanner.tsx`

Interpretation:

- ancien flux encore vivant
- utile pour comprendre l'historique
- ne pas le prendre comme chemin principal de la feature

## 11. Confusions frequentes a eviter

1. **Intake affaire** et **import DPGF** sont deux pipelines differents.
   - Intake: heterogene, dossier complet, classification + brief
   - DPGF import: tabulaire, mapping, creation de version

2. **Takeoff** et **V0** ne servent pas la meme chose.
   - Takeoff: extraction depuis plans PDF
   - V0: pre-remplissage structurel depuis brief

3. **Takeoff apply** ne fixe pas forcement les prix.
   - les lignes sont appliquees avec prix initiaux a zero
   - les suggestions de prix viennent ensuite

4. **Creer une affaire depuis import** et **creer une nouvelle version depuis import** sont deux actions distinctes.

5. **Project scope** et **estimate version scope** coexistent encore dans les plans.
   - la direction actuelle est `project_id`
   - `estimate_version_id` est surtout un heritage de compatibilite

6. **La DB doit etre lue via les migrations**, pas seulement via les types generes.

7. **Le carry-over takeoff n'est pas parfaitement garanti** lors de certaines creations de version.

## 12. Lecture recommandee si une LLM devait simuler l'architecture

Ordre logique:

1. comprendre le hub affaire
2. comprendre intake + brief
3. comprendre import DPGF + mapping
4. comprendre materialisation SQL du devis
5. comprendre sync des plans
6. comprendre takeoff schemas + prompts
7. comprendre processor + apply
8. comprendre price suggestions
9. seulement ensuite regarder V0 / generated ouvrages / legacy

## 13. Resume final ultra-opinionated

Si une LLM doit raisonner sur cette feature sans se perdre, elle doit retenir ceci:

- le **flux principal** est `affaire -> intake -> brief -> DPGF import -> plans -> takeoff -> apply -> price suggestions`
- le **DPGF** cree ou enrichit la structure du devis depuis du tabulaire
- le **takeoff** cree ou enrichit les lignes depuis des plans PDF
- le **pricing auto** est une couche a part, apres creation des lignes
- le **V0** et les **generated ouvrages** sont des branches IA adjacentes, pas le coeur unique du parcours

En une phrase:

> cette codebase implemente plusieurs formes de "remplissage automatique du chiffrage", mais le chemin le plus robuste et le plus actuel passe par une affaire centralisee, une ingestion documentaire, un import DPGF pour la structure, puis un takeoff de plans pour completer les quantites et enfin des suggestions de prix pour consolider le chiffrage.
