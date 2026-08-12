# Domaine — Imports & mappings (chaîne DPGF)

> **Source : le code au 2026-08-02.** Les références de fichier désignent le contrat opérationnel ; en cas de divergence, le code fait foi et ce document doit être corrigé.

`AGENTS.md:97-100` pose quatre invariants de domaine : chemin canonique `dpgf_rows_raw` → mappings → `confirmUnifiedImportFlow` ; les imports PDF alimentent ce contrat partagé sans forker CSV/XLS/XLSX ; les régressions PDF couvrent extraction **et** import canonique ; la provenance (`sourceDocumentId`, `_timax_provenance`) est préservée. Ce document décrit l'implémentation qui réalise ces invariants.

## Pipeline canonique

```
        ┌──────────────── CSV / XLSX / XLS ────────────────┐   ┌──────── PDF ────────┐
        │                                                  │   │                     │
  fichier < 5 Mo                          fichier ≥ 5 Mo   │   │  POST /api/imports/tabular-pdf/review-file
  worker navigateur                       upload multipart │   │  extractTabularPdfTablesFromFile
  (csv|xlsx-parser.worker)                                 │   │  buildTabularPdfImportReview
        │                                                  │   │           │
        │ rows[] JSON                                      │   │  revue humaine : approbation explicite
        ▼                                                  ▼   ▼           │ des tableaux (TabularPdfReviewPanel)
  POST /api/imports (application/json)      POST /api/imports (multipart)   │
  createImportFromJsonBody                  createImportFromMultipartFormData
        │                                                  │               │
        │  sourceKind = "tabular"                          │  sourceKind = "tabular_pdf"
        │  normalizeRowsFromJson                           │  buildApprovedTabularPdfRows
        │                                                  │  (+ _timax_provenance)
        └────────────────┬─────────────────────────────────┴───────────────┘
                         ▼
            ★ POINT DE CONVERGENCE : insertRawRows()
              NormalizedImportRow[] → table dpgf_rows_raw (payload jsonb)
                         │
                         ▼
        POST /api/mappings  action=suggestions | preview | validate | duplicates | create
        (templates → mémoire → heuristiques ; bandes de confiance ; auto-validation)
                         │
                         ▼
            dpgf_mappings (status validated) + dpgf_rows_mapped (payload jsonb)
                         │
                         ▼
        confirmUnifiedImportFlow()  →  mode "mapping_only"
                         │            ou "version_created"
                         ▼
        façade persistCanonicalEstimateV2
        → RPC persist_estimate_creation_atomic (service-role, actor-scoped)
                         │
                         ▼
        estimate_versions + estimate_items  →  /dashboard/estimates/{versionId}/edit
```

## 1. Routes et points d'entrée

| Route / action | Méthode & contenu | Fichier | Rôle |
|---|---|---|---|
| `/api/imports` | `GET` | `src/app/api/imports/route.ts:27-39` | Liste les imports du tenant, filtre `project_id`/`projectId` |
| `/api/imports` | `POST application/json` | `src/app/api/imports/route.ts:45-49` | `createImportFromJsonBody` (rows pré-parsées ou tables PDF approuvées) |
| `/api/imports` | `POST multipart/form-data` | `src/app/api/imports/route.ts:51-55` | `createImportFromMultipartFormData` (parsing serveur) |
| autre `Content-Type` | — | `src/app/api/imports/route.ts:57-59` | `415 UNSUPPORTED_MEDIA_TYPE` |
| `/api/imports/tabular-pdf/review` | `POST application/json` | `src/app/api/imports/tabular-pdf/review/route.ts:11-19` | Revue d'un payload `tables` déjà extrait, sans persistance |
| `/api/imports/tabular-pdf/review-file` | `POST multipart/form-data` | `src/app/api/imports/tabular-pdf/review-file/route.ts:18-40` | Extraction + revue depuis le fichier PDF, sans persistance |
| `/api/mappings` | `GET` | `src/app/api/mappings/route.ts:36-56` | Mappings + templates (`limit` défaut 50, max 200 — `src/lib/mappings/schemas.ts:120-123`) |
| `/api/mappings` | `POST` | `src/app/api/mappings/route.ts:59-91` | Union discriminée sur `action` (`src/lib/mappings/schemas.ts:111-118`) |
| `confirmUnifiedImportFlow` | server action | `src/app/dashboard/affaires/_actions/import-flow.ts:207-428` | Mapping + création de version |
| `getUnifiedImportFlowTakeoffCarryOverPreview` | server action | `src/app/dashboard/affaires/_actions/import-flow.ts:165-205` | Aperçu carry-over takeoff |

Ces routes sont désormais gouvernées par le registre OpenAPI. Le validateur
inventorie les méthodes réellement exportées par tous les fichiers `route.ts`
et exige une partition exacte entre opérations documentées et exclusions
justifiées. À l'échelle de l'application, le contrat courant compte 165
opérations documentées et 5 exclusions d'infrastructure ou de compatibilité.

## 2. Formats supportés

| Format | Détection | Parsing | `source_format` persisté | `sourceKind` |
|---|---|---|---|---|
| CSV | extension `.csv` ou MIME contenant `csv` (`src/lib/imports/parser.ts:155-157`) | worker navigateur `src/workers/csv-parser.worker.ts` ou worker Node `src/lib/imports/parser.ts:174-207` | `csv` | `tabular` |
| XLSX / XLS / XLSM | extension ou MIME `spreadsheet`/`excel` (`src/lib/imports/parser.ts:159-166`) | worker navigateur `src/workers/xlsx-parser.worker.ts` ou worker Node | `xlsx` | `tabular` |
| **PDF tabulaire** | nom `.pdf` ou MIME contenant `pdf` (`src/lib/imports/server.ts:652-657`) | `extractTabularPdfTablesFromFile` (`src/lib/imports/tabular-pdf-extraction.ts:1023-1034`) | `pdf` | `tabular_pdf` |
| JSON | `sourceFormat`/`source_format`/`parser` (`src/lib/imports/server.ts:332-340`) | `normalizeRowsFromJson` (`src/lib/imports/parser.ts:396-406`) | `json` (défaut) | `tabular` |

Les extensions acceptées par l'UI sont `csv, xlsx, xls, pdf` (`src/components/affaires/unified-import-flow/types.ts:24`, `src/components/imports/importWizardFileScan.ts:6-11`). La contrainte SQL autorise `json, csv, xlsx, pdf` (`supabase/migrations/20260311123000_ux2_allow_pdf_source_format.sql:5-6`), qui remplace la contrainte initiale `('json','csv','xlsx')` de `supabase/migrations/011_dpgf_import_tables_s3.sql:9`.

## 3. Étape navigateur — sélection, pré-scan, parsing worker

`useImportFlow` (`src/hooks/useImportFlow.ts:448-698`) arbitre trois trajets :

- **Worker navigateur** si `file.size <= 5 242 880` octets (`CLIENT_PARSE_MAX_SIZE_BYTES`, `src/hooks/useImportFlow.ts:56`, test ligne 507). `useFileParser` instancie `csv-parser.worker.ts` ou `xlsx-parser.worker.ts` (`src/hooks/useFileParser.ts:78-88`) avec un délai de `20000` ms (`WORKER_TIMEOUT_MS`, `src/hooks/useFileParser.ts:52`). Les lignes parties sont postées en JSON par `postWorkerImport` (`src/hooks/useImportFlow.ts:254-285`).
- **Repli serveur** en cas d'échec worker (`worker_error`) ou de fichier trop volumineux (`file_too_large`) : `postServerFallback` (`src/hooks/useImportFlow.ts:366-446`), en `XMLHttpRequest` pour la progression d'upload (`:386-433`).
- **PDF** : `postTabularPdfReview` puis `postReviewedPdfImport` (`src/hooks/useImportFlow.ts:287-319`, `:321-362`).

Le worker CSV détecte le délimiteur parmi `, ; \t |` sur la première ligne non vide (`src/workers/csv-parser.worker.ts:28`, `:81-100`) et l'encodage entre `utf-8` et `windows-1252` par comptage de caractères de remplacement (`src/workers/csv-parser.worker.ts:169-200`). Les deux workers dédoublonnent les en-têtes par suffixe `_2`, `_3` (`src/workers/csv-parser.worker.ts:42-51`, `src/workers/xlsx-parser.worker.ts:33-42`).

Pour un classeur multi-onglets, les parseurs XLSX serveur et navigateur évaluent les 30 premières lignes de chaque feuille à partir des marqueurs DPGF (désignation, quantité, unité, prix fourniture, heures de main-d’œuvre et commentaire). La feuille obtenant le meilleur score est retenue ; en cas d’égalité, la première feuille DPGF éligible dans l’ordre du classeur gagne. En l’absence de marqueur, le comportement historique est conservé avec la première feuille. Ce choix partagé évite d’importer un onglet de paramètres tel que `Renseignement`.

Le pré-scan d'en-têtes de l'assistant autonome lit les 8192 premiers octets pour un CSV et 10 lignes pour un classeur (`src/components/imports/importWizardFileScan.ts:31`, `:50`) ; il exige au moins 3 cellules non numériques pour retenir une ligne d'en-tête XLSX (`:65-75`) et au moins 2 en-têtes pour passer à l'état `ready` (`src/components/imports/useImportWizardFileStage.ts:167-175`).

La liste des imports est re-sondée toutes les `3000` ms tant qu'un import est en statut `pending`, `parsing` ou `processing` (`src/hooks/useImportFlow.ts:57-58`, `:663-673`).

## 4. Détection de la ligne d'en-tête

`resolveHeaderRowIndex` (`src/lib/imports/header-row.ts:170-194`) est partagé par le parseur serveur (`src/lib/imports/parser.ts:366-368`) et les deux workers navigateur (`src/workers/csv-parser.worker.ts:213`, `src/workers/xlsx-parser.worker.ts:60`).

- Un `headerRowNumber` manuel (entier ≥ 1) court-circuite l'heuristique ; hors limites ou ligne vide lèvent une erreur (`src/lib/imports/header-row.ts:176-191`). Normalisation en `src/lib/imports/header-row.ts:130-146`, validation côté API en `src/lib/imports/server.ts:291-301`.
- Sinon `detectHeaderRowIndex` note chaque ligne (`src/lib/imports/header-row.ts:47-114`) : densité `min(nonEmpty,12) × 2`, unicité `× 6`, mots-clés métier `× 12`, cellules textuelles `× 2`, pénalité numérique `× -6`, pénalité de position `-min(rowIndex,40) × 0,1`, bonus `+8` dès 2 mots-clés, malus `-12` pour une ligne à une seule cellule, malus `-12` pour une ligne courte contenant `dpgf|projet|devis|bordereau`. Le vocabulaire retenu est listé en `src/lib/imports/header-row.ts:1-21`.

Les en-têtes « Optima » `Type FO`/`Famille FO` et `Majoration MO`/`Temps major…` sont normalisés en `Type_FO` et `Majoration_MO` (`src/lib/imports/parser.ts:36-57`).

## 5. Extraction PDF tabulaire

`extractLayoutTextFromPdf` (`src/lib/imports/tabular-pdf-extraction.ts:994-1015`) tente PDF.js dans un **worker thread Node** puis, si l'échec n'est pas un dépassement de budget, se replie sur le binaire `pdftotext -layout` (`:942-990`). Un `PdfExtractionBudgetError` n'est jamais retenté (`:1002-1004`, `:1009-1011`) — cohérent avec `AGENTS.md:103` qui exige un thread terminable plutôt qu'un simple `Promise.race`.

Le script worker charge PDF.js avec `disableWorker: true`, `isEvalSupported: false`, `useWorkerFetch: false` (`src/lib/imports/tabular-pdf-extraction.ts:307-313`) et reconstruit un texte à disposition préservée en projetant chaque item sur une grille de colonnes (`:184-245`, doublon TypeScript `:653-717`).

| Budget | Valeur | Référence |
|---|---|---|
| Pages maximum | `200` | `src/lib/imports/tabular-pdf-extraction.ts:34` |
| Items texte par page | `20 000` | `src/lib/imports/tabular-pdf-extraction.ts:35` |
| Items texte cumulés | `100 000` | `src/lib/imports/tabular-pdf-extraction.ts:36` |
| Octets de texte reconstruit | `5 × 1024 × 1024` | `src/lib/imports/tabular-pdf-extraction.ts:37` |
| Caractères par ligne rendue | `20 000` | `src/lib/imports/tabular-pdf-extraction.ts:38` |
| Caractères par item brut | `20 000` | `src/lib/imports/tabular-pdf-extraction.ts:39` |
| Délai d'extraction | `15 000` ms | `src/lib/imports/tabular-pdf-extraction.ts:40`, appliqué en `:859-863` et comme `timeout` de `pdftotext` en `:969` |

La détection de tableaux découpe les pages sur `\f` (`:423-428`), sépare les colonnes sur `|` puis sur 2 espaces ou plus (`:430-448`), et retient un bloc comme tableau s'il compte au moins 2 lignes, un en-tête d'au moins 2 cellules et au moins une ligne de données (`:461-492`). Le titre est la dernière ligne non tabulaire précédant le bloc (`:509-512`).

## 6. Revue PDF avant import

`buildTabularPdfImportReview` (`src/lib/imports/tabular-pdf.ts:355-416`) classe chaque tableau :

| Code d'anomalie | Sévérité | Déclencheur | Référence |
|---|---|---|---|
| `missing_headers` | `error` | moins de 2 en-têtes non vides | `src/lib/imports/tabular-pdf.ts:277-283` |
| `duplicate_headers` | `warning` | en-têtes dupliqués après minuscules | `src/lib/imports/tabular-pdf.ts:285-293` |
| `empty_table` | `error` | aucune ligne, ou toutes les lignes creuses | `src/lib/imports/tabular-pdf.ts:295-302`, `:318-323` |
| `sparse_rows` | `warning` | au moins une ligne à moins de 2 cellules remplies | `src/lib/imports/tabular-pdf.ts:324-330` |
| `row_width_mismatch` | `warning` | largeur de ligne ≠ nombre d'en-têtes | `src/lib/imports/tabular-pdf.ts:332-338` |

La décision par tableau est `reject` si une anomalie `error` existe, `review` s'il reste des avertissements, sinon `approve` (`src/lib/imports/tabular-pdf.ts:343-353`). L'état global vaut `manual_required` sans tableau approuvable, `light_validation` si tous les approuvables sont `approve`, `reinforced_validation` sinon (`:393-399`). L'aperçu expose les 3 premières lignes de chaque tableau (`:375`).

Le panneau `TabularPdfReviewPanel` (`src/components/imports/TabularPdfReviewPanel.tsx:57-252`) coche par défaut les `suggested_approved_tables` (`src/components/affaires/unified-import-flow/UploadStep.tsx:93`, `src/components/imports/useImportWizardFileStage.ts:146`), désactive les cases des tableaux `reject` (`TabularPdfReviewPanel.tsx:141`, `:157`) et bloque la soumission tant qu'aucun tableau n'est retenu (`:237`).

## 7. Convergence vers le contrat partagé

Les deux trajets d'écriture aboutissent à la **même fonction** `insertRawRows` (`src/lib/imports/server.ts:863-883`), qui insère des `NormalizedImportRow` dans `dpgf_rows_raw` par lots de `500` (`IMPORT_ROWS_BATCH_SIZE`, `src/lib/imports/server.ts:30`) :

- JSON : `src/lib/imports/server.ts:1011`, après `buildApprovedTabularPdfRows` pour un PDF (`:990-996`) ou `normalizeJsonRowsFromInput` sinon.
- Multipart : `src/lib/imports/server.ts:1176`, après la branche PDF (`:1148-1171`) ou `parseImportFile` (`:1172-1174`).

Aucun schéma parallèle n'existe pour le PDF : `buildApprovedTabularPdfRows` produit le même type `NormalizedImportRow` que le parseur tabulaire (`src/lib/imports/tabular-pdf.ts:434-437`, `src/lib/imports/parser.ts:5`), avec le même dédoublonnage d'en-têtes par suffixe numérique (`src/lib/imports/tabular-pdf.ts:140-150`) et la même règle de rejet des lignes entièrement nulles (`:160-162`, `:465-467`). Le moteur de mapping lit `dpgf_rows_raw.payload` sans distinguer l'origine (`src/lib/mappings/server.ts:972-991`).

Garde-fous d'entrée pour `tabular_pdf` :

- `sourceKind` doit valoir `tabular` ou `tabular_pdf` ; toute autre valeur est rejetée sans repli (`src/lib/imports/server.ts:379-399`).
- Un payload portant des marqueurs PDF (`tables`, `approvedTables`, `provenanceDefaults`, enveloppes `{cells, provenance}`) sans `sourceKind` explicite est rejeté (`src/lib/imports/server.ts:358-377`, `:394-396`).
- `validation.approvedTables` doit contenir au moins une entrée (`src/lib/imports/server.ts:597-601`, `:984-988`).
- Une ligne référençant un tableau non approuvé est rejetée (`src/lib/imports/server.ts:635-639`) ; un tableau approuvé mais classé `reject` fait échouer la construction (`src/lib/imports/tabular-pdf.ts:456-461`).
- Le chemin multipart PDF approuve automatiquement les `suggested_approved_tables` et échoue si l'ensemble est vide (`src/lib/imports/server.ts:1156-1162`).

## 8. Provenance

La clé réservée est `_timax_provenance` (`src/lib/imports/payload.ts:1`), portant `source_page`, `table_index`, `source_file_name`, `source_document_id` (`src/lib/imports/payload.ts:3-8`). Elle est attachée à chaque ligne PDF retenue (`src/lib/imports/tabular-pdf.ts:469-481`, `src/lib/imports/server.ts:641`) et voyage donc dans `dpgf_rows_raw.payload`.

`sourceDocumentId` entre par le champ multipart `sourceDocumentId`/`source_document_id` (`src/lib/imports/server.ts:1104-1106`, `src/app/api/imports/tabular-pdf/review-file/route.ts:29-34`) ou par les valeurs par défaut du payload JSON (`src/lib/imports/server.ts:462-493`). Le nom de fichier de l'import est dérivé de la provenance quand elle est disponible (`src/lib/imports/server.ts:495-520`, `:534-542`).

Côté mapping, la clé est explicitement exclue des colonnes source et des valeurs d'exemple par `isImportReservedKey` (`src/lib/imports/payload.ts:10-12`, appelée en `src/lib/mappings/server.ts:582` et `:605`) : elle est donc conservée en base sans jamais être proposée comme colonne mappable.

## 9. Persistance et autorisation

| Table | Création | Colonnes ajoutées ensuite |
|---|---|---|
| `dpgf_imports` | `supabase/migrations/011_dpgf_import_tables_s3.sql:3-16` | `tenant_id` (`013_multitenant_core_s5.sql:236`, défaut `current_tenant_id()` `:488`, `not null` `:512`), `project_id` (`20260305_ux2_007_link_dpgf_to_project.sql:3-4`) |
| `dpgf_rows_raw` | `011_dpgf_import_tables_s3.sql:28-35` (unique `(import_id, row_index)`) | `tenant_id` (`013:238`, `:489`, `:513`) |
| `dpgf_rows_mapped` | `011_dpgf_import_tables_s3.sql:42-49` | `tenant_id` (`013:240`, `:490`, `:514`) |
| `dpgf_mappings` | `012_mapping_tables_s4.sql:49-61` | `tenant_id` (`013:247`, `:494`, `:518`) |
| `mapping_templates` | `012_mapping_tables_s4.sql:3-14` | `tenant_id` (`013:243`) ; unique passée de `(user_id, name)` à `(tenant_id, user_id, name)` (`020_multitenant_unique_keys_s5.sql:17-21`) |
| `mapping_memory` | `012_mapping_tables_s4.sql:26-37` | `tenant_id` (`013:245`) ; unique `(tenant_id, user_id, source_column, target_field)` (`20260305_ux2_007_link_dpgf_to_project.sql:438-443`) |

Aucun type `enum` PostgreSQL n'existe pour ce domaine : tous les statuts sont des colonnes `text` sous contrainte `CHECK`. Statuts autorisés : `dpgf_imports.status ∈ {pending, parsing, completed, failed}` (`011:10`) ; `dpgf_imports.parse_mode ∈ {worker, server}` (`011:13`) ; `dpgf_rows_mapped.status ∈ {pending, mapped, rejected}` (`011:47`) ; `dpgf_mappings.status ∈ {draft, validated, applied, archived}` (`012:55`). `mapping_memory.confidence` est un `numeric(5,4)` borné `[0,1]` avec défaut `1.0000` (`012:34`), `usage_count` a un `CHECK >= 1` et un défaut `1` (`012:33`).

En aval, `dpgf_catalogue_links` relie une ligne mappée au catalogue (`supabase/migrations/014_catalogue_pricebook_indices_s4.sql:73-86`, unique `(tenant_id, mapped_row_id)` ligne `85`, statuts `{linked, ignored, error}` ligne `83`), et `supplier_pricebook` conserve `source_import_id` / `source_mapped_row_id` (`014:18-19`).

RLS — état final par table :

| Table | Politiques finales | Référence |
|---|---|---|
| `dpgf_imports` | 4 politiques séparées : `SELECT` propriétaire-ou-`admin`, `INSERT`/`UPDATE`/`DELETE` réservés à `admin`/`engineer` via `has_tenant_role` | `20260713134332_harden_ingestion_audit_boundaries.sql:7-36`, `:38-64`, `:66-111`, `:113-129` |
| `dpgf_rows_raw` | 4 politiques séparées, même découpage | `20260713134332…:133-151`, `:153-175`, `:177-218`, `:220-242` |
| `dpgf_rows_mapped` | une seule politique `ALL`, propriétaire de l'import ou `admin` — **non durcie** par la migration de juillet | `013_multitenant_core_s5.sql:1650-1679` |
| `dpgf_mappings` | politique `ALL` via `dpgf_imports` | `013_multitenant_core_s5.sql:1719-1748` |
| `mapping_templates` | politique `ALL`, propriétaire ou `admin` du tenant | `013_multitenant_core_s5.sql:1681-1698` |
| `mapping_memory` | politique `ALL`, propriétaire ou `admin` du tenant | `013_multitenant_core_s5.sql:1700-1717` |

Les politiques initiales par utilisateur seul datent de `011:66-113` et `012:83-116`. Une étape intermédiaire ajoute la garde projet sur `dpgf_imports` (`20260305_ux2_007_link_dpgf_to_project.sql:33-76`).

Côté serveur, `requireImportWriteRole` refuse tout rôle autre que `admin`/`engineer` (`src/lib/imports/server.ts:741-747`), tandis que la revue PDF n'exige qu'une session authentifiée (`src/lib/imports/server.ts:703-705`).

Bucket Storage `dpgf-imports` : privé, `file_size_limit` `52428800` octets (`011:115-129`). Les politiques d'écriture exigent le rôle `admin`/`engineer` et un premier segment de chemin égal à l'`auth.uid()` (`20260713134332…:248-259`, `:261-280`, `:282-293`). La politique de **lecture** `"Users can view own dpgf imports"` (`011:145-152`) n'a jamais été droppée ni durcie : elle reste au niveau `auth.uid()` sans contrôle de rôle.

Sa liste `allowed_mime_types` (`011:121-127`) contient `text/csv`, `application/csv`, `application/vnd.ms-excel`, la MIME XLSX et `application/octet-stream`, **pas** `application/pdf` ; aucune migration ultérieure ne la modifie (preuve : `grep -rn "allowed_mime_types" supabase/migrations/` ne renvoie pour ce bucket que `011:115`). Or le chemin multipart PDF téléverse dans ce bucket en propageant le `file.type` du fichier (`src/lib/imports/server.ts:1121-1126`, `getUploadContentType` `:647-650`). L'effet réel sur un déploiement dépend de l'application de cette liste par Supabase Storage : **non vérifié** ici. Le trajet PDF effectivement exercé par l'UI est le trajet JSON (`src/hooks/useImportFlow.ts:321-362`), qui ne téléverse rien dans le bucket.

Chemin de stockage : `{userId}/{YYYY-MM-DD}/{uuid}-{nom assaini}` (`src/lib/imports/server.ts:688-691`, assainissement `:271-279`). Taille maximale acceptée à l'entrée : `50 × 1024 × 1024` octets (`src/lib/imports/server.ts:29`, contrôle `:693-701`). Le fichier téléversé est supprimé si l'enregistrement d'import n'a pas pu être créé (`src/lib/imports/server.ts:1193`).

Le parsing serveur XLSX/CSV s'exécute dans un `node:worker_threads` avec un délai de `30 000` ms (`PARSE_TIMEOUT_MS`, `src/lib/imports/parser.ts:172-173`, application `:298-323`).

`createImportFromJsonBody` écrit `parse_mode: "worker"` en dur (`src/lib/imports/server.ts:1005`), y compris pour l'import PDF approuvé, alors que le client envoie `parseMode: "server"` (`src/hooks/useImportFlow.ts:334-335`) — ce champ client n'est lu nulle part dans `createImportFromJsonBody`. Le chemin multipart écrit `parse_mode: "server"` (`src/lib/imports/server.ts:1142`).

## 10. Moteur de mapping

Champs cibles (12) : `hex_code, designation, quantity, unit, unit_price_ht, total_ht, category, supply_type, supplier_ref, labor_hours, h_mo_majoration, notes` (`src/lib/mappings/schemas.ts:5-18`). Requis : `hex_code` et `designation` (`src/lib/mappings/schemas.ts:21-24`).

`suggestMapping` (`src/lib/mappings/server.ts:1365-1509`) applique trois sources par ordre de priorité :

1. **Template exact** — un template dont les colonnes normalisées (minuscules, accents retirés, espaces compactés) correspondent exactement à celles de l'import donne un score de `1` sur toutes les colonnes (`src/lib/mappings/server.ts:430-474`, `:1395-1405`). Une collision de colonnes normalisées annule la correspondance (`:418-420`).
2. **Mémoire de mapping** — score `0,4 × confidence + 0,6 × min(1, ln(usage+1)/ln(6))` (`MEMORY_CONFIDENCE_WEIGHT`, `MEMORY_USAGE_WEIGHT`, `MEMORY_USAGE_LOG_BASE` en `src/lib/mappings/server.ts:141-143` ; calcul `:482-500`).
3. **Heuristiques lexicales** — table de correspondances avec scores fixes de `0,45` à `0,58` (`src/lib/mappings/server.ts:793-891`) : `Type FO` → `supply_type` `0,58`, `Majoration MO` → `h_mo_majoration` `0,57`, `hex` → `hex_code` `0,58`, `qte`/`qt` → `quantity` `0,58`, `pu` → `unit_price_ht` `0,58`, `designation`/`libelle` → `designation` `0,56`, `unite` → `unit` `0,52`, `montant`/`total` → `total_ht` `0,54`, `heure`/`labor` → `labor_hours` `0,53`, `categorie`/`famille` → `category` `0,50`, `ref` → `supplier_ref` `0,45`, `note`/`comment` → `notes` `0,45`.

Bandes de confiance : `high` si score `> 0,8`, `medium` si `>= 0,5`, `low` sinon (`HIGH_CONFIDENCE_THRESHOLD`, `MEDIUM_CONFIDENCE_THRESHOLD` en `src/lib/mappings/server.ts:139-140`, fonction `:330-334`). Rendu visuel en `src/components/mappings/ColumnMapper.tsx:26-34`, `:43-57`.

Une seule colonne peut viser un champ donné : les candidats sont triés par score, puis priorité d'origine `template(3) > memory(2) > heuristic(1)`, puis usage, puis confiance mémoire, puis ordre alphabétique (`src/lib/mappings/server.ts:476-480`, `:502-534`).

**Auto-validation** : possible seulement si les deux champs requis sont mappés avec un score strictement supérieur à `0,8` (`src/lib/mappings/server.ts:536-570`). Elle est consommée en mode simplifié uniquement (`src/components/affaires/unified-import-flow/MappingStep.tsx:110-112`, `:136-144`).

**Doublons** : regroupement par `hex_code||designation` normalisés en minuscules, en ignorant les lignes dont l'une des deux valeurs est vide (`src/lib/mappings/server.ts:718-765`). Limite `duplicates` : défaut `1000`, maximum `10000` (`src/lib/mappings/schemas.ts:84`) ; `createMapping` scanne systématiquement `10000` lignes (`src/lib/mappings/server.ts:1563-1567`).

Autres bornes : aperçu `limit` défaut `20`, maximum `200` (`src/lib/mappings/schemas.ts:67`) ; échantillon de suggestions `100` lignes (`src/lib/mappings/server.ts:1374`) ; pagination interne `1000` lignes (`src/lib/mappings/server.ts:998`, `:1031`) ; templates chargés pour la suggestion `20` (`:1073`) ; valeurs d'exemple `3` par colonne, tronquées à 37 caractères plus `...` au-delà de 40 (`src/lib/mappings/server.ts:595`, `:618`) ; nom de template `120` caractères (`src/lib/mappings/schemas.ts:104`).

## 11. Application du mapping

`createMapping` (`src/lib/mappings/server.ts:1541-1697`) restreint le mapping aux colonnes réellement présentes (`:1559`), refuse un mapping invalide (`:1242-1246`, `:1561`), insère la ligne `dpgf_mappings` en statut `validated` (`:1590`), puis remplace intégralement `dpgf_rows_mapped` pour l'import : collecte des identifiants existants, `delete`, puis `insert` par lots de `500` (`:1644-1686`). L'échec d'insertion après suppression est journalisé pour reprise manuelle mais n'est pas compensé (`:1678-1685`).

Chaque ligne mappée conserve à la fois la ligne brute et la ligne mappée, plus les champs mappés à plat et les alias `reference`, `hex_code`, `designation`, `supply_type`, `h_mo_majoration` (`src/lib/mappings/server.ts:1613-1641`).

La mémoire est mise à jour via le RPC `upsert_mapping_memory_bulk`, en mode non bloquant : un échec est seulement journalisé (`src/lib/mappings/server.ts:1151-1189`). Le RPC insère avec `usage_count = 1` et `confidence = 0.6000`, et sur conflit incrémente l'usage et applique `confidence ← min(0,98 ; round(c + (1−c) × 0,15 ; 4))` (`supabase/migrations/20260305011000_ux2_010_mapping_memory_upsert_variable_conflict_fix.sql:54-75`).

Les templates sont écrits en `upsert` sur `(tenant_id, user_id, name)` (`src/lib/mappings/server.ts:1227`) ; poser `is_default` remet à `false` les autres templates du même utilisateur (`:1202-1213`).

## 12. Flux d'import unifié et création d'affaire

Étapes : `upload → mapping → preview → confirmation`, plus `plans` quand le module takeoff est actif (`src/components/affaires/unified-import-flow/types.ts:8-19`, orchestration `src/components/affaires/UnifiedImportFlow.tsx:244-290`). L'étape upload ne passe à la suivante que lorsque l'import atteint un statut terminal `parsed`, `imported` ou `completed` (`src/components/affaires/unified-import-flow/types.ts:41-45`, `UploadStep.tsx:53-62`).

`confirmUnifiedImportFlow` (`src/app/dashboard/affaires/_actions/import-flow.ts:207-428`) :

1. Authentification et résolution du tenant courant (`:215-226`, `src/lib/affaires/import-flow-server.ts:49-71`).
2. Refus si l'import est déjà lié à une autre affaire. En mode `mapping_only`,
   la liaison au projet reste explicite ; lorsqu'une version doit être créée,
   la liaison est laissée à la transaction canonique afin d'éviter un projet ou
   un import partiellement persisté.
3. Création du mapping si un mapping non vide est fourni, sinon reprise du dernier mapping de l'import (`:270-288`).
4. Chargement des lignes de `dpgf_rows_mapped` (`import-flow-server.ts:180-201`) et du contexte de calcul de la dernière version (`:155-178`, défauts `marginMultiplier = 1`, `taxRateBp = 2000` en `:22-23`).
5. Garde-fou de cohérence : si la version source du carry-over takeoff a changé depuis l'aperçu, la confirmation est refusée (`:309-317`).
6. Sans `createEstimate`, retour en mode `mapping_only` avec statistiques (`:328-343`).
7. Sinon appel de `persistCanonicalEstimateV2` avec une source `import`, report
   des jobs takeoff après succès de la transaction, puis redirection vers
   `/dashboard/estimates/{versionId}/edit`.

Normalisation des lignes en lignes de chiffrage (`src/lib/affaires/import-flow.ts:168-300`) : titre = `designation` sinon `reference`/`hex_code` (`:199-210`) ; quantité strictement positive requise, arrondie au millième (`:212-222`) ; prix unitaire déduit de `total_ht / quantité` si absent (`:226-231`) ; taux de TVA interprété en pourcentage si `≤ 100`, plafonné à `10 000` points de base (`MAX_TAX_RATE_BP`, `:58`, `:150-161`). Motifs d'invalidité : `missing_title`, `invalid_quantity`, `invalid_unit_price`, `invalid_tax_rate`, `invalid_row_payload` (`:33-42`). Les nombres localisés FR/EN sont normalisés en `:79-144`. Les lignes valides sont triées par `rowIndex` puis identifiant avant l'appel RPC (`src/lib/affaires/import-flow-server.ts:224-232`).

`persistCanonicalEstimateV2` est le contrat applicatif unique de création non
dupliquée. Il normalise la hiérarchie et la provenance DPGF, calcule le moteur
v2 et ses totaux, puis appelle `persist_estimate_creation_atomic` avec le tenant
et l'identifiant de l'acteur. Cette RPC `security definer`, exécutable seulement
par le service role, revérifie l'acteur, le tenant actif, la propriété ou le rôle
admin, verrouille l'import, refuse tout lien concurrent, puis persiste projet,
version, items et liaison d'import dans la même transaction.

Les RPC historiques `create_estimate_version_from_import_lines` et
`create_affaire_from_import_lines` restent visibles dans l'historique des
migrations pour la reproductibilité, mais leurs droits d'exécution sont
révoqués par `20260812032857_govern_estimate_calc_engine_v2.sql` et elles n'ont
plus d'appelant applicatif.

Chemin autonome parallèle : `/dashboard/imports` (`src/app/dashboard/imports/page.tsx:15`) puis `/dashboard/mappings?import_id=…` (`src/app/dashboard/mappings/page.tsx:22-38`), avec le même `useImportFlow` et le même panneau de revue PDF (`src/components/imports/ImportWizard.tsx:24-70`, `src/components/imports/ImportWizardFileStageSection.tsx:236-237`).

## 12.1 Import XLSX structuré (contrat du 2026-08-02)

Cette section remplace, pour le flux unifié, les règles historiques de quantité
strictement positive et de section générique unique décrites plus haut.

### Métadonnée XLSX réservée

Les parseurs XLSX serveur et navigateur effectuent une seconde lecture avec
ExcelJS. Chaque ligne brute reçoit la clé réservée **_timax_structure** :

- **sheet_name** et **source_row_number** ;
- **bold_columns** et **merged_columns**, après normalisation des en-têtes ;
- **outline_level** si le classeur porte un niveau de plan ;
- **column_order**, nécessaire pour repérer la première colonne après la
  persistance en JSONB.

**_timax_structure** et **_timax_provenance** restent dans le payload brut, mais
**isImportReservedKey** les masque des colonnes, exemples et propositions du
mapping. Une ligne ne contenant que ces métadonnées n'est pas une ligne métier.

### Mapping DPGF

Les priorités dédiées sont : **PR. FO → unit_price_ht**, **h MO →
labor_hours**, **Qte → quantity**, **U → unit** et **commentaire → notes**.
Quand ces colonnes caractérisent un DPGF, la première colonne de
**column_order** est proposée comme **designation**. Dans ce même contexte,
**PRT MO**, **P.U.** et **Prix total** ne reçoivent pas de suggestion
heuristique. L'unité alimente la description visible ; le commentaire reste
séparé dans les métadonnées de provenance.

### Aperçu et décisions

L'action **structure-preview** recharge toutes les lignes, reapplique le mapping
et renvoie les candidats dans l'ordre source avec confiance, raisons,
feuille/ligne et nombre de lignes de pied ignorées.

- Un titre XLSX en gras sans prix est présélectionné comme section de niveau 1.
- Un candidat sémantique CSV/PDF a une confiance moyenne et reste une ligne.
- TOTAL, SOUS-TOTAL, TOTAUX et toutes les lignes suivantes sont exclus.
- Une ligne opérationnelle sans quantité ou prix, ou avec -/—, est conservée à
  zéro.

La confirmation transmet uniquement les décisions **rowIndex, kind, level**.
Le serveur recalcule les candidats et refuse les indices inconnus, doublons,
niveaux invalides et niveaux 2 sans niveau 1 précédent.

### Matérialisation et provenance

La normalisation structurée conserve la racine Import DPGF : un niveau 1 source
devient son enfant, un niveau 2 devient enfant du dernier niveau 1 et les lignes
rejoignent la section active la plus profonde. Un élément historique sans
**item_type** reste une ligne. La façade canonique remappe les UUID de parents
avant d'appeler la RPC atomique ; les compteurs et totaux portent uniquement sur
les lignes.

Sections et lignes enregistrent **source_provider = dpgf**, le nom du fichier,
la page éventuelle et les identifiants import/mapping/ligne, feuille/ligne
source, commentaires et provenance dans **source_metadata**.

## 13. Couverture de test


Tests unitaires et d'intégration (Vitest) : `src/lib/imports/server.test.ts` couvre notamment la persistance des lignes PDF approuvées dans le pipeline canonique (`:358`), la construction depuis `tables` sans enveloppe de lignes (`:496`), le rejet des payloads PDF sans `sourceKind` explicite (`:562`, `:618`, `:650`, `:682`), l'absence de `approvedTables` (`:590`) et un import multipart de PDF DPGF réaliste (`:783`). `src/lib/imports/tabular-pdf-extraction.test.ts` couvre les budgets et la terminaison du worker bloqué sans repli `pdftotext` (`:145`), ainsi qu'une extraction DPGF réaliste (`:439`). Autres fichiers : `src/lib/imports/tabular-pdf.test.ts`, `src/lib/imports/header-row.test.ts`, `src/lib/mappings/server.test.ts`, `src/app/dashboard/affaires/_actions/import-flow.test.ts`, `src/components/affaires/UnifiedImportFlow.test.tsx`, `src/components/imports/ImportWizard.test.tsx`.

Playwright (`playwright.config.ts:36`, `testDir: "./e2e/estimates"`) :

- `e2e/estimates/import-dpgf.spec.ts:8` — chaîne autonome import → mapping → liaison catalogue, fixture `e2e/fixtures/dpgf-minimal.csv`.
- `e2e/estimates/team-b-user-stories.spec.ts:567` — statistiques de mapping et détection de doublons, classeur XLSX généré à l'exécution (`:62`).
- `e2e/estimates/team-b-user-stories.spec.ts:606` — **unique test e2e du PDF tabulaire** : dépôt de `e2e/fixtures/us22_live_tabular.pdf` (`:609`), attente de `Validation renforcee` (`:616`), du message d'approbation explicite (`:618-621`), clic sur `Valider les tableaux et lancer l'import` (`:623`), puis arrivée sur `/dashboard/mappings?import_id=` (`:627-632`). Aucune assertion sur les colonnes extraites.
- `e2e/estimates/team-b-user-stories.spec.ts:635` — matérialisation en version de chiffrage avec vérification des totaux en base.
- `e2e/estimates/import-flow-carry-over.spec.ts:336` — flux unifié complet dans une affaire, avec carte carry-over takeoff et vérification des liens de version.

Aucun test Playwright n'intercepte le réseau : `grep -rn "page.route(" e2e/` ne renvoie aucun résultat. Aucun `data-testid` n'existe pour l'assistant d'import ; les sélecteurs stables sont `#import-file-input`, `input[type="file"]`, `#catalogue-link-import-id` et `table.data-table tbody tr` (`e2e/estimates/helpers.ts:989-1013`).

## 14. Constantes numériques

| Constante | Valeur | Référence |
|---|---|---|
| Taille maximale d'import | `50 × 1024 × 1024` o | `src/lib/imports/server.ts:29` |
| Lot d'insertion `dpgf_rows_raw` | `500` | `src/lib/imports/server.ts:30` |
| Bascule worker → serveur | `5 × 1024 × 1024` o | `src/hooks/useImportFlow.ts:56` |
| Délai worker navigateur | `20 000` ms | `src/hooks/useFileParser.ts:52` |
| Délai worker de parsing serveur | `30 000` ms | `src/lib/imports/parser.ts:173` |
| Délai d'extraction PDF | `15 000` ms | `src/lib/imports/tabular-pdf-extraction.ts:40` |
| Sondage de la liste d'imports | `3 000` ms | `src/hooks/useImportFlow.ts:57` |
| Seuil de confiance haute | `0,8` | `src/lib/mappings/server.ts:139` |
| Seuil de confiance moyenne | `0,5` | `src/lib/mappings/server.ts:140` |
| Confiance mémoire initiale | `0,6000` | `20260305011000_…_variable_conflict_fix.sql:55` |
| Plafond de confiance mémoire | `0,9800` | `20260305011000_…_variable_conflict_fix.sql:65` |
| Lot d'insertion `dpgf_rows_mapped` | `500` | `src/lib/mappings/server.ts:1663` |
| TVA maximale (points de base) | `10 000` | `src/lib/affaires/import-flow.ts:58` |
| TVA par défaut (points de base) | `2 000` | `src/lib/affaires/import-flow-server.ts:23` |
