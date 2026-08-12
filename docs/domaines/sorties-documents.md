# Sorties : documents, PDF, exports, portail, commandes

> **Source : le code relu au 2026-08-12 pour le PDF, l'email et les transactions
> documentaires.** Les autres sections restent la photographie du 2026-07-29.
> En cas de divergence, le code et les migrations font foi.

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
| Content-Type à l'upload | `application/pdf`, `upsert: false` | `src/lib/estimates/pdf-generator.tsx` |
| Empreinte | SHA-256 hexadécimal minuscule du buffer | `src/lib/estimates/pdf-generator.tsx:1871-1874` |
| Longueur max de `last_error` | 2000 caractères | `src/lib/estimates/pdf-generator.tsx:1601`, `1921` |

La table `estimate_documents` porte `file_path`, `sha256_hash`,
`file_size_bytes`, `generated_by`, `generated_at`, `layout_options`,
`terms_snapshot`, `status` ∈ `processing | ready | failed`, `last_error`, ainsi
que le token, le but, le dispatch et la révision de la tentative courante et de
la dernière publication. Il reste une seule ligne par `(tenant_id, version_id)`
(`src/types/database.ts`,
`supabase/migrations/20260812011616_estimate_pdf_publication_fencing.sql`).
`layout_options` et `terms_snapshot` sont contraints à être des objets JSON.

Les mutations de métadonnées passent par les RPC
`begin_estimate_pdf_generation`, `publish_estimate_pdf_generation` et
`fail_estimate_pdf_generation`, réservées au rôle Postgres `service_role`. Le
repli applicatif sur le client utilisateur échoue donc fermé si la clé
service-role manque : il ne peut jamais publier une ligne `ready`.

### 2.1 Chemin content-addressé et publication protégée

Toute nouvelle publication utilise exactement :

```text
<tenant_id>/<project_id>/<version_id>/<sha256>.pdf
```

Le SHA-256 du contenu fait donc partie de la clé Storage. Le nom commercial
construit par `buildEstimatePdfFilename` reste seulement le nom de
téléchargement ou de pièce jointe ; il n'est plus une clé Storage
(`src/lib/estimates/pdf-publication.ts`,
`src/lib/estimates/reference.ts`).

La compatibilité de lecture conserve, pour une ligne `ready` déjà publiée, un
unique fichier `.pdf` directement sous `<tenant_id>/<project_id>/`. Son nom peut
être l'UUID de version historique ou l'ancien nom commercial strict ; aucun
sous-dossier ni second segment de fichier n'est admis. Une mise à jour qui ne
change ni son chemin ni son empreinte peut le conserver ; la publication suivante
adopte obligatoirement le chemin content-addressé. Le contrôle applicatif
`isCanonicalEstimatePdfPath` accepte uniquement la forme content-addressée et
cette forme historique bornée.

La publication suit quatre barrières :

1. La RPC de début verrouille la version et attribue un token UUID avec son but
   (`manual`, `email` ou `workflow`), l'acteur, la révision et, pour l'email, le
   dispatch. `manual|workflow` exigent un devis `draft` ; `email` exige le même
   dispatch `preparing` et une version `sending`.
2. Le serveur rend le PDF et calcule son SHA-256 ; le client Storage service-role
   crée l'objet avec `upsert: false`. Une réponse Storage
   `already exists`/`duplicate` est traitée comme une clé immuable déjà présente
   dans cet espace privilégié ; aucun contenu existant n'est écrasé.
3. La RPC de publication revérifie sous verrou le token, l'acteur, la révision,
   le statut, le dispatch et le chemin dérivé du hash avant de publier les
   métadonnées `ready`. Une tentative supplantée ne peut donc pas republier son
   résultat.
4. La RPC d'échec est elle aussi protégée par token. Elle restaure la dernière
   publication prête si elle existe, sinon marque la tentative `failed`, sans
   écraser une tentative plus récente.

Les utilisateurs authentifiés n'ont plus d'`INSERT`, `UPDATE` ou `DELETE`
direct sur `estimate_documents`. Dans Storage, ils peuvent lire seulement un
objet référencé par une ligne `ready` de leur périmètre ; aucune policy
authentifiée n'autorise `INSERT`, `UPDATE` ou `DELETE`. La création de l'objet
comme la publication des métadonnées restent donc dans la frontière service-role
(`supabase/migrations/20260812011616_estimate_pdf_publication_fencing.sql`).

Limite volontaire : si une tentative est supplantée entre l'upload et la
publication, l'objet content-addressé non référencé peut rester dans le bucket.
Le nettoyage différé de ces orphelins n'est pas inclus dans ce lot.

### 2.2 Classification des échecs Storage

`classifyEstimatePdfStorageFailure` renvoie trois raisons (`src/lib/estimates/pdf-storage-error.ts:1-77`) : `bucket_missing` (texte « bucket not found » / « bucket does not exist »), `server_auth_invalid` (« signature verification failed », « invalid api key », « invalid jwt », ou 401/403 avec « unauthorized »), sinon `storage_unavailable`, avec un message distinct selon l'opération `upload` ou `sign`.

---

## 3. Routes de sortie

| Route | Méthode | Comportement | Référence |
| --- | --- | --- | --- |
| `/api/estimates/[versionId]/pdf` | POST | Déclenche une génération manuelle protégée par token en tâche `after()` ; répond `200` si déjà `ready`, `202` si `processing` ou si le travail vient d'être lancé. `?force=1` ignore le cache mais pas l'immutabilité : la mutation manuelle reste réservée à `draft`. Corps optionnel `{ layout }` validé par zod. | `src/app/api/estimates/[versionId]/pdf/route.ts`, `src/lib/estimates/pdf-mutation-policy.ts` |
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

Le fournisseur est Resend. Les gabarits restent des composants React, mais
l'email **initial** du devis passe désormais par une outbox transactionnelle
(`src/lib/email/send-estimate.ts`,
`src/lib/email/estimate-email-outbox.ts`, migration
`20260811231759_transactional_estimate_email_outbox.sql`).

La route `POST /api/estimates/[versionId]/send` exige un en-tête
`Idempotency-Key` au format UUID. La modale conserve la clé non confirmée dans
`sessionStorage`, sous une empreinte de la version et de l'enveloppe, puis ne
l'efface qu'après un succès (`src/components/estimates/SendEstimateModal.tsx`).
Une recharge ou une nouvelle clé peut reprendre le dispatch actif seulement si
les destinataires, le sujet, le message et l'acteur sont identiques ; une
enveloppe différente renvoie un conflit.

Séquence de `sendEstimateEmail` :

1. Authentification, résolution d'un tenant actif et contrôle du rôle
   `admin|engineer`. Sur un brouillon, le gating et le verrou de brouillon sont
   vérifiés ; sur un devis déjà `sent`, le sceau est revérifié.
2. `reserve_estimate_email_dispatch` verrouille la version et crée l'enveloppe
   `initial` en `preparing`. Un brouillon passe alors à l'état transactionnel
   `sending`.
3. Pour un brouillon, le PDF contractuel est généré sous une claim liée au
   dispatch et à sa révision ; seul ce token peut publier le document. Pour un
   renvoi d'un devis `sent`, le document contractuel déjà prêt est réutilisé :
   il n'est pas régénéré. Le corps HTML, le corps texte, le chemin et le
   SHA-256 du PDF, le nom de pièce jointe, le sceau et le hash de la charge
   Resend sont figés par `prepare_estimate_email_dispatch`. Un trigger refuse le
   passage à `queued` si le document prêt ne correspond pas à la même
   publication/révision ; le dispatch ne peut donc pas figer le PDF d'un worker
   obsolète.
4. `claim_estimate_email_dispatch` prend un bail de 120 secondes et passe la
   ligne à `processing`. Resend reçoit une clé stable
   `estimate-email/<dispatch-id>` avec exactement la charge figée.
5. Après réception d'un identifiant Resend,
   `complete_estimate_email_dispatch` enregistre le résultat et passe
   atomiquement le dispatch et, si nécessaire, la version à `sent`.

Les statuts de dispatch sont `preparing`, `queued`, `processing`, `sent`,
`failed`, `unknown`, `delivered`, `bounced`. Les événements associés vivent
dans `estimate_email_dispatch_events`, append-only. Les utilisateurs
authentifiés peuvent lire leur périmètre par RLS mais ne peuvent plus écrire
directement ces deux tables ; les mutations passent par les RPC service-role
qui revérifient l'acteur et le tenant.

Les erreurs Resend explicitement transitoires sont retentées après 1 puis
2 secondes dans la requête courante. Si elles persistent, le dispatch redevient
`queued` avec `next_attempt_at`. Il n'existe toutefois **aucun consommateur cron
email autonome** : la même demande doit être resoumise pour reprendre la ligne.

Un rejet **certain** place le dispatch en `failed` et libère une version
`sending` vers `draft`, sceau provisoire effacé, puisqu'aucun effet fournisseur
n'a abouti. Si la charge fournisseur avait déjà été figée, cette ligne échouée
reste immuable et la même `Idempotency-Key` ne peut pas la remettre en
`preparing` : une nouvelle tentative exige une nouvelle clé de requête et crée
donc un nouveau dispatch avec sa propre clé fournisseur. Seul un échec survenu
avant le gel de la charge peut reprendre la même demande, après revalidation du
verrou et de la révision.

Une réponse d'idempotence ambiguë, une incohérence du PDF après une première
tentative ou le dépassement de la coupure de sécurité de **23 heures** place la
ligne en `unknown`. Aucun rejeu automatique n'est alors permis ; un
rapprochement avec Resend est requis. La fenêtre réduit les doublons, sans
promettre une livraison exactement une fois au-delà de la garantie fournisseur.

Charge utile validée par zod : `to` (email obligatoire), `cc` (tableau
d'emails, optionnel), `subject` (1 à 500 caractères), `message` (1 à
5000 caractères). Aucune limite applicative dédiée ne borne encore la taille de
la pièce jointe.

Le lien d'appel à l'action reste résolu par `resolvePortalUrl` : avec
`NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL`, il pointe sur
`<base>/estimates/<versionId>` ; sans elle, sur
`/dashboard/estimates/<versionId>/print` relatif à la requête. Ce n'est pas un
lien public `/portal/<token>`.

La confirmation d'acceptation et la demande interne de revue d'approbation ne
sont **pas** dans cette outbox. Elles restent en meilleur effort : leur échec
est journalisé sans faire échouer l'acceptation ou la soumission de revue. Aucun
email réel n'a été envoyé pour valider cette évolution.

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

La modification d'un brouillon passe par `replace_purchase_order_draft` : la
RPC verrouille le bon, vérifie qu'il est encore `draft`, applique le patch
d'en-tête, remplace éventuellement toutes les lignes et recalcule les trois
totaux dans **une seule transaction**. Un échec ne laisse donc plus un en-tête
mis à jour avec des lignes anciennes, ou inversement
(`src/app/api/purchase-orders/[id]/route.ts`,
`supabase/migrations/20260811231935_transactional_purchase_order_and_estimate_creation.sql`).

### 7.2 Brouillons dérivés d'un chiffrage

`createEstimatePurchaseOrderDrafts` regroupe les lignes par fournisseur et crée une commande `draft` par groupe (`src/lib/estimates/purchase-order-drafts.ts:512-701`). Traçabilité conservée : `purchase_orders.source_estimate_version_id`, `purchase_order_items.source_estimate_item_id` et `source_selected_supplier_price_id` (`…:611`, `652-653`). Garde-fous : un item ne peut apparaître qu'une fois par requête (`…:537-544`), une ligne déjà rattachée à un brouillon déclenche `ORDER_DRAFT_ALREADY_EXISTS` (`…:549-562`), une préparation périmée déclenche `ORDER_DRAFT_PREPARATION_STALE` (`…:522-535`), et un échec partiel provoque un rollback des commandes créées, dont l'échec remonte en `ORDER_DRAFT_ROLLBACK_FAILED` (`…:673-691`). Les motifs de blocage possibles sont `selection_missing`, `stale`, `ambiguous`, `no_price`, `missing_quantity`, `non_integer_quantity`, `missing_unit_price` (`…:35-42`). La devise est figée à `EUR` (`…:610`).

La transaction de remplacement décrite au §7.1 protège **un** brouillon déjà
créé. Elle ne rend pas la création multi-fournisseur ci-dessus atomique dans son
ensemble : plusieurs commandes sont encore créées séquentiellement, avec une
compensation si un groupe ultérieur échoue.

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

Le trigger `guard_purchase_order_devis_storage_path` verrouille aussi le lien
métadonnée/objet : `tenant_id`, `purchase_order_id` et `storage_path` deviennent
immuables, et le chemin doit être strictement
`purchase-orders/<purchase_order_id>/<filename>`, avec un nom non vide, sans
sous-dossier ni segment `.`/`..`. Il vérifie que la commande parente appartient
au même tenant
(`supabase/migrations/20260812000456_transactional_procurement_reset_cleanup.sql`).

Le réordonnancement des pièces jointes est atomique via la fonction `reorder_purchase_order_devis` (`supabase/migrations/016_atomic_reorder_purchase_order_devis_s5.sql:1-3`), exposée par un `PATCH` qui refuse les identifiants dupliqués, les commandes introuvables, les rôles non autorisés et les commandes annulées (`src/app/api/purchase-orders/[id]/devis/reorder/route.ts:35-75`).

### 7.4 Suppression et nettoyage Storage

La suppression ordinaire d'un bon n'accepte que le statut `draft` et les rôles
`admin|engineer` selon les règles de propriété. La RPC
`delete_purchase_order_draft_atomic` verrouille la commande, copie d'abord tous
les chemins de pièces jointes dans
`procurement_storage_cleanup_outbox` avec le `purchase_order_id`, puis supprime
la commande et ses enfants dans la même transaction. Il n'existe donc plus de
fenêtre où la métadonnée disparaît sans laisser la liste des objets Storage à retirer
(`supabase/migrations/20260812000456_transactional_procurement_reset_cleanup.sql`).

La réinitialisation admin `reset_tenant_procurement_data` applique la même
frontière à l'échelle du tenant : chemins Storage mis en outbox, puis suppression
atomique des commandes, prix fournisseur, articles de catalogue fournisseur et
fournisseurs. Elle exige le rôle tenant `admin` et la confirmation UI
`SUPPRIMER` (`src/app/dashboard/admin/procurement-reset/page.tsx`).

Le drain Storage est séparé, car Postgres ne peut pas participer à la
transaction du bucket. Un worker service-role revendique jusqu'à 100 entrées
avec un bail (120 secondes par défaut), revalide le bucket `devis` et le
namespace exact `purchase-orders/<purchase_order_id>/<filename>`, appelle une
suppression Storage idempotente, puis acquitte la ligne. Un échec est replanifié avec repli
exponentiel jusqu'à 10 tentatives ; l'épuisement conserve une ligne
`abandoned_at` au lieu de perdre la preuve. L'outbox est append-only et le cron
durable `GET /api/internal/workflows/recover` la draine aussi.

La suppression métier reste valide même si le drain immédiat échoue : l'UI
affiche alors le nombre d'objets en attente. Le cron `*/5`, sa configuration
`CRON_SECRET`, le plan Vercel Pro/Enterprise requis, son déploiement effectif et
une suppression Storage distante réelle n'ont pas été vérifiés par cette
documentation.

### 7.5 Archive ZIP

`GET /api/purchase-orders/[id]/zip` produit une archive `archiver` en niveau de compression 9 (`src/app/api/purchase-orders/[id]/zip/route.ts:309`) contenant :

- `bon-de-commande.html`, page HTML autonome générée à la volée avec en-têtes Designation / Reference / Qte / P.U. HT / Total HT, les trois totaux et les notes, toutes les valeurs textuelles étant échappées (`…:86-243`, `66-74`, `310`) ;
- chaque devis joint sous `documents/<nom assaini>`, avec suffixe `-1`, `-2`… en cas de collision ; un téléchargement en échec est ignoré silencieusement (`…:312-334`).

Le nom de l'archive est `bon_de_commande_<référence ou numéro>.zip` (`…:336-343`). Aucune borne de taille ni de nombre de pièces n'est appliquée. La réponse est un flux ; `finalize()` est appelé après la conversion en `ReadableStream` (`…:345-347`).

### 7.6 Impression écran

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
| `SUPABASE_SERVICE_ROLE_KEY` | Portail, publication PDF, outbox et workers internes | Sans elle, la lecture utilisateur peut subsister mais les RPC de publication PDF refusent le client authentifié : aucune nouvelle ligne `ready` n'est publiable | `src/lib/supabase/service-role.ts`, `src/lib/estimates/pdf-publication.ts` |
| `RESEND_API_KEY` | Envoi email | L'envoi initial échoue avant réservation si absente ; côté portail, la confirmation est simplement omise | `src/lib/email/send-estimate.ts`, `src/app/api/portal/[token]/accept/route.ts` |
| `EMAIL_FROM` | Expéditeur | L'envoi initial échoue si absente ; côté portail, la confirmation est simplement omise | `src/lib/email/send-estimate.ts`, `src/app/api/portal/[token]/accept/route.ts` |
| `NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL` | Base du lien email | Repli sur `/dashboard/estimates/<versionId>/print` relatif à la requête | `src/lib/email/send-estimate.ts` |
| `CRON_SECRET` | Reprise takeoff/intake et drain Storage procurement | La route interne renvoie `503` si absent et `401` si le bearer ne correspond pas | `src/app/api/internal/workflows/recover/route.ts` |
| `NODE_ENV` | Autorise les CGV brouillon | Hors `development`, un snapshot `isDraft` est ignoré | `src/lib/estimates/pdf-terms.ts:122-127` |

Ces variables figurent sans valeur dans `.env.example`.

---

## 10. Écarts et zones non vérifiées

1. **Objets PDF orphelins** : le chemin content-addressé et `upsert: false`
   empêchent l'écrasement, mais un candidat supplanté après upload peut rester
   sans métadonnée publiée. Aucun nettoyeur différé ne le retire encore (§2.1).
   La migration n'a pas été appliquée à un Supabase distant et aucun upload
   Storage réel n'a été exécuté pour cette validation.
2. **Émission des liens portail** : aucun code applicatif ne crée de `portal_tokens` (preuve au §6.1), et aucun lien `/portal/<token>` n'est construit dans les emails (§5).
3. **« Unite »** : la valeur exportée est `description`, faute de colonne dédiée (§4.1).
4. **Signature portail** : elle est déposée dans le bucket `devis` sur un chemin que la RLS de ce bucket n'autorise pas, uniquement viable par contournement service-role (§7.3).
5. Le volume des exports n'est pas borné : ni nombre de lignes XLSX, ni nombre ou taille cumulée des pièces jointes du ZIP, ni taille de la pièce jointe email.
