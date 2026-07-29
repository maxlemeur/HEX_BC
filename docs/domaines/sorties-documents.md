# Sorties : documents, PDF, exports, portail, commandes

> **Source : le code au 2026-07-29.** Chaque affirmation porte une référence `fichier:ligne`. En cas de divergence, le code fait foi et ce document doit être corrigé.

Ce document décrit ce que le logiciel **produit** : le PDF de devis, sa copie stockée, les classeurs d'export, les emails, la page portail lue par le client, et les bons de commande fournisseurs. Les règles de calcul des montants ne sont pas répétées ici : voir [`../metier/regles-de-calcul.md`](../metier/regles-de-calcul.md) et [`../metier/cycle-de-vie.md`](../metier/cycle-de-vie.md).

---

## 1. Génération PDF du devis

Le PDF est rendu côté serveur avec `@react-pdf/renderer` (`src/lib/estimates/pdf-generator.tsx:5-13`), en runtime Node (`src/app/api/estimates/[versionId]/pdf/route.ts:21`). Le document est construit par `buildEstimatePdfDocument` (`src/lib/estimates/pdf-generator.tsx:1364`) puis sérialisé par `renderToBuffer` (`src/lib/estimates/pdf-generator.tsx:1850`).

### 1.1 Mise en page (`layout_options`)

Huit champs décrivent la mise en page (`src/lib/estimates/pdf-layout.ts:17-26`) : `preset`, `detailLevel`, `priceMode`, `density`, `showNumbering`, `showSectionSubtotals`, `conditionsPlacement`, `includeTerms`.

| Préréglage | `detailLevel` | `priceMode` | `density` | `includeTerms` |
| --- | --- | --- | --- | --- |
| `client_detailed` (défaut) | `lines` | `unit_and_total` | `standard` | `false` |
| `decision_summary` | `2` | `total_only` | `compact` | `false` |
| `fo_mo` | `lines` | `fo_mo_and_total` | `standard` | `false` |

Source : `src/lib/estimates/pdf-layout.ts:46-84`. `DEFAULT_ESTIMATE_PDF_LAYOUT` est une copie de `client_detailed` (`src/lib/estimates/pdf-layout.ts:82-84`).

- Les largeurs de colonnes dépendent du `priceMode` : `fo_mo_and_total` → 41/8/7/14/14/16 %, `unit_and_total` → 50/9/8/15/18 %, `total_only` → 64/10/8/18 % (`src/lib/estimates/pdf-generator.tsx:1106-1127`).
- La densité pilote le padding vertical des lignes : 3,5 pt (compact), 5 pt (standard), 7 pt (comfortable) (`src/lib/estimates/pdf-generator.tsx:1139-1144`).
- L'indentation de la désignation vaut `min(profondeur, 4) × 9` pt (`src/lib/estimates/pdf-generator.tsx:1188`).
- L'estimation du nombre de pages utilise 42 / 34 / 27 lignes par page selon la densité, plus 13 lignes de chrome (`src/lib/estimates/pdf-layout.ts:245-251`).
- La mise en page est sérialisable en query string (`preset`, `detail_level`, `price_mode`, `density`, `numbering`, `subtotals`, `conditions`, `terms`) ; le paramètre historique `max_level` est lu en repli puis supprimé (`src/lib/estimates/pdf-layout.ts:186-228`).
- `ESTIMATE_PDF_LAYOUT_STORAGE_VERSION = 1` (`src/lib/estimates/pdf-layout.ts:44`).

### 1.2 Chrome de page, page de garde et mentions

Chaque page porte deux filets d'accent, un pied de page et une pagination `Page N / M` (`src/lib/estimates/pdf-generator.tsx:1056-1078`). Le pied affiche le siège social, le SIRET et le numéro de TVA (`src/lib/estimates/pdf-generator.tsx:1063-1066`), lus dans `COMPANY_INFO` (`src/lib/company-info.ts:2-23`) : `HYDRO EXPRESS SAS`, SIRET `500 735 022 00021`, TVA `FR28500735022`.

L'en-tête de marque insère le logo `public/logo-hydro-express.jpg` encodé en `data:image/jpeg;base64,…` ; si la lecture échoue, le logo est simplement omis (`src/lib/estimates/pdf-generator.tsx:946-958`, `1080-1104`).

Le bloc de titre affiche l'émetteur, le titre « Devis », le badge de version, la carte Client (client, affaire, référence devis, référence projet) et la carte « Informations devis » (date, validité en jours, régime fiscal) (`src/lib/estimates/pdf-generator.tsx:1403-1475`).

### 1.3 Autoliquidation de TVA — rendu

`vatReverseCharge` est vrai lorsque `version.contractor_role === "subcontractor"` (`src/lib/estimates/pdf-generator.tsx:1376-1377`). Effets sur le document :

- La carte « Informations devis » remplace la ligne `TVA <taux> %` par `Régime fiscal : Autoliquidation` (`src/lib/estimates/pdf-generator.tsx:1461-1473`).
- Le cartouche de totaux n'affiche **ni** la ligne TVA **ni** la ligne Total TTC ; seul le Total HT subsiste (`src/lib/estimates/pdf-generator.tsx:1484-1495`).
- La mention légale est ajoutée sous le cartouche (`src/lib/estimates/pdf-generator.tsx:1497-1501`). Son libellé unique est `ESTIMATE_VAT_REVERSE_CHARGE_NOTICE` = « Autoliquidation — TVA due par le preneur (article 283, 2 nonies du CGI) » (`src/lib/estimates/document-copy.ts:16-17`), volontairement centralisé pour rester identique sur écran, PDF et portail (`src/lib/estimates/document-copy.ts:5-15`).
- Le même drapeau désactive la colonne TVA du document préparé (`src/components/estimate-document/prepare-estimate-document-data.ts:388-390`) et les colonnes TVA/TTC du classeur d'export (`src/lib/estimates/export-stream.ts:284-301`).

La règle de calcul associée est décrite dans [`../metier/regles-de-calcul.md`](../metier/regles-de-calcul.md).

### 1.4 Précisions, limites de prestation et CGV

- `version.exclusions` est rendu dans une carte titrée « Précisions et limites de prestation » (`src/lib/estimates/document-copy.ts:1-2`, `src/lib/estimates/pdf-generator.tsx:1348-1362`). Si `conditionsPlacement === "new_page"` et que le texte est non vide, la carte occupe une page dédiée (`src/lib/estimates/pdf-generator.tsx:1383-1385`, `1508-1517`).
- Les CGV occupent une page finale à deux colonnes, obtenue par découpe des paragraphes sur les doubles sauts de ligne puis coupure au milieu (`src/lib/estimates/pdf-terms.ts:129-152`, `src/lib/estimates/pdf-generator.tsx:1519-1555`).
- Un snapshot de CGV est valide s'il porte `templateId`, `title`, `body`, `capturedAt` et `version >= 1` ; `legalReviewedAt` est exigé sauf pour un brouillon (`src/lib/estimates/pdf-terms.ts:84-120`).
- Un snapshot marqué `isDraft` n'est utilisable que si `NODE_ENV === "development"` (`src/lib/estimates/pdf-terms.ts:122-127`). Le gabarit de développement `estimate-cgv-b2b-draft-v3` n'existe qu'en développement (`src/lib/estimates/pdf-terms.ts:154-175`) et affiche l'avertissement `ESTIMATE_DRAFT_TERMS_NOTICE` (`src/lib/estimates/pdf-terms.ts:34-35`, rendu en `src/lib/estimates/pdf-generator.tsx:1526-1530`).
- La politique de tenant force l'inclusion : `policy === "required"` impose `includeTerms = true`, l'absence de gabarit impose `includeTerms = false` (`src/lib/estimates/pdf-layout.ts:171-182`).
- Créer un snapshot depuis un gabarit non brouillon sans date de revue lève une erreur (`src/lib/estimates/pdf-terms.ts:63-71`).
- Le pied de page CGV indique la version et la date de revue juridique, ou signale la maquette non contractuelle (`src/lib/estimates/pdf-generator.tsx:1389-1395`).

---

## 2. Stockage documentaire

| Élément | Valeur | Référence |
| --- | --- | --- |
| Bucket | `estimate-documents`, privé | `src/lib/estimates/pdf-generator.tsx:200` ; `supabase/migrations/20260718155244_restore_estimate_documents_storage.sql:11-13` |
| Taille max bucket | `20971520` octets (20 Mo) | `supabase/migrations/20260718155244_restore_estimate_documents_storage.sql:14` |
| Types MIME autorisés | `['application/pdf']` | `supabase/migrations/20260718155244_restore_estimate_documents_storage.sql:15` |
| TTL des URL signées | `60 * 60` s (1 h) | `src/lib/estimates/pdf-generator.tsx:201` |
| Content-Type à l'upload | `application/pdf`, `upsert: true` | `src/lib/estimates/pdf-generator.tsx:1857-1860` |
| Empreinte | SHA-256 hexadécimal minuscule du buffer | `src/lib/estimates/pdf-generator.tsx:1871-1874` |
| Longueur max de `last_error` | 2000 caractères | `src/lib/estimates/pdf-generator.tsx:1601`, `1921` |

La table `estimate_documents` porte `file_path`, `sha256_hash`, `file_size_bytes`, `generated_by`, `generated_at`, `layout_options`, `terms_snapshot`, `status` ∈ `processing | ready | failed`, `last_error` (`src/types/database.ts:1455-1471`). L'upsert se fait sur la clé `tenant_id,version_id` (`src/lib/estimates/pdf-generator.tsx:991`). `layout_options` et `terms_snapshot` sont contraints à être des objets JSON (`supabase/migrations/20260718190000_estimate_pdf_layout_and_terms.sql:69-80`).

Les écritures Storage utilisent le client service-role quand il est configuré, sinon le client utilisateur (`src/lib/estimates/pdf-generator.tsx:1619`, `964`, `src/lib/supabase/service-role.ts:14-20`).

### 2.1 Deux définitions concurrentes du chemin canonique

- **Applicatif** : `toFilePath` produit `<tenant_id>/<project_id>/<buildEstimatePdfFilename(...)>` (`src/lib/estimates/pdf-generator.tsx:1040-1054`). Le nom de fichier vaut la référence devis assainie (`<reference>` en V1, `<reference>_V<n>` au-delà), à défaut l'identifiant de version, à défaut `devis`, suffixé `.pdf` (`src/lib/estimates/reference.ts:3-42`).
- **Base de données** : le trigger `enforce_estimate_document_canonical_path` **réécrit** `file_path` en `<tenant_id>/<project_id>/<version_id>.pdf` à chaque insert et update (`supabase/migrations/20260713135408_harden_portal_pdf_capabilities.sql:177-213`), et force `tenant_id` depuis la version parente.
- **RLS Storage** : les quatre politiques du bucket exigent `storage.filename(name) = v.id || '.pdf'` et une arborescence `<tenant_id>/<project_id>/` (`supabase/migrations/20260718155244_restore_estimate_documents_storage.sql:33-150`).

`getEstimatePdfStatus` recalcule le chemin attendu avec la fonction applicative et renvoie `status: "failed"` / « Chemin du document PDF non conforme. » si la ligne stockée diffère (`src/lib/estimates/pdf-generator.tsx:2038-2050`). Les deux définitions ne coïncident que lorsque `estimate_reference` est vide, cas où le repli `versionId` produit exactement `<version_id>.pdf` (`src/lib/estimates/reference.ts:37-41`). Le comportement observé en base réelle n'est pas vérifié ici : aucune exécution de migration n'a été faite pour rédiger ce document.

### 2.2 Classification des échecs Storage

`classifyEstimatePdfStorageFailure` renvoie trois raisons (`src/lib/estimates/pdf-storage-error.ts:1-77`) : `bucket_missing` (texte « bucket not found » / « bucket does not exist »), `server_auth_invalid` (« signature verification failed », « invalid api key », « invalid jwt », ou 401/403 avec « unauthorized »), sinon `storage_unavailable`, avec un message distinct selon l'opération `upload` ou `sign`.

---

## 3. Routes de sortie

| Route | Méthode | Comportement | Référence |
| --- | --- | --- | --- |
| `/api/estimates/[versionId]/pdf` | POST | Déclenche la génération en tâche `after()` ; répond `200` si déjà `ready`, `202` si `processing` ou si le travail vient d'être lancé. `?force=1` ignore le cache. Corps optionnel `{ layout }` validé par zod. | `src/app/api/estimates/[versionId]/pdf/route.ts:120-177`, `27-40`, `71-79` |
| `/api/estimates/[versionId]/pdf` | GET | Redirection `307` vers l'URL signée si `ready`. `?format=json` renvoie `200` / `202` / `500 PDF_GENERATION_FAILED` / `404 PDF_NOT_READY`. | `src/app/api/estimates/[versionId]/pdf/route.ts:179-235` |
| `/api/estimates/[versionId]/pdf/layout` | GET | Structure du devis (nombre de lignes, chapitres par niveau, présence de conditions, configuration CGV). | `src/app/api/estimates/[versionId]/pdf/layout/route.ts:12-21`, `src/lib/estimates/pdf-generator.tsx:1937-1960` |
| `/api/estimates/[versionId]/export` | GET | Streaming XLSX. `?format` n'accepte que `xlsx`, `?mode` accepte `standard`, `dpgf`, `bdc`. Réservé aux rôles `admin` et `engineer`. | `src/app/api/estimates/[versionId]/export/route.ts:41-61`, `30-32`, `91-92` |
| `/api/estimates/[versionId]/send` | POST | Envoi email du devis. | `src/app/api/estimates/[versionId]/send/route.ts:26-40` |
| `/api/estimates/[versionId]/changelog?format=pdf` | GET | PDF de comparaison inter-versions, nommé `changelog-v<n>-v<m>.pdf`, `Cache-Control: no-store`. | `src/app/api/estimates/[versionId]/changelog/route.ts:78-95` |
| `/api/purchase-orders/[id]/zip` | GET | Archive ZIP du bon de commande. | `src/app/api/purchase-orders/[id]/zip/route.ts:264-347` |
| `/api/portal/[token]/accept` \| `/reject` | POST | Décision client. | `src/app/api/portal/[token]/accept/route.ts:31`, `src/app/api/portal/[token]/reject/route.ts:11` |

L'interface de téléchargement PDF interroge le statut toutes les 1500 ms pendant au plus 120 000 ms (`src/components/estimates/EstimatePdfDownloadButton.tsx:22-23`, `57-69`).

---

## 4. Exports tabulaires

Quatre exports XLSX serveur et deux exports client coexistent.

| Export | Déclencheur | Feuilles | Colonnes | Nom de fichier |
| --- | --- | --- | --- | --- |
| Standard | `?mode=standard` | `Devis`, `Resume` | 8 (6 en autoliquidation) | `devis-<ref|nom>-v<n>.xlsx` |
| DPGF | `?mode=dpgf` | `Donnees`, `Metadata` | **19** | `devis-<ref|nom>-v<n>-dpgf.xlsx` |
| BDC V1.1 | `?mode=bdc` | `BDC_V1_1` | **31** | `devis-<ref|nom>-v<n>-bdc-v1_1.xlsx` |
| Éditeur CSV (client) | bouton CSV de l'éditeur | fichier plat | **19**, ou **25** si le flag MO split est actif | `<projet>_V<n>_<AAAA-MM-JJ>.csv` |
| Commandes (client) | page `/dashboard/orders` | `Commandes`, `Articles` | — | `commandes_<AAAA-MM-JJ>` |

Références : `src/lib/estimates/export-stream.ts:288-301` et `327-331` (standard), `src/lib/estimates/dpgf-export.ts:372-392` et `431-435` (DPGF), `src/lib/estimates/bdc-export.ts:539-571` (BDC), `src/lib/estimates/editor-export.ts:415-466` (colonnes CSV éditeur, dont six colonnes de ventilation atelier/chantier ajoutées conditionnellement en `:459-466` via `getEstimateLineExportColumns` `:467-473`), `src/app/dashboard/orders/page.tsx:505-517` (commandes). Les noms de fichiers sont construits en `src/lib/estimates/export-stream.ts:130-141`, `src/lib/estimates/dpgf-export.ts:106-117`, `src/lib/estimates/bdc-export.ts:133-144`, `src/lib/estimates/editor-export.ts:115-129`, `src/app/dashboard/orders/page.tsx:498`.

Les boutons « XLSX », « DPGF » et « BDC V1.1 » de l'éditeur appellent tous la route de streaming serveur ; seul le bouton « CSV » produit le fichier dans le navigateur (`src/hooks/useEstimateEditorExportController.ts:200-256`).

Détails :

- Le moteur XLSX serveur est `exceljs`, chargé par `createRequire` et instancié en `WorkbookWriter` avec `useSharedStrings` et `useStyles` (`src/lib/estimates/export-stream.ts:215-243`). Content-Type : `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (`src/lib/estimates/export-stream.ts:20-21`).
- Le flux passe par un `PassThrough` converti en `ReadableStream` ; une erreur d'écriture détruit le flux (`src/lib/estimates/export-stream.ts:463-474`, mêmes lignes structurelles en `dpgf-export.ts:511-522` et `bdc-export.ts:714-725`).
- La réponse HTTP porte `Content-Disposition: attachment`, `X-Export-Progress: 100` et `Cache-Control: no-store` (`src/app/api/estimates/[versionId]/export/route.ts:128-130`, `src/lib/estimates/export-stream.ts:22`).
- Format monétaire des cellules : `#,##0.00 "€"` ; format décimal : `0.###` (`src/lib/estimates/export-stream.ts:266`, `src/lib/estimates/dpgf-export.ts:147`, `156`).
- En-têtes DPGF et standard : fond `FF1E3A8A`, texte blanc (`src/lib/estimates/export-stream.ts:249-255`). En-tête BDC : six bandes de couleur par bloc — identification 1-6 `FF1E3A8A`, FO 7-10 `FF15803D`, MO 11-15 `FFFACC15`, totaux 16-18 `FFB91C1C`, fournisseurs 19-30 `FF7E22CE`, référence interne 31 `FF334155` (`src/lib/estimates/bdc-export.ts:305-317`).
- Le BDC ajoute des notes de formule indicative sur les colonnes 16, 17 et 18 (`src/lib/estimates/bdc-export.ts:319-330`, `631-642`) et récupère les comparaisons fournisseurs par lots de `200` items (`src/lib/estimates/bdc-export.ts:114`, `370-390`). Trois fournisseurs au maximum sont exportés, par rang 0/1/2 (`src/lib/estimates/bdc-export.ts:341-361`, `446-448`).
- L'export standard réalloue les totaux HT et la TVA au prorata des lignes pour que la somme des lignes égale le pied contractuel (`src/lib/estimates/export-stream.ts:158-173`).
- Les exports client passent par `xlsx` (`src/lib/export.ts:1`, `85`, `100`) ; le CSV utilise `;` comme séparateur et un BOM UTF-8 (`src/lib/export.ts:110-114`), téléchargé via un blob révoqué après `60_000` ms (`src/lib/browser-download.ts:1-24`).

### 4.1 Point d'attention : la colonne « Unite »

**Il n'existe aucune colonne `unit` sur `estimate_items`** : le type de la ligne liste 38 colonnes, dont `description`, sans `unit` (`src/types/database.ts:2516-2552`). Preuve d'absence : `grep -rn "\.unit\b" src/lib/estimates/dpgf-export.ts src/lib/estimates/bdc-export.ts` ne renvoie rien ; `grep -rniE "add column .*\bunit\b" supabase/migrations/` ne remonte que `estimate_assemblies`, `products`, `takeoff_*`, `generated_ouvrage_*` et `catalogue_*`, jamais `estimate_items`.

Par conséquent, **la colonne « Unite » exporte le contenu du champ `description` de la ligne**, dans les quatre sorties :

| Sortie | Cellule écrite | Référence |
| --- | --- | --- |
| DPGF, colonne 5 « Unite » | `item.description?.trim() ?? ""` | `src/lib/estimates/dpgf-export.ts:340` |
| BDC, colonne 5 « Unite » | `item.description?.trim() ?? ""` | `src/lib/estimates/bdc-export.ts:489` |
| Export standard, colonne 3 « Unite » | `item.description?.trim() ?? ""` | `src/lib/estimates/export-stream.ts:202` |
| CSV éditeur, colonne « Unite » | `item.description?.trim() ?? ""` | `src/lib/estimates/editor-export.ts:376`, en-tête `:419` |
| PDF, colonne « U » | `item.description?.trim() || "-"` | `src/lib/estimates/pdf-generator.tsx:1307` |
| Document écran, colonne « U » | `item.description?.trim() || "-"` | `src/components/estimate-document/EstimateDocumentTableRows.tsx:153` |

Sur les lignes de chapitre, la cellule est vide (`src/lib/estimates/dpgf-export.ts:309`, `src/lib/estimates/bdc-export.ts:413`, `src/lib/estimates/export-stream.ts:183`).

---

## 5. Envoi par email

Le fournisseur est Resend, instancié à chaque envoi (`src/lib/email/send-estimate.ts:1`, `185`). Les gabarits sont des composants React (`src/lib/email/templates/estimate.tsx:26`, `acceptance-confirmation.tsx:24`, `approval-review-request.tsx`).

Séquence de `sendEstimateEmail` (`src/lib/email/send-estimate.ts:147-218`) :

1. Chargement de la version, contrôle d'authentification, contrôle d'appartenance au tenant puis `assertCanWriteEstimateWorkflows` (`src/lib/email/send-estimate.ts:82-128`).
2. Si le statut est `draft`, il bascule en `sent` par `patchEstimateStatus` avec contrôle optimiste sur `updated_at` (`src/lib/email/send-estimate.ts:150-155`). Si le statut est `sent`, le scellement est revérifié et un scellement invalide lève `ESTIMATE_SEAL_INVALID` (`src/lib/email/send-estimate.ts:156-164`). Tout autre statut renvoie `ESTIMATE_EMAIL_STATUS_FORBIDDEN` (`src/lib/email/send-estimate.ts:165-171`).
3. Le PDF est **régénéré systématiquement** avec `force: true` et `triggeredBy: "send"` (`src/lib/email/send-estimate.ts:173-176`), puis retéléchargé depuis le bucket pour servir de pièce jointe (`src/lib/email/send-estimate.ts:130-145`, `199-208`).
4. Une erreur Resend lève `internalError` : aucune reprise automatique n'est implémentée (`src/lib/email/send-estimate.ts:211-213`).

Charge utile validée par zod : `to` (email obligatoire), `cc` (tableau d'emails, optionnel), `subject` (1 à 500 caractères), `message` (1 à 5000 caractères) (`src/lib/estimates/schemas.ts:340-345`). Aucune limite de taille de pièce jointe n'est appliquée côté application ; le buffer PDF est joint tel quel (`src/lib/email/send-estimate.ts:199-208`).

Le lien d'appel à l'action de l'email est résolu par `resolvePortalUrl` (`src/lib/email/send-estimate.ts:58-72`) : avec `NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL`, il pointe sur `<base>/estimates/<versionId>` ; sans elle, sur `/dashboard/estimates/<versionId>/print` relatif à l'URL de la requête. Ni l'une ni l'autre forme n'est une URL `/portal/<token>` : une recherche du littéral `/portal/` dans `src/` (`grep -rn "/portal/" src/`) ne remonte qu'une redirection interne vers la page d'expiration (`src/app/portal/[token]/page.tsx:74`).

L'email de confirmation d'acceptation est envoyé depuis la route d'acceptation, en meilleur effort : il n'est tenté que si `RESEND_API_KEY` et `EMAIL_FROM` sont tous deux définis, et toute erreur est journalisée sans faire échouer l'acceptation (`src/app/api/portal/[token]/accept/route.ts:207-279`). Son sujet est `Confirmation - Devis <projet> accepte` (`src/app/api/portal/[token]/accept/route.ts:240`). Chaque tentative produit une ligne dans `estimate_emails` avec `type: "acceptance_confirmation"` et `status` `sent` ou `failed` (`src/app/api/portal/[token]/accept/route.ts:256-264`). La table contraint `type` à `initial | reminder_1 | reminder_2 | reminder_3 | acceptance_confirmation` et `status` à `sent | failed | delivered | bounced` (`supabase/migrations/20260305150000_create_labor_roles.sql:194-199`).

L'email interne de demande de validation a pour sujet `Validation requise - <projet> V<n>` et lève une erreur si Resend échoue (`src/lib/email/send-approval-review-request.ts:29-48`).

---

## 6. Portail client

Le portail est une **surface publique** : la page et les deux routes de décision s'exécutent avec le client service-role, qui contourne la RLS (`src/app/portal/[token]/page.tsx:51`, `src/app/api/portal/[token]/accept/route.ts:88`, `src/app/api/portal/[token]/reject/route.ts:39`, `src/lib/supabase/service-role.ts:22-45`). La seule preuve d'autorisation est donc le token d'URL.

### 6.1 Modèle du token

`portal_tokens` porte `token uuid not null default gen_random_uuid()`, `email`, `expires_at timestamptz not null`, `status` ∈ `pending | accepted | rejected | expired`, `accepted_at`, `accepted_ip inet`, `signature_url`, `reject_reason` (`supabase/migrations/20260305150000_create_labor_roles.sql:65-78`). Le token est unique (`…:83-84`).

- **`expires_at` n'a aucune valeur par défaut** : la durée de validité est fournie à l'insertion.
- **Aucun code de `src/` n'insère de ligne dans `portal_tokens`.** Preuve : `grep -rn 'from("portal_tokens")' src/` ne remonte que des `select` et des `update` (`src/app/portal/[token]/page.tsx:55` et `69`, `src/app/api/portal/[token]/accept/route.ts:92` et `201`, `src/app/api/portal/[token]/reject/route.ts:43`). L'émission d'un lien portail n'est donc pas implémentée côté application ; la RLS l'autorise aux rôles `admin` et `engineer` (`supabase/migrations/20260305150000_create_labor_roles.sql:157-171`).
- Un trigger `security definer` force `tenant_id` depuis la version parente et **interdit** toute mutation de `version_id` ou `tenant_id` sur un token existant, avec `errcode 42501` (`supabase/migrations/20260713135408_harden_portal_pdf_capabilities.sql:3-43`).

### 6.2 Expiration

La page compare `expires_at` à l'instant courant ; si le token est `pending` et périmé, elle le bascule en `expired` puis redirige vers `/portal/<token>/expired` (`src/app/portal/[token]/page.tsx:64-75`). Les routes `accept` et `reject` renvoient `404` « Ce lien a expire. » (`src/app/api/portal/[token]/accept/route.ts:111-116`, `src/app/api/portal/[token]/reject/route.ts:62-67`). La page d'expiration invite à contacter l'interlocuteur (`src/app/portal/[token]/expired/page.tsx:23-30`).

### 6.3 Contrat documentaire opposable

Le portail lit la mise en page et les CGV **stockées** dans `estimate_documents`, jamais un gabarit vivant (`src/app/portal/[token]/page.tsx:101-106`, `136-141`). `resolvePortalDocumentContract` refuse (`src/lib/estimates/portal-document-contract.ts:41-73`) :

- un document dont `status` existe et vaut autre chose que `ready` → `document_not_ready` ;
- une mise en page déclarant `includeTerms` sans snapshot CGV exploitable → `required_terms_snapshot_missing_or_invalid`.

La page renvoie alors `notFound()` (`src/app/portal/[token]/page.tsx:137-139`). La route d'acceptation **rejoue le même contrôle avant de réclamer le token**, précisément parce que la page n'est pas une frontière de sécurité et que la route est appelable directement ; l'échec produit un `409` (`src/app/api/portal/[token]/accept/route.ts:118-146`). Une erreur de lecture du document produit un `503` (`…:129-135`). Ces invariants sont couverts par `src/app/portal/portal-document-parity.test.ts:46-63`.

L'émetteur affiché est le profil de `estimate_documents.generated_by`, avec repli sur le propriétaire du projet (`src/app/portal/[token]/page.tsx:146-154`).

### 6.4 Anti-concurrence : `claim_portal_estimate_decision`

Les deux routes délèguent la décision à une seule fonction SQL (`src/app/api/portal/[token]/accept/route.ts:153-176`, `src/app/api/portal/[token]/reject/route.ts:70-93`). Elle est `security invoker`, `search_path = ''`, et refuse tout appelant autre que `service_role` avec `errcode 42501` (`supabase/migrations/20260713135408_harden_portal_pdf_capabilities.sql:45-67`). Les droits d'exécution sont révoqués à `public`, `anon` et `authenticated`, et accordés au seul `service_role` (`…:172-175`).

Déroulé de la fonction (`…:69-166`) :

1. Verrou `for update` sur la version parente ; toute version dont le statut n'est pas `sent` déclenche `P0001` (`…:86-96`).
2. Verrou `for update` sur le token ; token inexistant, non `pending`, ou expiré → `P0001` (`…:98-112`).
3. Mise à jour du token : `status`, `accepted_at`, `accepted_ip`, `reject_reason` tronqué à 1000 caractères (`…:114-122`).
4. Mise à jour de la version : `accepted` ou **`archived`** en cas de refus, conditionnée à `status = 'sent'` ; l'absence de ligne mise à jour déclenche `P0001` « decision lost its concurrency claim » (`…:124-137`).
5. **Tous les autres tokens `pending` de la même version passent à `expired`** (`…:139-144`).
6. Journalisation via `log_estimate_version_event` avec `portal_token_id`, `accepted_via`/`rejected_via`, `client_ip` ou `reason` (`…:146-166`).

Côté HTTP, `P0001` est traduit en `409` « Ce devis a deja ete traite. » et toute autre erreur en `500` (`src/app/api/portal/[token]/accept/route.ts:163-176`).

### 6.5 Signature manuscrite

- Le corps doit porter `accepted_terms === true`, sinon `400` (`src/app/api/portal/[token]/accept/route.ts:62-67`).
- La signature est facultative ; si présente, elle doit être une chaîne préfixée `data:image/png;base64,` et ne pas dépasser `700_000` caractères, soit environ 500 Ko décodés (`src/app/api/portal/[token]/accept/route.ts:13-14`, `70-86`).
- Elle est produite par un canevas de 150 px de haut exporté en `toDataURL("image/png")` (`src/components/portal/SignaturePad.tsx:33`, `126`).
- L'upload a lieu **après** la revendication du token, pour éviter les orphelins, dans le bucket `devis` au chemin `signatures/<portal_token_id>.png` avec `upsert: false` (`src/app/api/portal/[token]/accept/route.ts:178-191`). Un échec d'upload est journalisé et n'annule pas l'acceptation (`…:193-195`).
- L'IP client provient de `x-forwarded-for` (première valeur) ou `x-real-ip` (`src/app/api/portal/[token]/accept/route.ts:23-29`).
- Le motif de refus est tronqué à 1000 caractères côté route et côté SQL (`src/app/api/portal/[token]/reject/route.ts:34-37`, `supabase/migrations/20260713135408_harden_portal_pdf_capabilities.sql:118-121`).

---

## 7. Bons de commande fournisseurs et devis rattachés

### 7.1 Référence et totaux

La référence est `C-AAMM-XXX`, séquence sur 3 chiffres issue de `order_number` (`src/lib/reference.ts:9-18`). Les commandes sont créées avec une référence temporaire puis mises à jour (`src/app/api/purchase-orders/route.ts:141-186`, `src/lib/estimates/purchase-order-drafts.ts:597-636`).

Les totaux : `lineTotalHtCents = quantity × unitPriceHtCents`, `lineTaxCents = round(lineTotalHtCents × taxRateBp / 10000)`, `lineTotalTtcCents = HT + TVA`, puis somme simple par commande (`src/lib/order-calculations.ts:23-46`). `recalculateOrderTotals` relit les lignes en base et réécrit les trois totaux de l'en-tête (`src/lib/order-calculations.ts:54-89`).

### 7.2 Brouillons dérivés d'un chiffrage

`createEstimatePurchaseOrderDrafts` regroupe les lignes par fournisseur et crée une commande `draft` par groupe (`src/lib/estimates/purchase-order-drafts.ts:512-701`). Traçabilité conservée : `purchase_orders.source_estimate_version_id`, `purchase_order_items.source_estimate_item_id` et `source_selected_supplier_price_id` (`…:611`, `652-653`). Garde-fous : un item ne peut apparaître qu'une fois par requête (`…:537-544`), une ligne déjà rattachée à un brouillon déclenche `ORDER_DRAFT_ALREADY_EXISTS` (`…:549-562`), une préparation périmée déclenche `ORDER_DRAFT_PREPARATION_STALE` (`…:522-535`), et un échec partiel provoque un rollback des commandes créées, dont l'échec remonte en `ORDER_DRAFT_ROLLBACK_FAILED` (`…:673-691`). Les motifs de blocage possibles sont `selection_missing`, `stale`, `ambiguous`, `no_price`, `missing_quantity`, `non_integer_quantity`, `missing_unit_price` (`…:35-42`). La devise est figée à `EUR` (`…:610`).

### 7.3 Devis fournisseurs joints

| Élément | Valeur | Référence |
| --- | --- | --- |
| Bucket | `devis`, privé | `supabase/migrations/003_create_devis_storage.sql:2-10` |
| Taille max bucket | `10485760` octets (10 Mo) | `supabase/migrations/003_create_devis_storage.sql:7` |
| MIME autorisés bucket | `application/pdf`, `image/png`, `image/jpeg`, `image/webp` | `supabase/migrations/003_create_devis_storage.sql:8` |
| Taille max applicative | `10 * 1024 * 1024` octets, libellé « 10 Mo » | `src/lib/file-validation.ts:1-2` |
| Chemin d'upload | `purchase-orders/<orderId>/<uuid>-<nom assaini>` | `src/app/api/purchase-orders/[id]/devis/route.ts:211` |
| TTL des URL signées | `60 * 10` s (10 min) | `src/app/api/purchase-orders/[id]/devis/route.ts:11` |

Un type MIME `message/*` est réécrit en `application/octet-stream` à l'upload (`src/app/api/purchase-orders/[id]/devis/route.ts:51-60`, `225`). Si l'insertion en base échoue après l'upload, l'objet Storage est supprimé (`…:251`). L'écriture est refusée aux rôles autres que `admin` et `engineer` (`src/lib/purchase-orders.ts:8`, `src/app/api/purchase-orders/[id]/devis/route.ts:194-199`) et sur une commande `canceled` (`…:201-206`).

Les politiques Storage durcies exigent une arborescence exactement à deux niveaux commençant par `purchase-orders/`, un bon de commande non annulé, l'appartenance au tenant et la propriété ou le rôle `admin` (`supabase/migrations/20260708120000_harden_devis_storage_policies.sql:15-36`). Le chemin `signatures/<id>.png` écrit par le portail (§6.5) ne satisfait pas ces politiques ; il n'aboutit que parce que le client service-role contourne la RLS.

Le réordonnancement des pièces jointes est atomique via la fonction `reorder_purchase_order_devis` (`supabase/migrations/016_atomic_reorder_purchase_order_devis_s5.sql:1-3`), exposée par un `PATCH` qui refuse les identifiants dupliqués, les commandes introuvables, les rôles non autorisés et les commandes annulées (`src/app/api/purchase-orders/[id]/devis/reorder/route.ts:35-75`).

### 7.4 Archive ZIP

`GET /api/purchase-orders/[id]/zip` produit une archive `archiver` en niveau de compression 9 (`src/app/api/purchase-orders/[id]/zip/route.ts:309`) contenant :

- `bon-de-commande.html`, page HTML autonome générée à la volée avec en-têtes Designation / Reference / Qte / P.U. HT / Total HT, les trois totaux et les notes, toutes les valeurs textuelles étant échappées (`…:86-243`, `66-74`, `310`) ;
- chaque devis joint sous `documents/<nom assaini>`, avec suffixe `-1`, `-2`… en cas de collision ; un téléchargement en échec est ignoré silencieusement (`…:312-334`).

Le nom de l'archive est `bon_de_commande_<référence ou numéro>.zip` (`…:336-343`). Aucune borne de taille ni de nombre de pièces n'est appliquée. La réponse est un flux ; `finalize()` est appelé après la conversion en `ReadableStream` (`…:345-347`).

### 7.5 Impression écran

`PurchaseOrderDocument` est un rendu HTML imprimable, distinct de la chaîne `@react-pdf/renderer` : tableau Designation / Qte / P.U. HT / Total HT (`src/components/PurchaseOrderDocument.tsx:441-446`) et cartouche Total HT / TVA / Total TTC (`…:560-585`). La page d'impression déclenche l'impression sur `?print=1` ou `?print=true` (`src/app/dashboard/orders/[id]/print/page.tsx:99-101`).

---

## 8. Thème documentaire et émetteur

`BUSINESS_DOCUMENT_THEME` fixe la palette (bleu `#0a3d62`, orange `#d97706`, encre `#182235`, atténué `#64748b`, bordure `#cbd5e1`, surfaces `#f8fafc` et `#e2e8f0`) et la page A4 : 210 × 297 mm, marges latérales 36 pt, haut 30 pt, bas 48 pt (`src/lib/documents/document-theme.ts:1-19`).

`normalizeDocumentIssuerDisplay` normalise l'émetteur (`src/lib/documents/issuer-display.ts:28-56`) : si le nom ressemble à une adresse email, il est reconstruit depuis la partie locale (première composante capitalisée, suivantes en majuscules, repli « Utilisateur ») ; le rôle est masqué s'il est vide, ressemble à un email, ou duplique le nom ou l'email. Le PDF l'alimente depuis `profiles.full_name`, `job_title`, `phone`, `work_email`, avec `COMPANY_INFO.name` en repli de nom (`src/lib/estimates/pdf-generator.tsx:922-944`).

---

## 9. Variables d'environnement

| Variable | Usage | Comportement si absente | Référence |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Client Supabase et service-role | `createServiceRoleClient` lève une erreur | `src/lib/supabase/service-role.ts:8-10`, `30-37` |
| `SUPABASE_SERVICE_ROLE_KEY` | Portail, Storage PDF | `createOptionalServiceRoleClient` renvoie `null` et le code retombe sur le client utilisateur | `src/lib/supabase/service-role.ts:14-20`, `src/lib/estimates/pdf-generator.tsx:964`, `1619` |
| `RESEND_API_KEY` | Envoi email | `internalError("Configuration email manquante: RESEND_API_KEY.")` ; côté portail, l'email de confirmation est simplement omis | `src/lib/email/send-estimate.ts:74-80`, `src/app/api/portal/[token]/accept/route.ts:209-212` |
| `EMAIL_FROM` | Expéditeur | idem | `src/lib/email/send-estimate.ts:74-80`, `src/app/api/portal/[token]/accept/route.ts:210-212` |
| `NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL` | Base du lien email | Repli sur `/dashboard/estimates/<versionId>/print` relatif à la requête | `src/lib/email/send-estimate.ts:58-72` |
| `NODE_ENV` | Autorise les CGV brouillon | Hors `development`, un snapshot `isDraft` est ignoré | `src/lib/estimates/pdf-terms.ts:122-127` |

Ces cinq premières variables figurent dans `.env.example:1-6`.

---

## 10. Écarts et zones non vérifiées

1. **Chemin PDF** : la fonction applicative (`src/lib/estimates/pdf-generator.tsx:1040-1054`) et le trigger SQL (`supabase/migrations/20260713135408_harden_portal_pdf_capabilities.sql:202-208`) ne produisent le même chemin que si `estimate_reference` est vide ; le contrôle de conformité de `getEstimatePdfStatus` (`…:2038-2050`) s'appuie sur la forme applicative. Le comportement effectif sur une base migrée n'est pas vérifié.
2. **Émission des liens portail** : aucun code applicatif ne crée de `portal_tokens` (preuve au §6.1), et aucun lien `/portal/<token>` n'est construit dans les emails (§5).
3. **« Unite »** : la valeur exportée est `description`, faute de colonne dédiée (§4.1).
4. **Signature portail** : elle est déposée dans le bucket `devis` sur un chemin que la RLS de ce bucket n'autorise pas, uniquement viable par contournement service-role (§7.3).
5. Le volume des exports n'est pas borné : ni nombre de lignes XLSX, ni nombre ou taille cumulée des pièces jointes du ZIP, ni taille de la pièce jointe email.
